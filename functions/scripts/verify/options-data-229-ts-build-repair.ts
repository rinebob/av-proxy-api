/**
 * Ops + verification script for Task #229 — ts-build repair pass.
 *
 * During the 2026 backfill drain, per-contract GCS failures
 * (builder.read.error / builder.write.error — mostly transient 5xx under
 * high write concurrency) were caught and counted as `failedContracts`,
 * but the task still succeeded, so nothing re-ran them. writeMerged
 * dedupes covered dates, so re-running is safe and idempotent.
 *
 * Enumeration source: `builder.symbol.done` log entries (structured
 * jsonPayload via createLogger) — each carries the full build report:
 * symbol, startDate/endDate, failedContracts, and the per-contract
 * errors[] list.
 *
 * Modes:
 *   dry        (default, read-only) — queries Cloud Logging for failed
 *              builds in the window, prints the failed (symbol, range)
 *              tasks + the explicit unhealed contract list. No writes.
 *   --enqueue  MUTATING — re-enqueues each failed (symbol, range) as a
 *              TsBuildPayload on processHistoricalOptionsTsBuildTask.
 *              GCS reads/writes only — no AV calls. Needs
 *              FIREBASE_SERVICE_ACCOUNT_ID locally (metadata server absent).
 *
 * Post-pass audit (AC3/AC4): after the re-run drains, re-run this script
 * dry with --since covering the repair window — any remaining
 * failedContracts>0 surface in the unhealed list with contract + error.
 *
 * Args:
 *   --since ISO          log window start (default: 2026-10-01T00:00:00Z —
 *                        bound it to the drain window for tighter output)
 *   --until ISO          log window end (default: now)
 *   --symbols QQQ,SNDK   bound the repair to specific symbols
 *   --limit N            max log entries read (default: 60000)
 *
 * Cloud Logging `_Default` retention is ~30 days — run within that window
 * of the drain (and of the repair pass for the audit) or enumeration
 * silently returns nothing.
 *
 * REQUIRES GCLOUD_PROJECT=alpha-vantage-proxy-api — without it, local ADC
 * resolves the dev project and gcloud reads the wrong logs.
 *
 * Usage:
 *   cd functions
 *   GCLOUD_PROJECT=alpha-vantage-proxy-api npx ts-node -r tsconfig-paths/register -P scripts/tsconfig.json scripts/verify/options-data-229-ts-build-repair.ts [--since 2026-10-20T00:00:00Z] [--symbols QQQ] [--enqueue]
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { GoogleAuth } from 'google-auth-library';
import { getFunctions } from 'firebase-admin/functions';

import '../../src/firebase-admin-init';
import {
  OPTIONS_TS_BUILD_TASK_QUEUE,
  type TsBuildPayload,
} from '../../src/v2/historical-options-corpus/handlers/ts-build.task';
import {
  extractFailedBuilds,
  flattenUnhealed,
  toRepairPayloads,
} from '../../src/v2/historical-options-corpus/services/ts-build-repair';

const PROJECT = 'alpha-vantage-proxy-api';
const DEFAULT_SINCE = '2026-10-01T00:00:00Z';
// ~129 symbols × ~210 drain days ≈ 27k done events; keep default comfortably
// above the whole-drain size and warn loudly when the read truncates.
const DEFAULT_LIMIT = 60000;

function arg(flag: string): string | undefined {
  const i = process.argv.indexOf(flag);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

let failures = 0;
function check(ok: boolean, label: string, detail = '') {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failures += 1;
}

/**
 * Reads `builder.symbol.done` jsonPayloads from prod Cloud Logging via the
 * entries:list REST API — ADC-scoped token, paginated. (Avoids shelling
 * `gcloud`: node refuses to spawn .cmd shims without shell:true.)
 */
async function readDoneEntries(
  since: string,
  until: string,
  limit: number,
): Promise<{ payloads: unknown[]; truncated: boolean }> {
  const auth = new GoogleAuth({ scopes: ['https://www.googleapis.com/auth/logging.read'] });
  const filter =
    'jsonPayload.component="time-series-builder" AND ' +
    'jsonPayload.event="builder.symbol.done" AND ' +
    `timestamp>="${since}" AND timestamp<="${until}"`;

  const fetchPage = async (pageSize: number, pageToken?: string) => {
    const body = JSON.stringify({
      resourceNames: [`projects/${PROJECT}`],
      filter,
      orderBy: 'timestamp asc',
      pageSize,
      ...(pageToken ? { pageToken } : {}),
    });
    for (let attempt = 0; ; attempt++) {
      // Inside the retry loop: getAccessToken caches and self-refreshes, so a
      // long 429 backoff can't strand an expired token on the next attempt.
      const token = await auth.getAccessToken();
      const res = await fetch('https://logging.googleapis.com/v2/entries:list', {
        method: 'POST',
        headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
        body,
      });
      if (res.ok) {
        return (await res.json()) as {
          entries?: Array<{ jsonPayload?: unknown }>;
          nextPageToken?: string;
        };
      }
      // Per-minute read quota (120/min/project) — wait out the window, retry.
      if ((res.status === 429 || res.status === 503) && attempt < 5) {
        const wait = 65_000 + attempt * 15_000;
        console.log(`  logging ${res.status} — waiting ${wait / 1000}s before retry ${attempt + 1}/5`);
        await new Promise((r) => setTimeout(r, wait));
        continue;
      }
      throw new Error(`logging entries:list ${res.status}: ${await res.text()}`);
    }
  };

  const payloads: unknown[] = [];
  let pageToken: string | undefined;
  let emptyPages = 0;
  while (payloads.length < limit) {
    const data = await fetchPage(Math.min(1000, limit - payloads.length), pageToken);
    if (data.entries?.length) {
      payloads.push(...data.entries.map((e) => e.jsonPayload));
      emptyPages = 0;
    } else if (++emptyPages > 3) {
      // API keeps returning empty pages with a live token — can't prove
      // completeness, so report the read as truncated.
      return { payloads, truncated: true };
    }
    pageToken = data.nextPageToken;
    if (!pageToken) return { payloads, truncated: false };
  }
  return { payloads, truncated: true };
}

