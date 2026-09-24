/**
 * Verification script for Task #122 — SA ZigZag engine port into shared/zigzag.
 *
 * Runs the compiled shared package (`shared/lib/zigzag`) against REAL daily
 * bars from prod Firestore:
 *   symbol-data/{SYMBOL}/sa-time-series/av-daily-adjusted/years/{YYYY}
 * Each year doc holds `bars: CompactBar[]` (t, d, o, h, l, c, v, ac, dv, sc, ...).
 *
 * Verifies:
 * - The compiled @shared/zigzag module resolves and exports the engine API.
 * - computeZigZagPivots produces confirmed, alternating, time-ascending pivots
 *   on real daily-adjusted data.
 * - deriveSwings produces pivots.length - 1 (+projection) swings with sane
 *   direction/magnitude fields.
 * - computeSwingStats counts match the confirmed-swing direction breakdown.
 * - Non-default configs (e.g. 10/10/10, 2/2/2) also run cleanly.
 *
 * Read-only — no writes.
 *
 * Usage:
 *   npx ts-node -r tsconfig-paths/register -P scripts/tsconfig.json scripts/verify/options-data-122-zigzag-engine.ts [SYMBOL]
 *   Default SYMBOL: AAPL
 */
import * as admin from 'firebase-admin';
import {
  computeZigZagPivots,
  deriveSwings,
  computeSwingStats,
  DEFAULT_CONFIG,
} from '@shared/zigzag';
import type { Pivot, PriceBar, ZigZagConfig, ZigZagResult } from '@shared/zigzag';
import type { CompactBar } from '@shared/alpha-vantage';
import { AlphaVantageEndpoint } from '@shared/alpha-vantage';
import { ApiProvider } from '@shared/core';
import { getSymbolTimeSeriesYearsCollectionPath } from '../../src/v2/common/firestore/firestore-paths';

if (!admin.apps.length) {
  admin.initializeApp({ projectId: 'alpha-vantage-proxy-api' });
}
const db = admin.firestore();

function assert(condition: boolean, message: string): void {
  if (!condition) {
    console.error('FAIL: ' + message);
    process.exit(1);
  }
  console.log('PASS: ' + message);
}

/** Read all year-sharded daily-adjusted bars for a symbol, ascending by time. */
async function readDailyBars(symbol: string): Promise<PriceBar[]> {
  const yearsPath = getSymbolTimeSeriesYearsCollectionPath(
    symbol, AlphaVantageEndpoint.TIME_SERIES_DAILY_ADJUSTED, ApiProvider.ALPHA_VANTAGE,
  );
  const yearsSnap = await db.collection(yearsPath).get();
  assert(yearsSnap.size > 0, `${yearsPath} has ${yearsSnap.size} year docs`);

  const bars: PriceBar[] = [];
  for (const yearDoc of yearsSnap.docs) {
    const compact = (yearDoc.get('bars') ?? []) as CompactBar[];
    for (const b of compact) {
      // Engine reads high/low for pivots and close for downstream consumers;
      // skip bars missing any of them rather than silently defaulting to 0.
      // `open` is optional in CompactBar and unused by the engine — fall back
      // to close when absent.
      if (!Number.isFinite(b.h) || !Number.isFinite(b.l) || !Number.isFinite(b.c)) continue;
      const date = b.d ?? new Date(b.t).toISOString().slice(0, 10);
      bars.push({
        date,
        x: new Date(b.t),
        open: b.o ?? b.c!,
        high: b.h!,
        low: b.l!,
        close: b.c!,
        volume: b.v,
      });
    }
  }
  bars.sort((a, b) => a.x.getTime() - b.x.getTime());
  return bars;
}

