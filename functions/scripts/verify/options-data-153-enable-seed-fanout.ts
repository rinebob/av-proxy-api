/**
 * Verification script for Task #153 — pivot-seed fanout.
 *
 * Exercises the real pipeline against prod: seeded corpus swing doc →
 * fanoutPivotSeeds → corpus run doc + item docs → real Cloud Tasks dispatch
 * → processHistoricalOptionsCorpusSeedTask worker terminal status.
 *
 * The probe symbol ZZTEST is NOT options-enabled, so the seed worker's
 * curation gate marks every item 'skipped' (options-disabled) — zero AV
 * calls, zero GCS writes — while still proving dispatch, worker execution,
 * and metadata tracking end to end.
 *
 * Mutating — writes then deletes one options-swing-sets doc and one
 * options_corpus_runs run (run doc + items subcollection). Not in run-all.
 *
 * Usage:
 *   npx ts-node -r tsconfig-paths/register -P scripts/tsconfig.json scripts/verify/options-data-153-enable-seed-fanout.ts
 */
import * as admin from 'firebase-admin';
import { FirestoreCollection } from '@shared/firestore';
import { CORPUS_ZIGZAG_CONFIG, deriveParamsId } from '@shared/zigzag';
import type { SwingSetDoc } from '@shared/zigzag';

if (!admin.apps.length) {
  // serviceAccountId lets the Admin SDK sign the task payload's OIDC token
  // via IAM (same identity the deployed functions dispatch as). Requires
  // the caller to have roles/iam.serviceAccountTokenCreator on this SA.
  admin.initializeApp({
    projectId: 'alpha-vantage-proxy-api',
    serviceAccountId:
      process.env.FIREBASE_SERVICE_ACCOUNT_ID ??
      'alpha-vantage-proxy-api@appspot.gserviceaccount.com',
  });
}
const db = admin.firestore();

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { fanoutPivotSeeds, createPivotSeedFanoutDeps } = require('../../src/v2/historical-options-corpus/services/pivot-seed-fanout');
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { OPTIONS_CORPUS_RUNS_COLLECTION, OPTIONS_CORPUS_ITEMS_SUBCOLLECTION } = require('../../src/v2/historical-options-corpus/types');

function assert(condition: boolean, message: string): void {
  if (!condition) {
    console.error('FAIL: ' + message);
    process.exit(1);
  }
  console.log('PASS: ' + message);
}

const SYMBOL = 'ZZTEST';
const PARAMS_ID = deriveParamsId(CORPUS_ZIGZAG_CONFIG);
const SWING_DOC_PATH = `${FirestoreCollection.OPTIONS_SWING_SETS}/${SYMBOL}_${PARAMS_ID}`;
const PIVOT_DATES = ['2026-01-05', '2026-02-03', '2026-03-09'];

async function seedSwingDoc(): Promise<void> {
  const doc: SwingSetDoc = {
    symbol: SYMBOL,
    paramsId: PARAMS_ID,
    config: CORPUS_ZIGZAG_CONFIG,
    pivotDates: PIVOT_DATES,
    currentExtremeDate: null,
    currentDirection: null,
    generatedAt: { seconds: Math.floor(Date.now() / 1000), nanoseconds: 0 } as any,
    source: 'sa',
  };
  await db.doc(SWING_DOC_PATH).set(doc);
}

async function cleanup(runId: string | null): Promise<void> {
  await db.doc(SWING_DOC_PATH).delete().catch(() => undefined);
  if (runId) {
    const items = await db.collection(OPTIONS_CORPUS_RUNS_COLLECTION).doc(runId).collection(OPTIONS_CORPUS_ITEMS_SUBCOLLECTION).listDocuments();
    for (const d of items) await d.delete().catch(() => undefined);
    await db.collection(OPTIONS_CORPUS_RUNS_COLLECTION).doc(runId).delete().catch(() => undefined);
  }
}

/** Poll item docs until all reach a terminal status (or timeout). */
async function awaitTerminal(runId: string, timeoutMs = 240_000): Promise<Map<string, string>> {
  const deadline = Date.now() + timeoutMs;
  const terminal = new Set(['success', 'permanent_failure', 'skipped', 'not_found']);
  while (Date.now() < deadline) {
    const snap = await db.collection(OPTIONS_CORPUS_RUNS_COLLECTION).doc(runId).collection(OPTIONS_CORPUS_ITEMS_SUBCOLLECTION).get();
    const statuses = new Map<string, string>(snap.docs.map((d) => [d.id, (d.data() as { status: string }).status]));
    if (statuses.size === PIVOT_DATES.length && [...statuses.values()].every((s) => terminal.has(s))) {
      return statuses;
    }
    await new Promise((r) => setTimeout(r, 5000));
  }
  return new Map();
}

async function main(): Promise<void> {
  console.log(`--- Verifying pivot-seed fanout against prod (${SYMBOL}) ---\n`);
  let runId: string | null = null;

  try {
    await seedSwingDoc();
    console.log(`seeded ${SWING_DOC_PATH} with ${PIVOT_DATES.length} pivot dates`);

    const result = await fanoutPivotSeeds(SYMBOL, createPivotSeedFanoutDeps());
    runId = result.runId;

    assert(result.runId !== null && result.enqueued === PIVOT_DATES.length,
      `fanout enqueued ${result.enqueued} seed tasks (run ${result.runId})`);

    const runDoc = (await db.collection(OPTIONS_CORPUS_RUNS_COLLECTION).doc(runId!).get()).data()!;
    assert(runDoc.totalItems === PIVOT_DATES.length && runDoc.status === 'in_progress',
      `run doc: totalItems=${runDoc.totalItems} status=${runDoc.status}`);
    assert(runDoc.startDate === PIVOT_DATES[0] && runDoc.endDate === PIVOT_DATES[PIVOT_DATES.length - 1],
      `run doc date range ${runDoc.startDate}..${runDoc.endDate}`);

    const itemSnap = await db.collection(OPTIONS_CORPUS_RUNS_COLLECTION).doc(runId!).collection(OPTIONS_CORPUS_ITEMS_SUBCOLLECTION).get();
    assert(itemSnap.size === PIVOT_DATES.length, `${itemSnap.size} item docs written`);

    console.log('waiting for dispatched seed tasks to reach terminal status...');
    const statuses = await awaitTerminal(runId!);
    assert(statuses.size === PIVOT_DATES.length, 'all items reached terminal status');
    const skipped = [...statuses.values()].filter((s) => s === 'skipped').length;
    assert(skipped === PIVOT_DATES.length, `all ${skipped} items 'skipped' (options-disabled gate — zero AV calls)`);
    for (const [key, status] of statuses) console.log(`  → ${key}: ${status}`);

    // Second fanout for a symbol with no swing doc → clean no-op
    const noop = await fanoutPivotSeeds('ZZTESTNODOC', createPivotSeedFanoutDeps());
    assert(noop.runId === null && noop.enqueued === 0, 'no swing doc → no-op fanout (no run created)');
  } finally {
    await cleanup(runId);
    console.log(`cleanup: deleted ${SWING_DOC_PATH} + run ${runId}`);
  }

  const leftover = await db.doc(SWING_DOC_PATH).get();
  assert(!leftover.exists, 'swing doc deleted');

  console.log('\n=== All verification checks passed ===');
  process.exit(0);
}

main().catch((err) => {
  console.error('FAIL: ' + (err instanceof Error ? err.message : String(err)));
  process.exit(1);
});
