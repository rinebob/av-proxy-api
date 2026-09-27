/**
 * Verification script for Task #170 — repository + computeForDate.
 *
 * Runs the REAL build pipeline end-to-end on prod: corpus chain from GCS,
 * split-adjusted close from sa-time-series, registry compute, then the
 * repository's year-shard merge write — followed by a read-back assertion.
 *
 * ⚠ MUTATING — writes `symbol-metrics/{SYMBOL}/years/{YYYY}` days.{date}.
 * The write is the feature's own output and is idempotent (dedupe-by-key),
 * so re-running or overwriting is safe. Not in run-all.
 *
 * Usage:
 *   $env:OPTIONS_CORPUS_BUCKET="av-hist-options-corpus-bucket"
 *   npx ts-node -r tsconfig-paths/register -P scripts/tsconfig.json \
 *     scripts/verify/options-data-170-compute-for-date.ts [SYMBOL] [YYYY-MM-DD]
 */
import * as admin from 'firebase-admin';

if (!admin.apps.length) {
  admin.initializeApp({ projectId: 'alpha-vantage-proxy-api' });
}

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { GcsCorpusAdapter } = require('../../src/v2/historical-options-corpus/services/gcs-corpus-adapter.service');
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { DailyAdjustedReader } = require('../../src/v2/swing-set/services/daily-adjusted-reader.service');
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { SymbolMetricsRepository } = require('../../src/v2/symbol-metrics/services/symbol-metrics.repository');
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { MetricBuildService } = require('../../src/v2/symbol-metrics/build.service');
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { optionsCorpusBucket } = require('../../src/v2/historical-options-corpus/types');

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    console.error('FAIL: ' + message);
    process.exit(1);
  }
  console.log('PASS: ' + message);
}

async function main(): Promise<void> {
  const symbol = (process.argv[2] ?? 'QQQ').toUpperCase();
  const date = process.argv[3] ?? '2024-01-05';

  console.log(`--- Verifying computeForDate round trip: ${symbol} ${date} ---\n`);

  const db = admin.firestore();
  const repo = new SymbolMetricsRepository(db);
  const service = new MetricBuildService({
    gcs: new GcsCorpusAdapter(admin.storage().bucket(optionsCorpusBucket())),
    bars: new DailyAdjustedReader(db),
    repo,
  });

  // 1. Run the real pipeline (writes symbol-metrics/{sym}/years/{yyyy})
  const r = await service.computeForDate(symbol, date);
  console.log(`result: ${JSON.stringify(r)}`);
  assert(r.symbol === symbol && r.date === date, 'result echoes symbol/date');
  assert(r.written === true, 'entry written (corpus + close present)');
  assert(r.fields.includes('iv30'), `fields include iv30 (${JSON.stringify(r.fields)})`);

  // 2. Read back via the repository — round trip
  const entry = await repo.readDay(symbol, date);
  assert(entry != null, 'readDay round-trips the written entry');
  assert(Number.isFinite(entry.iv30) && entry.iv30! >= 0.005 && entry.iv30! <= 5, `iv30 in bounds (${entry.iv30})`);
  assert(entry.iv30Method === 'interpolated' || entry.iv30Method === 'nearest', `iv30Method (${entry.iv30Method})`);

  // 3. Idempotency — recompute overwrites the same key
  const before = await repo.readYear(symbol, date.slice(0, 4));
  await service.computeForDate(symbol, date);
  const after = await repo.readYear(symbol, date.slice(0, 4));
  assert(Object.keys(after?.days ?? {}).length === Object.keys(before?.days ?? {}).length,
    'recompute dedupes by date key (no duplicate day entries)');

  console.log('\n=== All verification checks passed ===');
  process.exit(0);
}

main().catch((e) => {
  console.error('FAIL (uncaught):', e?.message ?? e);
  process.exit(1);
});
