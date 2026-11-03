/**
 * Verification script for Task #227 — chain sanity flags.
 *
 * Verifies the suspect-chain pipeline against prod, read-only by default:
 *
 *   1. REF CENSUS — gcs.listItems projects chainFlag/chainFlagConfirmed off the
 *      real object metadata for the requested symbols.
 *   2. RECOUNT — downloads every stored object and recomputes the flag via
 *      chainSanityCounts, so drift between stamped metadata and payload
 *      content is detectable (unstamped suspects + stale stamps).
 *   3. RECONCILE DRY-RUN — the REAL runCorpusReconcile with production read
 *      deps and recording write/dispatch stubs: unconfirmed flagged objects
 *      inside the coverage window must surface as forceRefetch dispatches;
 *      chainFlagConfirmed ones must appear only as thin-chain log lines.
 *   4. RUN-ITEM FLAGS — listItemsForSymbol shows putCount/callCount/
 *      rowCount/chainFlag fields on seed outcomes (populated by seeds that
 *      ran the flagging worker code — informational pre-deploy).
 *
 * Modes:
 *   dry          (default, read-only) — census + recount drift report +
 *                reconcile dry-run. Zero writes.
 *   --stamp-flags  MUTATING — for every object whose recounted flag differs
 *                from its stamped metadata, calls gcs.setChainFlag. This is
 *                the backfill path for objects stored before the flagging
 *                code existed (e.g. the verified QQQ calls-only dates).
 *
 * Args:
 *   --symbols QQQ,SNDK   symbols to scan (default: QQQ). Each object is one
 *                        GCS download — bound deliberately.
 *   --full               recount every stored object, including pre-2026
 *                        pivot corpus outside the reconcile window (~10x
 *                        slower — default bounds to the window).
 *
 * REQUIRES GCLOUD_PROJECT=alpha-vantage-proxy-api — without it, local ADC
 * resolves the dev project and the diff runs against the wrong database.
 *
 * Usage:
 *   cd functions
 *   GCLOUD_PROJECT=alpha-vantage-proxy-api npx ts-node -r tsconfig-paths/register -P scripts/tsconfig.json scripts/verify/options-data-227-chain-sanity-flags.ts [--symbols QQQ,SNDK] [--stamp-flags]
 */
import { getStorage } from 'firebase-admin/storage';

import { getYesterdayEt } from '../../src/v2/common/utils/date-time.utils';
import { chainSanityCounts } from '../../src/v2/historical-options-corpus/services/chain-sanity';
import { runCorpusReconcile } from '../../src/v2/historical-options-corpus/services/corpus-reconcile.core';
import { CorpusMetadataService, type CorpusRunPlan } from '../../src/v2/historical-options-corpus/services/corpus-metadata.service';
import { GcsCorpusAdapter } from '../../src/v2/historical-options-corpus/services/gcs-corpus-adapter.service';
import { TradingCalendarService } from '../../src/v2/historical-options-corpus/services/trading-calendar.service';
import { listOptionsEnabledSymbols } from '../../src/v2/historical-options-corpus/services/options-enabled-gate';
import {
  isLiveQueueEntry,
  latestItemsByDate,
  toCoverageRunItems,
} from '../../src/v2/historical-options-corpus/services/corpus-coverage.service';
import type { CorpusChainFlag, CorpusSeedPayload } from '../../src/v2/historical-options-corpus/types';
import {
  OPTIONS_CORPUS_DAILY_FLOOR_DATE,
  optionsCorpusBucket,
} from '../../src/v2/historical-options-corpus/types';

