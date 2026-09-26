/**
 * Verification script for Task #124 — swing-set data layer.
 *
 * Verifies both pipeline components against prod Firestore:
 * - DailyAdjustedReader: reads real year-sharded daily bars, returns
 *   DailyAdjustedBar[] ascending, maps to PriceBar for the engine.
 * - SwingSetRepository: writes a probe doc to options-swing-sets/ZZTEST_*,
 *   reads it back via get/listBySymbol/listConfirmedPivotDates/getCurrentSwing,
 *   then DELETES the probe doc (setup/teardown built in).
 *   Slim doc shape (post-#152): pivotDates + currentExtremeDate only.
 *
 * Writes exactly one temporary doc (`ZZTEST_...`) and removes it on success
 * or failure.
 *
 * Usage:
 *   npx ts-node -r tsconfig-paths/register -P scripts/tsconfig.json scripts/verify/options-data-124-swing-set-data-layer.ts [SYMBOL]
 *   Default SYMBOL: AAPL (read source); the write probe always uses ZZTEST.
 */
import * as admin from 'firebase-admin';
import { FirestoreCollection } from '@shared/firestore';
import { deriveParamsId, CORPUS_ZIGZAG_CONFIG } from '@shared/zigzag';
import type { SwingSetDoc } from '@shared/zigzag';

if (!admin.apps.length) {
  admin.initializeApp({ projectId: 'alpha-vantage-proxy-api' });
}
const db = admin.firestore();

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { DailyAdjustedReader } = require('../../src/v2/swing-set/services/daily-adjusted-reader.service');
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { SwingSetRepository } = require('../../src/v2/swing-set/services/swing-set.repository');

function assert(condition: boolean, message: string): void {
  if (!condition) {
    console.error('FAIL: ' + message);
    process.exit(1);
  }
  console.log('PASS: ' + message);
}

const PROBE_SYMBOL = 'ZZTEST';
const PROBE_PARAMS_ID = deriveParamsId(CORPUS_ZIGZAG_CONFIG);
const PROBE_DOC_ID = `${PROBE_SYMBOL}_${PROBE_PARAMS_ID}`;

async function main(): Promise<void> {
  const symbol = (process.argv[2] ?? 'AAPL').toUpperCase();
  const reader = new DailyAdjustedReader(db);
  const repo = new SwingSetRepository(db);
  console.log(`--- Verifying swing-set data layer (read source: ${symbol}, probe: ${PROBE_SYMBOL}) ---\n`);

  // Stage 1: DailyAdjustedReader against real prod bars
  const bars = await reader.read(symbol);
  assert(bars.length > 200, `${symbol}: reader returned ${bars.length} DailyAdjustedBar entries`);
  const ascending = bars.every((b: { date: string }, i: number) => i === 0 || b.date > bars[i - 1].date);
  assert(ascending, 'bars are in strictly ascending date order');
  const withAdjusted = bars.filter((b: { adjustedClose: number }) => Number.isFinite(b.adjustedClose));
  assert(withAdjusted.length === bars.length, 'every bar carries a finite adjustedClose');

  const priceBar = DailyAdjustedReader.toPriceBar(bars[bars.length - 1]);
  assert(
    priceBar.close === bars[bars.length - 1].adjustedClose,
    'toPriceBar maps adjustedClose → close',
  );
  assert(
    priceBar.x.toISOString().slice(0, 10) === bars[bars.length - 1].date,
    'toPriceBar maps date → x (UTC midnight)',
  );

  // Stage 2: SwingSetRepository — write probe doc, read back, delete.
  // Slim shape: confirmed pivot dates + current developing extreme (a
  // projected low on 2026-01-16 → 'down').
  const probeDoc: SwingSetDoc = {
    symbol: PROBE_SYMBOL,
    paramsId: PROBE_PARAMS_ID,
    config: CORPUS_ZIGZAG_CONFIG,
    pivotDates: ['2026-01-02', '2026-01-09'],
    currentExtremeDate: '2026-01-16',
    currentDirection: 'down',
    generatedAt: { seconds: Math.floor(Date.now() / 1000), nanoseconds: 0 },
    source: 'sa',
  };

  try {
    await repo.upsert(probeDoc);
    assert(true, `upsert wrote options-swing-sets/${PROBE_DOC_ID}`);

    const got = await repo.get(PROBE_SYMBOL, PROBE_PARAMS_ID);
    assert(got !== null && got.symbol === PROBE_SYMBOL && got.paramsId === PROBE_PARAMS_ID,
      'get returns the probe doc');

    const listed = await repo.listBySymbol(PROBE_SYMBOL);
    assert(listed.some((d: SwingSetDoc) => d.paramsId === PROBE_PARAMS_ID),
      `listBySymbol('${PROBE_SYMBOL}') includes the probe doc`);

    const pivotDates = await repo.listConfirmedPivotDates(PROBE_SYMBOL, PROBE_PARAMS_ID);
    assert(pivotDates.length === 2,
      `listConfirmedPivotDates returns ${pivotDates.length} confirmed pivot dates`);

    const cur = await repo.getCurrentSwing(PROBE_SYMBOL, PROBE_PARAMS_ID);
    assert(cur !== null && cur.direction === 'down' && cur.extremeDate === '2026-01-16',
      `getCurrentSwing → direction=${cur?.direction}, extremeDate=${cur?.extremeDate}`);

    const missing = await repo.get('NOSUCHSYM', PROBE_PARAMS_ID);
    assert(missing === null, 'get returns null for a missing doc');
  } finally {
    await db.doc(`${FirestoreCollection.OPTIONS_SWING_SETS}/${PROBE_DOC_ID}`).delete();
    console.log(`cleanup: deleted options-swing-sets/${PROBE_DOC_ID}`);
  }

  // Confirm the probe is gone
  const gone = await repo.get(PROBE_SYMBOL, PROBE_PARAMS_ID);
  assert(gone === null, 'probe doc deleted');

  console.log('\n=== All verification checks passed ===');
  process.exit(0);
}

main().catch((err) => {
  console.error('FAIL: ' + (err instanceof Error ? err.message : String(err)));
  process.exit(1);
});