function checkResult(symbol: string, label: string, result: ZigZagResult): void {
  const { pivots } = result;
  assert(pivots.length > 0, `${label}: ${symbol} produced ${pivots.length} confirmed pivots`);

  // All confirmed pivots carry confirmed=true
  assert(
    pivots.every((p: Pivot) => p.confirmed === true),
    `${label}: all ${pivots.length} pivots are confirmed`,
  );

  // Pivot times are non-decreasing; equal times are only allowed for a
  // same-bar high+low pair (allowZigZagOnOneBar=true)
  const ordered = pivots.every((p: Pivot, i: number) => {
    if (i === 0) return true;
    const prev = pivots[i - 1];
    if (p.time > prev.time) return true;
    return p.time === prev.time && p.barIndex === prev.barIndex && p.isHigh !== prev.isHigh;
  });
  assert(ordered, `${label}: pivots are in non-decreasing time order (equal only for same-bar high+low)`);

  // Pivots alternate high/low (same-direction candidates extend, never append)
  const alternating = pivots.every((p: Pivot, i: number) => i === 0 || p.isHigh !== pivots[i - 1].isHigh);
  assert(alternating, `${label}: pivots alternate high/low`);
}

async function main(): Promise<void> {
  const symbol = (process.argv[2] ?? 'AAPL').toUpperCase();
  console.log(`--- Verifying SA ZigZag engine against prod daily bars for ${symbol} ---\n`);

  // Stage 1: compiled shared package exports resolve
  assert(typeof computeZigZagPivots === 'function', 'computeZigZagPivots exported from @shared/zigzag');
  assert(typeof deriveSwings === 'function', 'deriveSwings exported from @shared/zigzag');
  assert(typeof computeSwingStats === 'function', 'computeSwingStats exported from @shared/zigzag');
  assert(DEFAULT_CONFIG.devThreshold === 5.0, 'DEFAULT_CONFIG exported with devThreshold=5.0');

  // Stage 2: real data ingestion
  const bars = await readDailyBars(symbol);
  assert(bars.length > 200, `${symbol}: loaded ${bars.length} daily bars from prod Firestore`);

  // Stage 3: engine computation on default config (5/5/5)
  const result = computeZigZagPivots(bars, DEFAULT_CONFIG);
  checkResult(symbol, '5/5/5', result);
  console.log(`  → 5/5/5: ${result.pivots.length} pivots, projection=${result.projection ? 'yes' : 'no'}`);

  // Stage 4: swings + stats consistency
  const swings = deriveSwings(result.pivots, bars, result.projection);
  const expectedSwingCount = result.pivots.length - 1 + (result.projection ? 1 : 0);
  assert(
    swings.length === expectedSwingCount,
    `deriveSwings produced ${swings.length} swings (expected ${expectedSwingCount})`,
  );
  assert(swings.length > 0, 'at least one swing produced');
  const lastSwing = swings[swings.length - 1];
  assert(
    lastSwing.confirmed === !result.projection,
    `last swing confirmed=${lastSwing.confirmed} (projection ${result.projection ? 'present' : 'absent'})`,
  );

  const stats = computeSwingStats(swings);
  const confirmedUp = swings.filter(s => s.confirmed && s.direction === 'up').length;
  const confirmedDown = swings.filter(s => s.confirmed && s.direction === 'down').length;
  assert(stats.up.count === confirmedUp, `stats.up.count=${stats.up.count} matches ${confirmedUp} confirmed up swings`);
  assert(stats.down.count === confirmedDown, `stats.down.count=${stats.down.count} matches ${confirmedDown} confirmed down swings`);

  // Stage 5: non-default configs run cleanly
  for (const [dev, depth] of [[10, 10], [2, 2]] as const) {
    const cfg: ZigZagConfig = { ...DEFAULT_CONFIG, devThreshold: dev, leftDepth: depth, rightDepth: depth };
    const r = computeZigZagPivots(bars, cfg);
    checkResult(symbol, `${dev}/${depth}/${depth}`, r);
    console.log(`  → ${dev}/${depth}/${depth}: ${r.pivots.length} pivots`);
  }

  // Stage 6: last confirmed pivot lands on a real bar date
  const lastPivot = result.pivots[result.pivots.length - 1];
  const pivotDate = bars[lastPivot.barIndex].date;
  assert(
    new Date(lastPivot.time).toISOString().slice(0, 10) === pivotDate,
    `last pivot time maps to bar date ${pivotDate}`,
  );

  console.log('\n=== All verification checks passed ===');
  process.exit(0);
}

main().catch((err) => {
  console.error('FAIL: ' + (err instanceof Error ? err.message : String(err)));
  process.exit(1);
});