async function main() {
  const project = process.env.GCLOUD_PROJECT ?? process.env.GOOGLE_CLOUD_PROJECT;
  if (project !== PROJECT) {
    console.error(
      `FAIL: this script reads prod logs and must run with GCLOUD_PROJECT=${PROJECT} (got '${project ?? 'unset'}').`,
    );
    process.exit(1);
  }

  const enqueue = process.argv.includes('--enqueue');
  const since = arg('--since') ?? DEFAULT_SINCE;
  const until = arg('--until') ?? new Date().toISOString();
  const limit = Number(arg('--limit') ?? String(DEFAULT_LIMIT));
  if (!Number.isInteger(limit) || limit <= 0) {
    console.error(`FAIL: --limit must be a positive integer (got '${arg('--limit')}').`);
    process.exit(1);
  }
  const symbolsArg = arg('--symbols');
  const bound = symbolsArg
    ? new Set(
        symbolsArg
          .split(',')
          .map((s) => s.trim().toUpperCase())
          .filter(Boolean),
      )
    : undefined;

  console.log(
    `mode: ${enqueue ? 'ENQUEUE (re-enqueues failed build tasks)' : 'dry (read-only)'}\n` +
      `log window: ${since} .. ${until}\n` +
      `symbols: ${bound ? [...bound].join(',') : 'all'}`,
  );

  const { payloads: entries, truncated } = await readDoneEntries(since, until, limit);
  console.log(`\nlog entries read: ${entries.length}`);
  check(
    !truncated,
    'log read did not truncate — window fully enumerated',
    `${entries.length}/${limit}`,
  );

  let builds = extractFailedBuilds(entries);
  if (bound) builds = builds.filter((b) => bound.has(b.symbol));

  const totalErrors = builds.reduce((n, b) => n + b.failedContracts, 0);
  console.log(`failed build tasks: ${builds.length} — failedContracts total: ${totalErrors}`);
  for (const b of builds) {
    console.log(`  ${b.symbol} [${b.startDate} .. ${b.endDate}] failedContracts=${b.failedContracts} errors=${b.errors.length}`);
  }

  const unhealed = flattenUnhealed(builds);
  console.log(`\nunhealed contracts: ${unhealed.length}`);
  const sample = unhealed.slice(0, 20);
  for (const u of sample) {
    console.log(`  ${u.symbol} ${u.contractID}: ${u.error}`);
  }
  if (unhealed.length > sample.length) {
    console.log(`  … +${unhealed.length - sample.length} more`);
  }

  const payloads = toRepairPayloads(builds);
  check(
    payloads.every((p) => p.symbol && p.startDate && p.endDate && p.startDate <= p.endDate),
    'every repair payload is a well-formed ts-build range task',
    `${payloads.length} payloads`,
  );
  // errors[] unions across duplicate events and carries one entry per failed
  // contract on the producer side — each build's union must reach its max
  // observed failedContracts. A shortfall means Cloud Logging truncated an
  // oversized jsonPayload and the triage list silently under-reports (AC4).
  const underReported = builds.filter((b) => b.errors.length < b.failedContracts);
  check(
    underReported.length === 0,
    'failed builds carry explicit contract+error detail for triage',
    `${unhealed.length} unhealed / ${totalErrors} failedContracts` +
      (underReported.length ? ` — ${underReported.length} build(s) under-reported` : ''),
  );

  // The console shows a sample only — persist the full triage list (AC4)
  // with provenance so a later reader knows its scope and completeness.
  const outDir = path.resolve(__dirname, '../../../.devin/tmp');
  fs.mkdirSync(outDir, { recursive: true });
  const outFile = path.join(outDir, 'options-data-229-unhealed.json');
  fs.writeFileSync(
    outFile,
    JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        since,
        until,
        symbols: bound ? [...bound].sort() : 'all',
        logReadTruncated: truncated,
        underReportedBuilds: underReported.length,
        unhealed,
      },
      null,
      2,
    ),
  );
  console.log(`full triage list written: ${outFile}`);

  // Enqueue is gated on all checks — any future check() must be added
  // ABOVE this block or it silently bypasses the gate.
  if (enqueue) {
    if (failures > 0) {
      console.log(`\n--enqueue skipped: ${failures} check(s) failed — refusing to dispatch an unverified repair set`);
    } else if (payloads.length === 0) {
      console.log('\n--enqueue: nothing to enqueue — no failed builds in window');
    } else {
      const queue = getFunctions().taskQueue<TsBuildPayload>(OPTIONS_TS_BUILD_TASK_QUEUE);
      for (const p of payloads) {
        await queue.enqueue(p);
      }
      console.log(`\nenqueued ${payloads.length} repair tasks on ${OPTIONS_TS_BUILD_TASK_QUEUE}`);
      console.log('audit: re-run dry with --since covering the repair window after the drain completes');
    }
  }

  if (failures > 0) {
    console.log(`\n=== ${failures} check(s) FAILED ===`);
    process.exitCode = 1;
    return;
  }
  console.log('\n=== All verification checks passed ===');
}

main()
  .catch((e) => {
    console.error('\n=== Verification FAILED ===');
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => process.exit(process.exitCode ?? 0));
