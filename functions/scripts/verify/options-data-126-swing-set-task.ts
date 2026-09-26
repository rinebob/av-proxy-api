/**
 * Verification script for Task #126 — generateSwingSetsTask internals.
 *
 * Exercises the real seams against prod Firestore:
 * - enqueueSwingSetGeneration's optionsEnabled gate (tracked-symbols doc read
 *   + payload shape). The actual Cloud Tasks enqueue is stubbed — real
 *   queue.enqueue requires a deployed function + service-account signing,
 *   which this script can't do locally; the gate and payload are what matter.
 * - handleGenerateSwingSets: freshness skip, stale regeneration path, invalid
 *   payload ack, and the no-data graceful skip — all against the real
 *   SwingSetRepository + SwingSetGenerationService.
 *
 * Mutating — writes then deletes tracked-symbols/ZZTEST and
 * options-swing-sets/ZZTEST_*. Not in run-all.
 *
 * Usage:
 *   npx ts-node -r tsconfig-paths/register -P scripts/tsconfig.json scripts/verify/options-data-126-swing-set-task.ts
 */
import * as admin from 'firebase-admin';
import { FirestoreCollection } from '@shared/firestore';
import { CORPUS_ZIGZAG_CONFIG, deriveParamsId } from '@shared/zigzag';
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
  handleGenerateSwingSets,
  enqueueSwingSetGeneration,
  SWING_SET_FRESHNESS_TTL_MS,
  // eslint-disable-next-line @typescript-eslint/no-var-requires
} = require('../../src/v2/swing-set/handlers/generate-swing-sets.core');

function assert(condition: boolean, message: string): void {
  if (!condition) {
    console.error('FAIL: ' + message);
    process.exit(1);
  }
  console.log('PASS: ' + message);
}

const SYMBOL = 'ZZTEST';
const TRACKED_PATH = `${FirestoreCollection.TRACKED_SYMBOLS}/${SYMBOL}`;

function seedDoc(ageMs: number): SwingSetDoc {
  return {
    symbol: SYMBOL,
    paramsId: deriveParamsId(CORPUS_ZIGZAG_CONFIG),
    config: CORPUS_ZIGZAG_CONFIG,
    pivotDates: [],
    currentExtremeDate: null,
    currentDirection: null,
    generatedAt: { seconds: Math.floor((Date.now() - ageMs) / 1000), nanoseconds: 0 },
    source: 'sa',
  };
}

async function seedSwingDocs(ageMs: number): Promise<void> {
  await new SwingSetRepository(db).upsert(seedDoc(ageMs));
}

async function cleanup(): Promise<void> {
  await db.doc(TRACKED_PATH).delete().catch(() => undefined);
  await db.doc(`${FirestoreCollection.OPTIONS_SWING_SETS}/${SYMBOL}_${deriveParamsId(CORPUS_ZIGZAG_CONFIG)}`).delete().catch(() => undefined);
  // Writing tracked-symbols/ZZTEST fires the onSymbolAdded trigger, which
  // recreates the doc asynchronously — and only after it finishes three AV
  // fetches (daily/weekly/monthly full-history), so it can take 30-90s.
  // Poll: re-delete whenever the doc reappears, until it stays absent for
  // two consecutive checks ~15s apart.
  let absentStreak = 0;
  for (let i = 0; i < 8 && absentStreak < 2; i++) {
    await new Promise((r) => setTimeout(r, 15_000));
    const snap = await db.doc(TRACKED_PATH).get().catch(() => null);
    if (snap?.exists) {
      absentStreak = 0;
      await db.doc(TRACKED_PATH).delete().catch(() => undefined);
      console.log(`cleanup: onSymbolAdded recreated ${TRACKED_PATH} — re-deleted (attempt ${i + 1})`);
    } else {
      absentStreak++;
    }
  }
}

async function main(): Promise<void> {
  console.log('--- Verifying generateSwingSetsTask internals against prod ---\n');
  const repo = new SwingSetRepository(db);
  const service = new SwingSetGenerationService(new DailyAdjustedReader(db), repo, console);
  const deps = { repository: repo, generation: service, logger: console };

  const preExisting = await db.doc(TRACKED_PATH).get();
  if (preExisting.exists) {
    console.error(`FAIL: ${TRACKED_PATH} already exists — refusing to overwrite.`);
    process.exit(1);
  }

  try {
    // --- enqueue gate ---
    await db.doc(TRACKED_PATH).set({ symbol: SYMBOL, optionsEnabled: true });
    let lastPayload: unknown = null;
    const stubEnqueue = async (p: unknown) => { lastPayload = p; };

    assert(
      await enqueueSwingSetGeneration(db, 'zztest', { enqueue: stubEnqueue, logger: console }) === true,
      'enqueue: optionsEnabled=true → enqueued',
    );
    assert(
      JSON.stringify(lastPayload) === JSON.stringify({ symbol: SYMBOL }),
      `enqueue payload = ${JSON.stringify(lastPayload)}`,
    );

    await db.doc(TRACKED_PATH).set({ optionsEnabled: false }, { merge: true });
    assert(
      await enqueueSwingSetGeneration(db, SYMBOL, { enqueue: stubEnqueue, logger: console }) === false,
      'enqueue: optionsEnabled=false → not enqueued',
    );
    await db.doc(TRACKED_PATH).delete();
    assert(
      await enqueueSwingSetGeneration(db, SYMBOL, { enqueue: stubEnqueue, logger: console }) === false,
      'enqueue: untracked symbol → not enqueued',
    );

    // --- handler: invalid payload ---
    const bad = await handleGenerateSwingSets({ symbol: '' } as { symbol: string }, deps);
    assert(bad === 'invalid-payload', 'handler: empty symbol → invalid-payload (acked, no retry)');

    // --- handler: no data → graceful skip ---
    const noData = await handleGenerateSwingSets({ symbol: SYMBOL }, deps);
    assert(
      typeof noData === 'object' && noData.skipped === true,
      'handler: ZZTEST has no daily-adjusted data → generation skipped gracefully',
    );

    // --- handler: freshness gate ---
    await seedSwingDocs(60 * 1000); // 1 minute old → fresh
    const fresh = await handleGenerateSwingSets({ symbol: SYMBOL }, deps);
    assert(fresh === 'skipped-fresh', 'handler: fresh doc → skipped-fresh');

    await seedSwingDocs(SWING_SET_FRESHNESS_TTL_MS + 60_000); // stale
    const stale = await handleGenerateSwingSets({ symbol: SYMBOL }, deps);
    assert(
      typeof stale === 'object' && stale.skipped === true,
      'handler: stale docs → generation ran (skipped only because ZZTEST has no bars)',
    );

    // --- handler: missing doc → regenerate ---
    await cleanup();
    const missing = await handleGenerateSwingSets({ symbol: SYMBOL }, deps);
    assert(
      typeof missing === 'object' && missing.skipped === true,
      'handler: no corpus doc → generation ran',
    );
  } finally {
    await cleanup();
    console.log(`cleanup: deleted ${TRACKED_PATH} + ${SYMBOL}_* swing docs`);
  }

  const leftoverTracked = await db.doc(TRACKED_PATH).get();
  assert(!leftoverTracked.exists, 'tracked ZZTEST doc deleted');
  const leftover = await repo.listBySymbol(SYMBOL);
  assert(leftover.length === 0, 'all ZZTEST swing docs deleted');

  console.log('\n=== All verification checks passed ===');
  process.exit(0);
}

main().catch((err) => {
  console.error('FAIL: ' + (err instanceof Error ? err.message : String(err)));
  process.exit(1);
});
