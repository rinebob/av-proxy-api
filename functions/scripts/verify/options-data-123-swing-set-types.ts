/**
 * Verification script for Task #123 — swing-set types, paramsId, corpus config.
 *
 * Verifies the compiled shared package exports and the swing-set doc assembly
 * seam the BE service uses:
 * - CORPUS_ZIGZAG_CONFIG is the 2/2/2 config — its pivot dates cover every
 *   ≥2% extreme for corpus date sampling.
 * - deriveParamsId produces the expected paramsId
 *   (dev2_L2_R2_1barY_projY) and is deterministic.
 * - A real SwingSetDoc can be assembled end-to-end:
 *   prod daily bars → computeZigZagPivots → pivotDates/currentExtreme fields.
 *
 * Read-only — no writes.
 *
 * Usage:
 *   npx ts-node -r tsconfig-paths/register -P scripts/tsconfig.json scripts/verify/options-data-123-swing-set-types.ts [SYMBOL]
 *   Default SYMBOL: AAPL
 */
import * as admin from 'firebase-admin';
import {
  CORPUS_ZIGZAG_CONFIG,
  computeZigZagPivots,
  deriveParamsId,
} from '@shared/zigzag';
import type { PriceBar, SwingSetDoc } from '@shared/zigzag';

if (!admin.apps.length) {
  admin.initializeApp({ projectId: 'alpha-vantage-proxy-api' });
}
const db = admin.firestore();

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { DailyAdjustedReader } = require('../../src/v2/swing-set/services/daily-adjusted-reader.service');

function assert(condition: boolean, message: string): void {
  if (!condition) {
    console.error('FAIL: ' + message);
    process.exit(1);
  }
  console.log('PASS: ' + message);
}

async function readDailyBars(symbol: string): Promise<PriceBar[]> {
  const adjusted = await new DailyAdjustedReader(db).read(symbol);
  assert(adjusted.length > 0, `${symbol}: DailyAdjustedReader returned ${adjusted.length} bars`);
  return adjusted.map((b: { date: string }) => DailyAdjustedReader.toPriceBar(b));
}

async function main(): Promise<void> {
  const symbol = (process.argv[2] ?? 'AAPL').toUpperCase();
  console.log(`--- Verifying swing-set types + paramsId against prod bars for ${symbol} ---\n`);

  // Stage 1: compiled export + corpus config values
  const c = CORPUS_ZIGZAG_CONFIG;
  assert(c.devThreshold === 2 && c.leftDepth === 2 && c.rightDepth === 2, 'CORPUS_ZIGZAG_CONFIG is 2/2/2');
  assert(c.allowZigZagOnOneBar === true && c.projectionPivots === true, 'corpus config enables one-bar pivots + projections');

  // Stage 2: paramsId contract — deterministic
  const expectedId = 'dev2_L2_R2_1barY_projY';
  assert(deriveParamsId(c) === expectedId, `paramsId = ${deriveParamsId(c)}`);
  assert(deriveParamsId(c) === deriveParamsId({ ...c }), 'deriveParamsId is deterministic for identical inputs');

  // Stage 3: assemble a real SwingSetDoc from prod data
  const bars = await readDailyBars(symbol);
  assert(bars.length > 200, `${symbol}: loaded ${bars.length} daily bars`);

  const paramsId = deriveParamsId(c);
  const result = computeZigZagPivots(bars, c);

  const last = result.pivots[result.pivots.length - 1];
  const doc: SwingSetDoc = {
    symbol,
    paramsId,
    config: c,
    pivotDates: result.pivots.map((p) => new Date(p.time).toISOString().slice(0, 10)),
    currentExtremeDate: result.projection
      ? new Date(result.projection.time).toISOString().slice(0, 10)
      : last
        ? new Date(last.time).toISOString().slice(0, 10)
        : null,
    currentDirection: result.projection
      ? (result.projection.isHigh ? 'up' : 'down')
      : last
        ? (last.isHigh ? 'down' : 'up')
        : null,
    generatedAt: { seconds: Math.floor(Date.now() / 1000), nanoseconds: 0 },
    source: 'sa',
  };

  assert(doc.paramsId === expectedId, `${paramsId}: doc.paramsId matches expected id`);
  assert(doc.pivotDates.length === result.pivots.length,
    `${paramsId}: pivotDates length matches confirmed pivots`);
  console.log(`  → ${paramsId}: ${doc.pivotDates.length} pivot dates, extreme=${doc.currentExtremeDate}, docKey=${symbol}_${paramsId}`);

  console.log('\n=== All verification checks passed ===');
  process.exit(0);
}

main().catch((err) => {
  console.error('FAIL: ' + (err instanceof Error ? err.message : String(err)));
  process.exit(1);
});
