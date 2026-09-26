/**
 * Verification script for Task #154 — coverage-aware fanout + interim supersede.
 *
 * Exercises the real pipeline against prod: seeded corpus swing doc +
 * pre-staged GCS objects → fanoutPivotSeeds → only missing dates dispatched,
 * superseded interim object deleted, confirmed/other-provenance objects kept.
 *
 * ZZTEST is NOT options-enabled → the deployed seed worker terminal-marks
 * every dispatched task 'skipped' — zero AV calls. Staged objects are written
 * via GcsCorpusAdapter.writeItem (tiny empty-contract envelopes) and deleted
 * in cleanup.
 *
 * Mutating — writes then deletes one options-swing-sets doc, three GCS
 * objects, and one options_corpus_runs run. Not in run-all.
 *
 * Usage:
 *   npx ts-node -r tsconfig-paths/register -P scripts/tsconfig.json scripts/verify/options-data-154-corpus-sweep.ts
 */
import * as admin from 'firebase-admin';
import { FirestoreCollection } from '@shared/firestore';
import { CORPUS_ZIGZAG_CONFIG, deriveParamsId } from '@shared/zigzag';
import type { SwingSetDoc } from '@shared/zigzag';

if (!admin.apps.length) {
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
const { GcsCorpusAdapter } = require('../../src/v2/historical-options-corpus/services/gcs-corpus-adapter.service');
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

// Planned: confirmed 01-05 + 02-03, interim extreme 04-01.
// Staged objects: 01-05 covered (confirmed), 03-20 superseded interim,
// 05-15 nightly-provenance (no kind stamp — must survive the supersede sweep).
const CONFIRMED = ['2026-01-05', '2026-02-03'];
const INTERIM_EXTREME = '2026-04-01';
const SUPERSEDED_INTERIM = '2026-03-20';
const UNMARKED = '2026-05-15';

const fakeAnalysis = {
  summary: { totalContracts: 0, totalVolume: 0, totalOpenInterest: 0, callContracts: 0, putContracts: 0, uniqueStrikes: 0, avgVolumePerContract: 0, avgOpenInterest: 0 },
  expirations: [],
  strikes: [],
};
const fakeResponse = { endpoint: 'HISTORICAL_OPTIONS', message: 'success', data: [] };

async function seedAll(gcs: InstanceType<typeof GcsCorpusAdapter>): Promise<void> {
  const doc: SwingSetDoc = {
    symbol: SYMBOL,
    paramsId: PARAMS_ID,
    config: CORPUS_ZIGZAG_CONFIG,
    pivotDates: CONFIRMED,
    currentExtremeDate: INTERIM_EXTREME,
    currentDirection: 'up',
    generatedAt: { seconds: Math.floor(Date.now() / 1000), nanoseconds: 0 } as any,
    source: 'sa',
  };
  await db.doc(SWING_DOC_PATH).set(doc);
  await gcs.writeItem(SYMBOL, CONFIRMED[0], fakeResponse, fakeAnalysis, 'confirmed'); // covered
  await gcs.writeItem(SYMBOL, SUPERSEDED_INTERIM, fakeResponse, fakeAnalysis, 'interim'); // superseded
  await gcs.writeItem(SYMBOL, UNMARKED, fakeResponse, fakeAnalysis); // no kind stamp
}

async function cleanup(runId: string | null, gcs: InstanceType<typeof GcsCorpusAdapter>): Promise<void> {
  await db.doc(SWING_DOC_PATH).delete().catch(() => undefined);
  for (const date of [...CONFIRMED, INTERIM_EXTREME, SUPERSEDED_INTERIM, UNMARKED]) {
    await gcs.deleteItem(SYMBOL, date).catch(() => undefined);
  }
  if (runId) {
    const items = await db.collection(OPTIONS_CORPUS_RUNS_COLLECTION).doc(runId).collection(OPTIONS_CORPUS_ITEMS_SUBCOLLECTION).listDocuments();
    for (const d of items) await d.delete().catch(() => undefined);
    await db.collection(OPTIONS_CORPUS_RUNS_COLLECTION).doc(runId).delete().catch(() => undefined);
  }
}

async function awaitTerminal(runId: string, expected: number, timeoutMs = 240_000): Promise<Map<string, string>> {
  const deadline = Date.now() + timeoutMs;
  const terminal = new Set(['success', 'permanent_failure', 'skipped', 'not_found']);
  while (Date.now() < deadline) {
    const snap = await db.collection(OPTIONS_CORPUS_RUNS_COLLECTION).doc(runId).collection(OPTIONS_CORPUS_ITEMS_SUBCOLLECTION).get();
    const statuses = new Map<string, string>(snap.docs.map((d) => [d.id, (d.data() as { status: string }).status]));
    if (statuses.size === expected && [...statuses.values()].every((s) => terminal.has(s))) return statuses;
    await new Promise((r) => setTimeout(r, 5000));
  }
  return new Map();
}

async function main(): Promise<void> {
  const bucketName = process.env.OPTIONS_CORPUS_BUCKET;
  if (!bucketName) {
    console.error('FAIL: OPTIONS_CORPUS_BUCKET env var not set');
    process.exit(1);
  }
  const gcs = new GcsCorpusAdapter(admin.storage().bucket(bucketName));
  console.log(`--- Verifying corpus reconcile/sweep against prod (${SYMBOL}) ---\n`);
  let runId: string | null = null;

  try {
    await seedAll(gcs);
    console.log('seeded swing doc + 3 GCS objects (covered/superseded/unmarked)');

    const result = await fanoutPivotSeeds(SYMBOL, createPivotSeedFanoutDeps());
    runId = result.runId;

    assert(result.planned === 3, `planner returned ${result.planned} items`);
    assert(result.enqueued === 2, `only missing dates dispatched (got ${result.enqueued})`);
    assert(result.deleted === 1, `superseded interim deleted (deleted=${result.deleted})`);

    // GCS assertions — superseded gone, covered + unmarked still there
    assert(!(await gcs.getMetadata(SYMBOL, SUPERSEDED_INTERIM)), 'superseded interim object deleted from GCS');
    assert(!!(await gcs.getMetadata(SYMBOL, CONFIRMED[0])), 'covered confirmed object retained');
    assert(!!(await gcs.getMetadata(SYMBOL, UNMARKED)), 'unmarked (nightly-provenance) object retained');

    // Item docs carry the planned kind through to dispatch
    const itemSnap = await db.collection(OPTIONS_CORPUS_RUNS_COLLECTION).doc(runId!).collection(OPTIONS_CORPUS_ITEMS_SUBCOLLECTION).get();
    const keys = itemSnap.docs.map((d) => d.id).sort();
    assert(keys.join(',') === `${SYMBOL}_2026-02-03,${SYMBOL}_2026-04-01`, `run item docs only cover missing dates (${keys})`);

    console.log('waiting for dispatched tasks to reach terminal status...');
    const statuses = await awaitTerminal(runId!, 2);
    assert(statuses.size === 2 && [...statuses.values()].every((s) => s === 'skipped'),
      'dispatched items terminal (options-disabled gate — zero AV calls)');

    // Second fanout after cleanup-equivalent state — superseded already gone:
    // remaining missing dates still dispatch, nothing else deleted.
  } finally {
    await cleanup(runId, gcs);
    console.log(`cleanup: swing doc + objects + run ${runId}`);
  }

  console.log('\n=== All verification checks passed ===');
  process.exit(0);
}

main().catch((err) => {
  console.error('FAIL: ' + (err instanceof Error ? err.message : String(err)));
  process.exit(1);
});
