/**
 * Verification script for Task #169 — IV30 metric computer + registry.
 *
 * Runs the REAL computer against the REAL corpus: downloads a stored
 * historical-options chain from prod GCS, loads the split-adjusted close
 * (CompactBar.c) from the prod sa-time-series year doc, and runs
 * computeDayMetrics — the same code path the seed-worker hook will call.
 *
 * Read-only — no writes.
 *
 * Usage:
 *   $env:OPTIONS_CORPUS_BUCKET="av-hist-options-corpus-bucket"
 *   npx ts-node -r tsconfig-paths/register -P scripts/tsconfig.json \
 *     scripts/verify/options-data-169-iv30-computer.ts [SYMBOL] [YYYY-MM-DD]
 *
 * Defaults: QQQ 2024-01-05 (a corpus pivot date — must exist in the bucket).
 */
import * as admin from 'firebase-admin';
import type { AvOptionContract, CompactBar } from '@shared/alpha-vantage';

if (!admin.apps.length) {
  admin.initializeApp({ projectId: 'alpha-vantage-proxy-api' });
}

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { GcsCorpusAdapter } = require('../../src/v2/historical-options-corpus/services/gcs-corpus-adapter.service');
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { computeDayMetrics } = require('../../src/v2/symbol-metrics/metrics/registry');
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { getSymbolTimeSeriesYearsCollectionPath } = require('../../src/v2/common/firestore/firestore-paths');
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { AlphaVantageEndpoint } = require('@shared/alpha-vantage');
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { ApiProvider } = require('@shared/core');

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
  const bucketName = process.env.OPTIONS_CORPUS_BUCKET;
  if (!bucketName) {
    console.error('FAIL: OPTIONS_CORPUS_BUCKET env var not set');
    process.exit(1);
  }

  console.log(`--- Verifying IV30 computer on real corpus: ${symbol} ${date} ---\n`);

  // 1. Read the stored chain
  const adapter = new GcsCorpusAdapter(admin.storage().bucket(bucketName));
  const result = await adapter.readItem(symbol, date);
  assert(result.status === 'FOUND', `corpus object exists: historical-options/v1/${symbol}/${date}.json.gz`);
  const chain: AvOptionContract[] = result.response?.data ?? [];
  assert(chain.length > 100, `chain has real depth (${chain.length} contracts)`);

  // 2. Load the split-adjusted close (CompactBar.c — NOT ac) for that date
  const year = date.slice(0, 4);
  const yearsPath = getSymbolTimeSeriesYearsCollectionPath(
    symbol, AlphaVantageEndpoint.TIME_SERIES_DAILY_ADJUSTED, ApiProvider.ALPHA_VANTAGE,
  );
  const yearDoc = await admin.firestore().doc(`${yearsPath}/${year}`).get();
  assert(yearDoc.exists, `sa-time-series year doc exists: ${yearsPath}/${year}`);
  const bars: CompactBar[] = yearDoc.data()?.bars ?? [];
  const bar = bars.find((b: CompactBar) => b.d === date);
  assert(!!bar && Number.isFinite(bar.c), `close bar for ${date} present (c=${bar?.c})`);
  if (!bar) process.exit(1);
  // Same tolerance as DailyAdjustedReader: legacy bars may lack barStatus;
  // only an explicit interim marker (-1/0) disqualifies.
  assert(bar.barStatus === undefined || bar.barStatus === 1, `bar is final or legacy-final (barStatus=${bar.barStatus})`);

  // 3. Run the registry the same way the build service will
  const entry = computeDayMetrics({ chain, underlyingClose: bar.c, date });
  assert(entry != null, 'computeDayMetrics emits an entry');
  console.log(`\nentry: ${JSON.stringify(entry)}\n`);
  assert(Number.isFinite(entry.iv30) && entry.iv30! >= 0.005 && entry.iv30! <= 5,
    `iv30 in bounds (${entry.iv30})`);
  assert(entry.iv30Method === 'interpolated' || entry.iv30Method === 'nearest',
    `iv30Method present (${entry.iv30Method})`);
  assert(typeof entry.iv30Contracts === 'number' && entry.iv30Contracts > 0,
    `iv30Contracts counted (${entry.iv30Contracts})`);

  console.log('\n=== All verification checks passed ===');
  process.exit(0);
}

main().catch((e) => {
  console.error('FAIL (uncaught):', e?.message ?? e);
  process.exit(1);
});
