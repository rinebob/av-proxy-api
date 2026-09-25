/**
 * Verification script for Task #127 — sweepSwingSets / backfillSwingSets core.
 *
 * Exercises runSwingSetSweep against prod Firestore:
 * - Enumerates only tracked-symbols with optionsEnabled === true
 * - Freshness skip when all four canonical docs are within the TTL
 * - Stale/missing docs → generation runs (ZZTEST has no daily-adjusted data
 *   → graceful no-data skip proves the path)
 * - force regenerates past freshness; symbols subset still gates on enabled
 * - Per-symbol failure isolation
 *
 * Mutating — writes then deletes tracked-symbols/ZZTEST and
 * options-swing-sets/ZZTEST_*. Writing the tracked doc fires onSymbolAdded,
 * which asynchronously recreates it (poll-delete cleanup handles that — the
 * trigger awaits three AV fetches before rewriting, so settling can take
 * 30-90s). Aborts if ZZTEST already exists. Not in run-all.
 *
 * Usage:
 *   npx ts-node -r tsconfig-paths/register -P scripts/tsconfig.json scripts/verify/options-data-127-swing-set-sweep.ts
 */
import * as admin from 'firebase-admin';
import { FirestoreCollection } from '@shared/firestore';
import { CANONICAL_ZIGZAG_CONFIGS, deriveParamsId } from '@shared/zigzag';
import type { SwingSetDoc } from '@shared/zigzag';

if (!admin.apps.length) {
  admin.initializeApp({ projectId: 'alpha-vantage-proxy-api' });
}
const db = admin.firestore();

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { DailyAdjustedReader } = require('../../src/v2/swing-set/services/daily-adjusted-reader.service');
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { SwingSetRepository } = require('../../src/v2/swing-set/services/swing-set.repository');
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { SwingSetGenerationService } = require('../../src/v2/swing-set/services/swing-set-generation.service');
const {
  runSwingSetSweep,
  // eslint-disable-next-line @typescript-eslint/no-var-requires
} = require('../../src/v2/swing-set/handlers/swing-set-sweep.core');
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { SWING_SET_FRESHNESS_TTL_MS } = require('../../src/v2/swing-set/handlers/generate-swing-sets.core');

function assert(condition: boolean, message: string): void {
  if (!condition) {
    console.error('FAIL: ' + message);
    process.exit(1);
  }
  console.log('PASS: ' + message);
}

const SYMBOL = 'ZZTEST';
const TRACKED_PATH = `${FirestoreCollection.TRACKED_SYMBOLS}/${SYMBOL}`;
// onSymbolAdded also writes symbol-data/{SYM} (and attempts time-series docs)
// — delete those too so the probe leaves no residue.
const SYMBOL_DATA_PATH = `symbol-data/${SYMBOL}`;

function zeroDist() {
  return { mean: 0, median: 0, stdDev: 0, min: 0, max: 0, p10: 0, p25: 0, p50: 0, p75: 0, p90: 0 };
}

function seedDoc(paramsId: string, config: (typeof CANONICAL_ZIGZAG_CONFIGS)[number], ageMs: number): SwingSetDoc {
  const dir = { count: 0, magnitudePercent: zeroDist(), magnitudeAbsolute: zeroDist(), duration: zeroDist(), magnitudeHistogram: { bins: [] }, durationHistogram: { bins: [] } };
  return {
    symbol: SYMBOL,
    paramsId,
    config,
    pivots: [],
    projection: null,
    swings: [],
    stats: { up: dir, down: dir },
    generatedAt: { seconds: Math.floor((Date.now() - ageMs) / 1000), nanoseconds: 0 },
    source: 'sa',
  };
}

async function seedSwingDocs(ageMs: number): Promise<void> {
  const repo = new SwingSetRepository(db);
  for (const c of CANONICAL_ZIGZAG_CONFIGS) {
    await repo.upsert(seedDoc(deriveParamsId(c), c, ageMs));
  }
}

async function cleanup(): Promise<void> {
  await db.doc(TRACKED_PATH).delete().catch(() => undefined);
  await db.doc(SYMBOL_DATA_PATH).delete().catch(() => undefined);
  for (const c of CANONICAL_ZIGZAG_CONFIGS) {
    await db.doc(`${FirestoreCollection.OPTIONS_SWING_SETS}/${SYMBOL}_${deriveParamsId(c)}`).delete().catch(() => undefined);
  }
  // onSymbolAdded recreates tracked-symbols/ZZTEST asynchronously after three
  // AV fetches — poll-delete until it stays absent across two ~15s checks.
  let absentStreak = 0;
  for (let i = 0; i < 8 && absentStreak < 2; i++) {
    await new Promise((r) => setTimeout(r, 15_000));
    const snap = await db.doc(TRACKED_PATH).get().catch(() => null);
    if (snap?.exists) {
      absentStreak = 0;
      await db.doc(TRACKED_PATH).delete().catch(() => undefined);
      await db.doc(SYMBOL_DATA_PATH).delete().catch(() => undefined);
      console.log(`cleanup: onSymbolAdded recreated ${TRACKED_PATH} — re-deleted (attempt ${i + 1})`);
    } else {
      absentStreak++;
    }
  }
}

