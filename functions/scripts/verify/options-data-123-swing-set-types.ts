/**
 * Verification script for Task #123 — swing-set types, paramsId, canonical configs.
 *
 * Verifies the compiled shared package exports and the swing-set doc assembly
 * seam the BE service will use:
 * - CANONICAL_ZIGZAG_CONFIGS matches the four documented parameter sets.
 * - deriveParamsId produces the exact ST-compatible ids
 *   (dev{N}_L{N}_R{N}_1barY_projY) and is stable/deterministic.
 * - A real SwingSetDoc can be assembled end-to-end: prod daily bars →
 *   computeZigZagPivots + deriveSwings + computeSwingStats → doc fields
 *   consistent (paramsId ↔ config, pivots ↔ swings count, source='sa').
 *
 * Read-only — no writes.
 *
 * Usage:
 *   npx ts-node -r tsconfig-paths/register -P scripts/tsconfig.json scripts/verify/options-data-123-swing-set-types.ts [SYMBOL]
 *   Default SYMBOL: AAPL
 */
import * as admin from 'firebase-admin';
import {
  CANONICAL_ZIGZAG_CONFIGS,
  computeZigZagPivots,
  deriveParamsId,
  deriveSwings,
  computeSwingStats,
} from '@shared/zigzag';
import type { PriceBar, SwingSetDoc } from '@shared/zigzag';
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
      if (!Number.isFinite(b.h) || !Number.isFinite(b.l) || !Number.isFinite(b.c)) continue;
      bars.push({
        date: b.d ?? new Date(b.t).toISOString().slice(0, 10),
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

async function main(): Promise<void> {
  const symbol = (process.argv[2] ?? 'AAPL').toUpperCase();
  console.log(`--- Verifying swing-set types + paramsId against prod bars for ${symbol} ---\n`);

  // Stage 1: compiled exports + canonical config values
  assert(CANONICAL_ZIGZAG_CONFIGS.length === 4, 'CANONICAL_ZIGZAG_CONFIGS has 4 entries');
  const triples = CANONICAL_ZIGZAG_CONFIGS.map(c => `${c.devThreshold}/${c.leftDepth}/${c.rightDepth}`);
  assert(
    JSON.stringify(triples) === JSON.stringify(['10/10/10', '5/5/5', '3/3/3', '2/2/2']),
    `canonical triples = ${triples.join(', ')}`,
  );

  // Stage 2: paramsId contract — exact ST-compatible ids, deterministic
  const expectedIds = [
    'dev10_L10_R10_1barY_projY',
    'dev5_L5_R5_1barY_projY',
    'dev3_L3_R3_1barY_projY',
    'dev2_L2_R2_1barY_projY',
  ];
  const ids = CANONICAL_ZIGZAG_CONFIGS.map(deriveParamsId);
  assert(JSON.stringify(ids) === JSON.stringify(expectedIds), `paramsIds = ${ids.join(', ')}`);
  assert(
    deriveParamsId(CANONICAL_ZIGZAG_CONFIGS[0]) === deriveParamsId({ ...CANONICAL_ZIGZAG_CONFIGS[0] }),
    'deriveParamsId is deterministic for identical inputs',
  );
  assert(new Set(ids).size === 4, 'the four canonical paramsIds are distinct');

  // Stage 3: assemble a real SwingSetDoc from prod data for each canonical config
  const bars = await readDailyBars(symbol);
  assert(bars.length > 200, `${symbol}: loaded ${bars.length} daily bars`);

  for (let i = 0; i < CANONICAL_ZIGZAG_CONFIGS.length; i++) {
    const config = CANONICAL_ZIGZAG_CONFIGS[i];
    const paramsId = deriveParamsId(config);
    const result = computeZigZagPivots(bars, config);
    const swings = deriveSwings(result.pivots, bars, result.projection);
    const stats = computeSwingStats(swings);

    const doc: SwingSetDoc = {
      symbol,
      paramsId,
      config,
      pivots: result.pivots,
      projection: result.projection ?? null,
      swings,
      stats,
      generatedAt: { seconds: Math.floor(Date.now() / 1000), nanoseconds: 0 },
      source: 'sa',
    };

    // Cross-check assembled doc against the literal ST contract (not just the
    // value we assigned).
    assert(doc.paramsId === expectedIds[i], `${paramsId}: doc.paramsId matches ST literal`);
    assert(doc.swings.length === doc.pivots.length - 1 + (result.projection ? 1 : 0),
      `${paramsId}: swings count consistent with pivots+projection`);
    assert(
      doc.stats.up.count + doc.stats.down.count === swings.filter(s => s.confirmed).length,
      `${paramsId}: stats counts match confirmed swings`,
    );
    console.log(`  → ${paramsId}: ${doc.pivots.length} pivots, ${doc.swings.length} swings, docKey=${symbol}_${paramsId}`);
  }

  console.log('\n=== All verification checks passed ===');
  process.exit(0);
}

main().catch((err) => {
  console.error('FAIL: ' + (err instanceof Error ? err.message : String(err)));
  process.exit(1);
});