function arg(flag: string): string | undefined {
  const i = process.argv.indexOf(flag);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

let failures = 0;
function check(ok: boolean, label: string, detail = '') {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failures += 1;
}

async function main() {
  const project = process.env.GCLOUD_PROJECT ?? process.env.GOOGLE_CLOUD_PROJECT;
  if (project !== 'alpha-vantage-proxy-api') {
    console.error(
      'FAIL: this script reads prod Firestore/GCS and must run with ' +
        `GCLOUD_PROJECT=alpha-vantage-proxy-api (got '${project ?? 'unset'}').`,
    );
    process.exit(1);
  }

  const stamp = process.argv.includes('--stamp-flags');
  const full = process.argv.includes('--full');
  const symbols = (arg('--symbols') ?? 'QQQ')
    .split(',')
    .map((s) => s.trim().toUpperCase())
    .filter(Boolean);
  const endDate = getYesterdayEt();
  console.log(
    `mode: ${stamp ? 'STAMP-FLAGS (writes object metadata)' : 'dry (read-only)'}` +
      `${full ? ' — full recount' : ''}\n` +
      `symbols: ${symbols.join(',')}\n` +
      `reconcile window: ${OPTIONS_CORPUS_DAILY_FLOOR_DATE} .. ${endDate}`,
  );

  const metadata = new CorpusMetadataService();
  const gcs = new GcsCorpusAdapter(getStorage().bucket(optionsCorpusBucket()));
  const calendar = new TradingCalendarService();

  // ---- 1 + 2: ref census + recount drift ----------------------------------
  const drift: Array<{ symbol: string; date: string; stamped?: CorpusChainFlag; recounted?: CorpusChainFlag }> = [];
  for (const symbol of symbols) {
    const refs = await gcs.listItems(symbol);
    const stamped = refs.filter((r) => r.chainFlag);
    const confirmed = refs.filter((r) => r.chainFlagConfirmed);
    console.log(
      `\n${symbol}: ${refs.length} objects — ` +
        `chainFlag=${stamped.length} (confirmed=${confirmed.length})`,
    );

    // The stamp/drift pass matters inside the reconcile window — pre-2026
    // pivot-corpus objects are out of scope unless --full is passed.
    const scanRefs = full
      ? refs
      : refs.filter((r) => r.date >= OPTIONS_CORPUS_DAILY_FLOOR_DATE && r.date <= endDate);
    console.log(`  recounting ${scanRefs.length} window objects…`);

    let corrupt = 0;
    let recounted = 0;
    const CHUNK = 40;
    for (let i = 0; i < scanRefs.length; i += CHUNK) {
      await Promise.all(
        scanRefs.slice(i, i + CHUNK).map(async (ref) => {
          const read = await gcs.readItem(symbol, ref.date);
          if (read.status !== 'FOUND') {
            corrupt += 1;
            return;
          }
          const flag = chainSanityCounts(read.response).flag;
          recounted += 1;
          if (flag !== ref.chainFlag) {
            drift.push({ symbol, date: ref.date, stamped: ref.chainFlag, recounted: flag });
          }
        }),
      );
      if (i > 0 && i % 200 === 0) {
        console.log(`  … ${i}/${scanRefs.length}`);
      }
    }
    console.log(`  recounted ${recounted} payloads (${corrupt} corrupt) — drift ${drift.length} total`);
  }

  for (const d of drift.slice(0, 40)) {
    console.log(`  drift ${d.symbol}/${d.date}: stamped=${d.stamped ?? 'none'} recounted=${d.recounted ?? 'none'}`);
  }

  // ---- --stamp-flags: apply setChainFlag for recount-vs-metadata drift ----
  if (stamp) {
    for (const d of drift) {
      if (!d.recounted) continue; // healthy payload with a stale stamp — reported, not auto-cleared
      await gcs.setChainFlag(d.symbol, d.date, d.recounted);
      console.log(`  stamped ${d.symbol}/${d.date} -> ${d.recounted}`);
    }
    const remaining = drift.filter((d) => !d.recounted).length;
    if (remaining > 0) {
      console.log(`  (${remaining} stale stamps on healthy payloads left for triage)`);
    }
    // Re-list every stamped symbol to prove the stamps land on object metadata.
    const stampTargets = drift.filter((d) => d.recounted);
    let verified = 0;
    for (const s of new Set(stampTargets.map((d) => d.symbol))) {
      const refs = await gcs.listItems(s);
      verified += stampTargets.filter(
        (d) => d.symbol === s && refs.find((r) => r.date === d.date)?.chainFlag === d.recounted,
      ).length;
    }
    check(
      verified === stampTargets.length,
      'listItems projects stamped chainFlag',
      `${verified}/${stampTargets.length} stamps verified`,
    );
  } else if (drift.length > 0) {
    console.log(`\n(${drift.length} objects drift from stamped metadata — rerun with --stamp-flags to stamp recounted flags)`);
  }

  // ---- 3: reconcile dry-run — flagged refs must become forceRefetch seeds --
  // Two synthetic probes on the first symbol make the dispatch assertions
  // non-vacuous when prod has no stamped suspects yet: one unconfirmed flag
  // (must surface as a forceRefetch dispatch) and one confirmed flag (must
  // surface only as a thin-chain count). The probes ride along inside the
  // recording-stub dry-run — nothing is written or really enqueued.
  //
  // Probes are intersected with the trading calendar — a stored object on a
  // non-trading day inside the window is ignored by the reconciler, so
  // flagging one would FAIL the checks on a healthy pipeline. If the probe
  // checks still FAIL with 'no probe date', re-run with a different
  // --symbols: the probes need two unflagged, non-live-queued, in-window
  // objects on trading days — an environment condition, not a regression.
  const expectedDates = new Set(
    await calendar.getTradingDates(OPTIONS_CORPUS_DAILY_FLOOR_DATE, endDate),
  );
  let probeSuspect: string | undefined;
  let probeThin: string | undefined;
  const drySink = { enqueued: [] as CorpusSeedPayload[] };
  const result = await runCorpusReconcile(
    {
      listEnabledSymbols: async () =>
        (await listOptionsEnabledSymbols()).filter((s) => symbols.includes(s.toUpperCase())),
      listExpectedDates: async (startDate, end) => calendar.getTradingDates(startDate, end),
      listObjects: async (symbol) => {
        const refs = await gcs.listItems(symbol);
        if (symbol !== symbols[0]) return refs;
        // Probes must also dodge live-queue suppression — a covered object
        // can still be pending/in_progress in a live run, which would make
        // tryDispatch suppress the probe and FAIL a healthy pipeline.
        const latestByDate = latestItemsByDate(
          toCoverageRunItems(await metadata.listItemsForSymbol(symbol)),
        );
        const nowMs = Date.now();
        const probes = refs
          .filter((r) => !r.chainFlag && expectedDates.has(r.date))
          .filter((r) => {
            const latest = latestByDate.get(r.date);
            return !latest || !isLiveQueueEntry(latest, nowMs);
          })
          .slice(0, 2);
        probeSuspect = probes[0]?.date;
        probeThin = probes[1]?.date;
        return refs.map((r) =>
          r.date === probeSuspect
            ? { ...r, chainFlag: 'calls_only' as const }
            : r.date === probeThin
              ? { ...r, chainFlag: 'empty' as const, chainFlagConfirmed: true }
              : r,
        );
      },
      listRunItems: async (symbol) =>
        toCoverageRunItems(await metadata.listItemsForSymbol(symbol)),
      planRun: async (options) => {
        const items = options.items ?? [];
        const plan: CorpusRunPlan = {
          runId: options.runId ?? 'dry',
          symbols: options.symbols,
          startDate: options.startDate,
          endDate: options.endDate,
          totalItems: items.length,
          items,
          dryRun: true,
          pilot: false,
        };
        return plan;
      },
      markRunStatus: async () => undefined,
      updateRunSummary: async () => undefined,
      enqueueSeed: async (payload) => {
        drySink.enqueued.push(payload);
      },
      logger: console,
    },
    { startDate: OPTIONS_CORPUS_DAILY_FLOOR_DATE, endDate },
  );

  console.log(
    `\nreconcile dry-run: gaps=${result.totalGaps} enqueued=${result.enqueued} ` +
      `suppressed=${result.suppressed} flagged=${result.flagged} thinChains=${result.thinChains}`,
  );
  const forced = drySink.enqueued.filter((e) => e.forceRefetch);
  const plain = drySink.enqueued.filter((e) => !e.forceRefetch);
  console.log(`  dispatches: ${plain.length} gap + ${forced.length} forceRefetch`);
  check(
    forced.length === result.flagged,
    'every flagged suspect dispatches with forceRefetch',
    `${forced.length}/${result.flagged}`,
  );
  check(
    !!probeSuspect && forced.some((e) => e.date === probeSuspect),
    'synthetic unconfirmed suspect dispatched with forceRefetch',
    probeSuspect ?? 'no probe date',
  );
  check(
    !!probeThin && result.thinChains >= 1,
    'synthetic confirmed flag counted as thin-chain, not re-seeded',
    probeThin ?? 'no probe date',
  );
  check(
    forced.every((e) => e.attempt === 1 && e.symbol && e.date && e.runId),
    'forceRefetch payloads are well-formed seed tasks',
  );

  // ---- 4: run-item flag fields ---------------------------------------------
  const items = await metadata.listItemsForSymbol(symbols[0]);
  const withFlag = items.filter((i) => i.data.chainFlag);
  const withCounts = items.filter((i) => i.data.rowCount !== undefined);
  console.log(
    `\nrun items for ${symbols[0]}: ${items.length} scanned — ` +
      `withCounts=${withCounts.length} withChainFlag=${withFlag.length}`,
  );
  for (const i of withFlag.slice(0, 10)) {
    console.log(
      `  ${i.data.date}: flag=${i.data.chainFlag} confirmed=${i.data.chainFlagConfirmed === true} ` +
        `rows=${i.data.rowCount} puts=${i.data.putCount} calls=${i.data.callCount}`,
    );
  }
  if (withCounts.length === 0) {
    console.log('  (none yet — counts appear on seeds that ran the flagging worker code)');
  }

  if (failures === 0) {
    console.log('\n=== All verification checks passed ===');
  } else {
    console.log(`\n=== ${failures} check(s) FAILED ===`);
    process.exitCode = 1;
  }
}

main()
  .catch((err) => {
    console.error(`\n=== Verification FAILED ===\n${err instanceof Error ? err.message : String(err)}`);
    process.exitCode = 1;
  })
  .finally(() => process.exit(process.exitCode ?? 0));