async function main(): Promise<void> {
  console.log('--- Verifying swing-set sweep core against prod ---\n');
  const repo = new SwingSetRepository(db);
  const service = new SwingSetGenerationService(new DailyAdjustedReader(db), repo, console);
  const deps = { repository: repo, generation: service, logger: console };

  const preExisting = await db.doc(TRACKED_PATH).get();
  if (preExisting.exists) {
    console.error(`FAIL: ${TRACKED_PATH} already exists — refusing to overwrite.`);
    process.exit(1);
  }

  try {
    // --- baseline: sweep without ZZTEST → whatever prod enabled set is ---
    const baseline = await runSwingSetSweep(db, deps);
    console.log(`baseline: checked=${baseline.checked} fresh=${baseline.fresh.length} generated=${baseline.generated.length} noData=${baseline.skippedNoData.length} failed=${baseline.failed.length}`);
    assert(!baseline.generated.includes(SYMBOL) && !baseline.failed.some((f: { symbol: string }) => f.symbol === SYMBOL), 'baseline: ZZTEST absent from results (untracked)');

    // --- enable ZZTEST → sweep picks it up, no bars → no-data skip ---
    await db.doc(TRACKED_PATH).set({ symbol: SYMBOL, optionsEnabled: true });
    const r1 = await runSwingSetSweep(db, deps);
    assert(r1.checked === baseline.checked + 1, 'sweep: ZZTEST counted when optionsEnabled=true');
    assert(r1.skippedNoData.includes(SYMBOL), 'sweep: ZZTEST → no-data skip (graceful, not a failure)');

    // --- freshness: seed all four docs fresh → sweep skips ---
    await seedSwingDocs(60_000);
    const r2 = await runSwingSetSweep(db, deps);
    assert(r2.fresh.includes(SYMBOL) && !r2.generated.includes(SYMBOL), 'sweep: fresh ZZTEST docs → skipped');

    // --- stale docs → generation runs ---
    await seedSwingDocs(SWING_SET_FRESHNESS_TTL_MS + 60_000);
    const r3 = await runSwingSetSweep(db, deps);
    assert(r3.skippedNoData.includes(SYMBOL), 'sweep: stale docs → generation ran (skipped only for missing bars)');

    // --- force bypasses freshness ---
    await seedSwingDocs(60_000);
    const r4 = await runSwingSetSweep(db, { ...deps, force: true });
    assert(r4.skippedNoData.includes(SYMBOL) && !r4.fresh.includes(SYMBOL), 'sweep force: fresh docs regenerated anyway');

    // --- symbols subset gates on optionsEnabled ---
    const r5 = await runSwingSetSweep(db, { ...deps, symbols: [SYMBOL, 'ZZNOTTRACKED'] });
    assert(r5.excludedNotEnabled.includes('ZZNOTTRACKED'), 'sweep subset: untracked symbol excluded');

    // --- disable → sweep ignores ZZTEST again ---
    await db.doc(TRACKED_PATH).set({ optionsEnabled: false }, { merge: true });
    const r6 = await runSwingSetSweep(db, deps);
    assert(!r6.generated.includes(SYMBOL) && !r6.skippedNoData.includes(SYMBOL) && !r6.fresh.includes(SYMBOL), 'sweep: optionsEnabled=false → ZZTEST not swept');
  } finally {
    await cleanup();
    console.log(`cleanup: deleted ${TRACKED_PATH} + ${SYMBOL}_* swing docs`);
  }

  const leftoverTracked = await db.doc(TRACKED_PATH).get();
  assert(!leftoverTracked.exists, 'tracked ZZTEST doc deleted (post onSymbolAdded settle)');
  const leftover = await repo.listBySymbol(SYMBOL);
  assert(leftover.length === 0, 'all ZZTEST swing docs deleted');

  console.log('\n=== All verification checks passed ===');
  process.exit(0);
}

main().catch((err) => {
  console.error('FAIL: ' + (err instanceof Error ? err.message : String(err)));
  process.exit(1);
});
