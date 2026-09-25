/**
 * Verification script for Task #128 — partnerSwingSetsV2 handler.
 *
 * Exercises swingSetsPartnerHandler against prod Firestore with the real
 * getTrackedFlags + SwingSetRepository deps; auth is stubbed at the deps seam
 * (the auth paths are covered by unit tests — OIDC tokens can't be minted
 * locally, and the endpoint isn't deployed yet).
 *
 * Mutating — writes then deletes tracked-symbols/ZZTEST +
 * options-swing-sets/ZZTEST_*. Writing the tracked doc fires onSymbolAdded,
 * which asynchronously recreates it (poll-delete cleanup). Aborts if ZZTEST
 * already exists. Not in run-all.
 *
 * Usage:
 *   npx ts-node -r tsconfig-paths/register -P scripts/tsconfig.json scripts/verify/options-data-128-partner-swing-sets.ts
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
const { SwingSetRepository } = require('../../src/v2/swing-set/services/swing-set.repository');
const {
  swingSetsPartnerHandler,
  SwingSetsErrorCode,
  // eslint-disable-next-line @typescript-eslint/no-var-requires
} = require('../../src/v2/partner/swing-sets-partner');

function assert(condition: boolean, message: string): void {
  if (!condition) {
    console.error('FAIL: ' + message);
    process.exit(1);
  }
  console.log('PASS: ' + message);
}

const SYMBOL = 'ZZTEST';
const TRACKED_PATH = `${FirestoreCollection.TRACKED_SYMBOLS}/${SYMBOL}`;
const SYMBOL_DATA_PATH = `symbol-data/${SYMBOL}`;

function zeroDist() {
  return { mean: 0, median: 0, stdDev: 0, min: 0, max: 0, p10: 0, p25: 0, p50: 0, p75: 0, p90: 0 };
}

function seedDoc(config: (typeof CANONICAL_ZIGZAG_CONFIGS)[number]): SwingSetDoc {
  const dir = { count: 0, magnitudePercent: zeroDist(), magnitudeAbsolute: zeroDist(), duration: zeroDist(), magnitudeHistogram: { bins: [] }, durationHistogram: { bins: [] } };
  return {
    symbol: SYMBOL,
    paramsId: deriveParamsId(config),
    config,
    pivots: [],
    projection: null,
    swings: [],
    stats: { up: dir, down: dir },
    generatedAt: { seconds: Math.floor(Date.now() / 1000), nanoseconds: 0 },
    source: 'sa',
  };
}

interface State { statusCode?: number; body?: any }

/** Real prod deps; auth stubbed at the documented deps seam. */
function makeDeps() {
  const repository = new SwingSetRepository(db);
  return {
    authenticateRequest: async () => ({ serviceAccountEmail: 'verify@local' }),
    hasExpectedGoogleAudience: () => true,
    getTrackedFlags: async (symbol: string) => {
      const snap = await db.collection(FirestoreCollection.TRACKED_SYMBOLS).doc(symbol).get();
      const data = snap.data() as { optionsEnabled?: boolean } | undefined;
      return { tracked: snap.exists, optionsEnabled: data?.optionsEnabled === true };
    },
    getSwingSet: (s: string, p: string) => repository.get(s, p),
    listSwingSets: (s: string) => repository.listBySymbol(s),
    now: () => new Date(),
  };
}

async function call(query: Record<string, unknown>) {
  const state: State = {};
  const res = {
    status(c: number) { state.statusCode = c; return this; },
    json(b: any) { state.body = b; return this; },
  };
  await swingSetsPartnerHandler({ method: 'GET', query }, res, makeDeps());
  return state;
}

async function cleanup(): Promise<void> {
  await db.doc(TRACKED_PATH).delete().catch(() => undefined);
  await db.doc(SYMBOL_DATA_PATH).delete().catch(() => undefined);
  for (const c of CANONICAL_ZIGZAG_CONFIGS) {
    await db.doc(`${FirestoreCollection.OPTIONS_SWING_SETS}/${SYMBOL}_${deriveParamsId(c)}`).delete().catch(() => undefined);
  }
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
  console.log('--- Verifying partnerSwingSetsV2 handler against prod ---\n');

  const preExisting = await db.doc(TRACKED_PATH).get();
  if (preExisting.exists) {
    console.error(`FAIL: ${TRACKED_PATH} already exists — refusing to overwrite.`);
    process.exit(1);
  }

  try {
    // --- untracked → 404 ---
    let r = await call({ symbol: 'ZZNOPE' });
    assert(r.statusCode === 404 && r.body?.code === SwingSetsErrorCode.NOT_FOUND, 'untracked symbol → 404 NOT_FOUND');

    // --- tracked, not enabled → 403 OPTIONS_NOT_ENABLED ---
    await db.doc(TRACKED_PATH).set({ symbol: SYMBOL, optionsEnabled: false });
    r = await call({ symbol: SYMBOL });
    assert(r.statusCode === 403 && r.body?.code === SwingSetsErrorCode.OPTIONS_NOT_ENABLED, 'optionsEnabled=false → 403 OPTIONS_NOT_ENABLED');

    // --- enabled, no swing docs → 404 ---
    await db.doc(TRACKED_PATH).set({ optionsEnabled: true }, { merge: true });
    r = await call({ symbol: SYMBOL });
    assert(r.statusCode === 404 && r.body?.code === SwingSetsErrorCode.NOT_FOUND, 'enabled + no docs → 404 NOT_FOUND');

    // --- seed docs → single-paramsId + all-docs responses ---
    const repo = new SwingSetRepository(db);
    for (const c of CANONICAL_ZIGZAG_CONFIGS) await repo.upsert(seedDoc(c));

    const paramsId = deriveParamsId(CANONICAL_ZIGZAG_CONFIGS[0]);
    r = await call({ symbol: 'zztest', paramsId });
    assert(r.statusCode === 200 && r.body?.ok === true && r.body?.data?.paramsId === paramsId, `single doc: ?paramsId=${paramsId} → 200 with doc`);
    assert(r.body?.source === 'sa' && typeof r.body?.processingTimeMs === 'number', 'envelope: source=sa, processingTimeMs present');

    r = await call({ symbol: SYMBOL });
    const keys = Object.keys(r.body?.data ?? {}).sort();
    assert(r.statusCode === 200 && keys.length === CANONICAL_ZIGZAG_CONFIGS.length, `omitted paramsId → 200 with ${keys.length} docs keyed by paramsId`);

    r = await call({ symbol: SYMBOL, paramsId: 'nonexistent' });
    assert(r.statusCode === 404 && r.body?.code === SwingSetsErrorCode.NOT_FOUND, 'missing paramsId → 404 NOT_FOUND');
  } finally {
    await cleanup();
    console.log(`cleanup: deleted ${TRACKED_PATH} + ${SYMBOL}_* swing docs`);
  }

  const leftover = await db.doc(TRACKED_PATH).get();
  assert(!leftover.exists, 'tracked ZZTEST doc deleted (post onSymbolAdded settle)');
  const leftoverDocs = await new SwingSetRepository(db).listBySymbol(SYMBOL);
  assert(leftoverDocs.length === 0, 'all ZZTEST swing docs deleted');

  console.log('\n=== All verification checks passed ===');
  process.exit(0);
}

main().catch((err) => {
  console.error('FAIL: ' + (err instanceof Error ? err.message : String(err)));
  process.exit(1);
});
