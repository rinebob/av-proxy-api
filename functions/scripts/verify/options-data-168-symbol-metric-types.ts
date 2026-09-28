/**
 * Verification script for Task #168 — symbol-metrics contract types.
 *
 * Verifies the compiled shared package exposes the metric contract the BE
 * pipeline and partnerIvMetricsV2 will consume:
 * - Path constants encode the year-shard layout.
 * - SYMBOL_METRIC_FIELDS is the endpoint whitelist / computer field source.
 * - A real SymbolMetricsYearDoc + IvMetricsRow assemble end-to-end and
 *   survive JSON round-trip (Firestore-writeable primitives).
 *
 * Read-only — no writes, no credentials needed.
 *
 * Usage:
 *   npx ts-node -r tsconfig-paths/register -P scripts/tsconfig.json \
 *     scripts/verify/options-data-168-symbol-metric-types.ts
 */
import {
  SYMBOL_METRICS_COLLECTION,
  SYMBOL_METRICS_YEARS_SUBCOLLECTION,
  SYMBOL_METRIC_FIELDS,
  IV_RANK_WINDOWS,
  IV_RANK_LATEST_COLLECTION,
} from '@shared/options';
import type {
  SymbolMetricDayEntry,
  SymbolMetricsYearDoc,
  IvMetricsRow,
  IvRankLatestDoc,
} from '@shared/options';

function assert(cond: boolean, msg: string): void {
  if (!cond) {
    console.error(`FAIL: ${msg}`);
    process.exit(1);
  }
  console.log(`PASS: ${msg}`);
}

function main(): void {
  console.log('--- Verifying symbol-metrics contract types (compiled @shared) ---\n');

  // Stage 1: path constants
  assert(SYMBOL_METRICS_COLLECTION === 'symbol-metrics', 'collection = symbol-metrics');
  assert(SYMBOL_METRICS_YEARS_SUBCOLLECTION === 'years', 'subcollection = years');

  // Stage 2: field whitelist — the endpoint whitelist AND the computer contract
  // (append-only: v1 fields unchanged, rank fields appended by #185)
  const EXPECTED_FIELDS = [
    'iv30', 'iv30Method', 'iv30Contracts',
    'ivRank30', 'ivRank60', 'ivRank180', 'ivRank360',
    'ivPct30', 'ivPct60', 'ivPct180', 'ivPct360',
    'ivN30', 'ivN60', 'ivN180', 'ivN360',
  ];
  assert(
    JSON.stringify(SYMBOL_METRIC_FIELDS) === JSON.stringify(EXPECTED_FIELDS),
    `SYMBOL_METRIC_FIELDS = ${SYMBOL_METRIC_FIELDS.join(', ')}`,
  );

  // Stage 2b: rank contract (Thread #163 / Task #185)
  assert(JSON.stringify(IV_RANK_WINDOWS) === JSON.stringify([30, 60, 180, 360]),
    `IV_RANK_WINDOWS = ${IV_RANK_WINDOWS.join(', ')}`);
  assert(IV_RANK_LATEST_COLLECTION === 'iv-rank-latest', 'iv-rank-latest collection const');
  const latest: IvRankLatestDoc = {
    symbol: 'QQQ', asOfDate: '2026-01-07',
    ivRank30: 41, ivPct30: 52, ivN30: 22,
    updatedAt: { seconds: 1_700_000_000, nanoseconds: 0 },
  };
  assert(JSON.parse(JSON.stringify(latest)).ivRank30 === 41, 'IvRankLatestDoc survives JSON round-trip');

  // Stage 3: assemble a real year doc + wire row
  const day: SymbolMetricDayEntry = { iv30: 0.2841, iv30Method: 'interpolated', iv30Contracts: 2972 };
  const doc: SymbolMetricsYearDoc = {
    symbol: 'QQQ',
    year: 2026,
    days: { '2026-01-07': day },
    updatedAt: { seconds: 1_700_000_000, nanoseconds: 0 },
  };
  assert(JSON.parse(JSON.stringify(doc)).days['2026-01-07'].iv30 === 0.2841, 'year doc survives JSON round-trip');

  const row: IvMetricsRow = { date: '2026-01-07', ...doc.days['2026-01-07'] };
  assert(row.date === '2026-01-07' && row.iv30 === 0.2841, 'IvMetricsRow = date + entry fields');
  assert(
    Object.keys(row).every((k) => k === 'date' || (SYMBOL_METRIC_FIELDS as readonly string[]).includes(k)),
    'row keys stay within the field whitelist',
  );

  console.log('\n=== All verification checks passed ===');
  process.exit(0);
}

main();
