/**
 * Verification script for Task #220 — standing coverage reconciler.
 *
 * Runs the REAL runCorpusReconcile core against prod with production deps:
 * live enabled-symbol list, real GCS corpus listings, real options_corpus_runs
 * item state, real TradingCalendarService expected dates.
 *
 * Modes:
 *   dry   (default, read-only): stubs the write/dispatch deps — no run doc,
 *         no seed tasks. Reports the real coverage diff: expected dates,
 *         per-symbol present/missing/enqueued, suppressed live-queue gaps.
 *   execute: production deps end-to-end — writes a real options_corpus_runs
 *         doc and enqueues real seed tasks for uncovered gaps (each costs an
 *         AV call once the seed worker runs; bounded by however many gaps
 *         exist). This is the J5 journey: gap → enqueued seed + run doc.
 *
 * Optional positional args:
 *   --symbols QQQ,SNDK   bound the sweep to specific symbols (still gated by
 *                        optionsEnabled — the live set is read each run)
 *
 * REQUIRES GCLOUD_PROJECT=alpha-vantage-proxy-api — without it, local ADC
 * resolves the dev project and the diff runs against the wrong database.
 * Local enqueue needs FIREBASE_SERVICE_ACCOUNT_ID (metadata server absent).
 *
 * Usage:
 *   cd functions
 *   GCLOUD_PROJECT=alpha-vantage-proxy-api npx ts-node -r tsconfig-paths/register -P scripts/tsconfig.json scripts/verify/options-data-220-corpus-reconcile.ts [--symbols QQQ,SNDK] [--execute]
 */
import { getFunctions } from 'firebase-admin/functions';
import { getStorage } from 'firebase-admin/storage';

import { db } from '../../src/firebase-admin-init';
import { getYesterdayEt } from '../../src/v2/common/utils/date-time.utils';
import { runCorpusReconcile } from '../../src/v2/historical-options-corpus/services/corpus-reconcile.core';
import { CorpusMetadataService } from '../../src/v2/historical-options-corpus/services/corpus-metadata.service';
import { GcsCorpusAdapter } from '../../src/v2/historical-options-corpus/services/gcs-corpus-adapter.service';
import { planCorpusRun } from '../../src/v2/historical-options-corpus/services/corpus-planner.service';
import { TradingCalendarService } from '../../src/v2/historical-options-corpus/services/trading-calendar.service';
import { listOptionsEnabledSymbols } from '../../src/v2/historical-options-corpus/services/options-enabled-gate';
import { toCoverageRunItems } from '../../src/v2/historical-options-corpus/services/corpus-coverage.service';
import {
  OPTIONS_CORPUS_DAILY_FLOOR_DATE,
  OPTIONS_CORPUS_SEED_TASK_QUEUE,
  optionsCorpusBucket,
} from '../../src/v2/historical-options-corpus/types';

function arg(flag: string): string | undefined {
  const i = process.argv.indexOf(flag);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

async function main() {
  const project = process.env.GCLOUD_PROJECT ?? process.env.GOOGLE_CLOUD_PROJECT;
  if (project !== 'alpha-vantage-proxy-api') {
    console.error(
      'FAIL: this script reads/writes prod Firestore and must run with ' +
        `GCLOUD_PROJECT=alpha-vantage-proxy-api (got '${project ?? 'unset'}').`,
    );
    process.exit(1);
  }

  const execute = process.argv.includes('--execute');
  const symbolsArg = arg('--symbols');
  const bound = symbolsArg
    ? new Set(symbolsArg.split(',').map((s) => s.trim().toUpperCase()))
    : undefined;
  const endDate = getYesterdayEt();
  console.log(
    `mode: ${execute ? 'EXECUTE (writes run doc + enqueues seeds)' : 'dry (read-only)'}\n` +
      `window: ${OPTIONS_CORPUS_DAILY_FLOOR_DATE} .. ${endDate}\n` +
      `symbols: ${bound ? [...bound].join(',') : 'live enabled set'}`,
  );

  const metadata = new CorpusMetadataService();
  const gcs = new GcsCorpusAdapter(getStorage().bucket(optionsCorpusBucket()));
  const calendar = new TradingCalendarService();
  const queue = getFunctions().taskQueue(OPTIONS_CORPUS_SEED_TASK_QUEUE);

  const drySink = { plans: 0, statuses: [] as string[], enqueued: 0 };

  const result = await runCorpusReconcile(
    {
      listEnabledSymbols: async () =>
        (await listOptionsEnabledSymbols()).filter((s) => !bound || bound.has(s.toUpperCase())),
      listExpectedDates: async (startDate, end) => calendar.getTradingDates(startDate, end),
      listObjects: (symbol) => gcs.listItems(symbol),
      listRunItems: async (symbol) =>
        toCoverageRunItems(await metadata.listItemsForSymbol(symbol)),
      planRun: execute
        ? (options) => planCorpusRun({ ...options, calendar, metadata })
        : async (options) => {
            drySink.plans += 1;
            // The core hands the planner an explicit manifest — dry mode
            // just reports it back without persisting a run doc.
            const items = options.items ?? [];
            return {
              runId: options.runId ?? 'dry',
              symbols: options.symbols,
              startDate: options.startDate,
              endDate: options.endDate,
              totalItems: items.length,
              items,
              dryRun: true,
              pilot: false,
            };
          },
      markRunStatus: execute
        ? (runId, status) => metadata.markRunStatus(runId, status)
        : async (_runId, status) => {
            drySink.statuses.push(status);
          },
      updateRunSummary: execute
        ? (runId, perSymbol) => metadata.updateRunSummary(runId, perSymbol)
        : async () => undefined,
      enqueueSeed: execute
        ? async (payload) => {
            await queue.enqueue(payload);
          }
        : async () => {
            drySink.enqueued += 1;
          },
      logger: console,
    },
    { startDate: OPTIONS_CORPUS_DAILY_FLOOR_DATE, endDate },
  );

  const gapped = Object.entries(result.perSymbol).filter(([, c]) => c.missing > 0 || c.error);
  console.log(`\nrunId: ${result.runId}`);
  console.log(`symbols swept: ${result.symbols.length}, expected dates/symbol: ${result.expectedDates}`);
  console.log(`totalGaps=${result.totalGaps} enqueued=${result.enqueued} suppressed=${result.suppressed} failed=${result.failed.length}`);
  if (!execute) {
    console.log(`(dry: plan stubs=${drySink.plans}, statuses=${drySink.statuses.join(',') || 'none'}, wouldEnqueue=${drySink.enqueued})`);
  }
  if (gapped.length === 0) {
    console.log('coverage: FULL — no uncovered expected dates across the swept set');
  } else {
    console.log(`\nsymbols with gaps/errors (${gapped.length}):`);
    for (const [sym, c] of gapped.slice(0, 40)) {
      console.log(`  ${sym}: ${JSON.stringify(c)}`);
    }
    if (gapped.length > 40) console.log(`  … +${gapped.length - 40} more`);
  }

  if (execute) {
    const runDoc = await db
      .collection('options_corpus_runs')
      .doc(result.runId)
      .get();
    const data = runDoc.data();
    console.log(`\nrun doc: status=${data?.status} totalItems=${data?.totalItems} perSymbol keys=${Object.keys(data?.perSymbol ?? {}).length}`);
  }

  console.log('\n=== Reconcile verification complete ===');
}

main()
  .catch((err) => {
    console.error(`\n=== Verification FAILED ===\n${err instanceof Error ? err.message : String(err)}`);
    process.exitCode = 1;
  })
  .finally(() => process.exit(process.exitCode ?? 0));
