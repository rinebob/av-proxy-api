/**
 * Verification script for Task #206 — send-once guard for alert emission.
 *
 * Calls claimOpsAlert() for real against prod: confirms the first claim
 * wins, a second claim of the same alertKey returns 'already-claimed' with
 * no duplicate write, the claim doc is persisted to
 * ops-alert-claims/{alertKey}, and an optional run doc gets the
 * opsSms.claimed[alertKey] stamp. Cleans up its probe docs afterward.
 *
 * Mutating: writes + deletes one ops-alert-claims/verify:* doc and one
 * ops-alerts-verify-scratch/ops-206-run doc in prod.
 * Run manually — not part of run-all.ts.
 *
 * Usage: npx ts-node -r tsconfig-paths/register -P scripts/tsconfig.json scripts/verify/ops-sms-alerts-206-send-once-guard.ts
 */
import { db } from '../../src/firebase-admin-init';
import { FirestoreCollection } from '@shared/firestore';
import { claimOpsAlert } from '../../src/v2/common/ops-alerts/ops-alert.guard';

function assert(condition: boolean, message: string): void {
  if (!condition) {
    console.error(`FAIL: ${message}`);
    process.exit(1);
  }
  console.log(`PASS: ${message}`);
}

const ALERT_KEY = `verify:ops-206:${new Date().toISOString().slice(0, 10)}`;
const CLAIM_PATH = `${FirestoreCollection.OPS_ALERT_CLAIMS}/${ALERT_KEY}`;
const RUN_DOC_PATH = 'ops-alerts-verify-scratch/ops-206-run';

async function main() {
  console.log('--- Seeding scratch run doc (stamp only lands on existing docs) ---');
  await db.doc(RUN_DOC_PATH).set({ probe: true, task: 206 });

  console.log(`--- First claim (alertKey=${ALERT_KEY}) ---`);
  const first = await claimOpsAlert({
    alertKey: ALERT_KEY,
    kind: 'signoff',
    runId: 'verify-ops-206',
    marketDate: '2026-10-27',
    runDocPath: RUN_DOC_PATH,
  });
  assert(first === 'claimed', 'first claim returns "claimed"');

  console.log('\n--- Second claim of the same alertKey ---');
  const second = await claimOpsAlert({
    alertKey: ALERT_KEY,
    kind: 'signoff',
    runId: 'verify-ops-206',
    marketDate: '2026-10-27',
    runDocPath: RUN_DOC_PATH,
  });
  assert(second === 'already-claimed', 'second claim returns "already-claimed" (send-once)');

  console.log('\n--- Reading back the claim doc ---');
  const snap = await db.doc(CLAIM_PATH).get();
  assert(snap.exists, `claim doc exists at ${CLAIM_PATH}`);
  const data = snap.data()!;
  assert(data.alertKey === ALERT_KEY, 'alertKey field matches');
  assert(data.kind === 'signoff', 'kind field is signoff');
  assert(data.runId === 'verify-ops-206', 'runId field matches');
  assert(data.marketDate === '2026-10-27', 'marketDate field matches');
  assert(!!data.claimedAt, 'claimedAt timestamp is present');

  console.log('\n--- Reading back the run-doc stamp ---');
  const runSnap = await db.doc(RUN_DOC_PATH).get();
  assert(runSnap.exists, `run doc exists at ${RUN_DOC_PATH}`);
  const runData = runSnap.data()!;
  assert(!!runData.opsSms?.claimed?.[ALERT_KEY], 'run doc carries opsSms.claimed[alertKey] stamp');
  assert(runData.probe === true, 'merge-write preserved pre-existing run-doc fields');

  console.log('\n--- Concurrent claims (Promise.all x4) ---');
  const concurrentKey = `${ALERT_KEY}:concurrent`;
  const concurrentPath = `${FirestoreCollection.OPS_ALERT_CLAIMS}/${concurrentKey}`;
  const results = await Promise.all(
    [0, 1, 2, 3].map(() => claimOpsAlert({ alertKey: concurrentKey, kind: 'signoff' })),
  );
  const claimed = results.filter((r) => r === 'claimed').length;
  assert(claimed === 1, `exactly one of four concurrent claims wins (got ${claimed})`);
  assert(
    results.filter((r) => r === 'already-claimed').length === 3,
    'the other three return "already-claimed"',
  );

  console.log('\n--- Claim with missing run doc does not fabricate one ---');
  const ghostKey = `${ALERT_KEY}:ghost`;
  const ghostPath = `${FirestoreCollection.OPS_ALERT_CLAIMS}/${ghostKey}`;
  const ghost = await claimOpsAlert({
    alertKey: ghostKey,
    kind: 'signoff',
    runDocPath: 'ops-alerts-verify-scratch/ops-206-ghost',
  });
  assert(ghost === 'claimed', 'claim succeeds even when run doc is absent');
  const ghostRun = await db.doc('ops-alerts-verify-scratch/ops-206-ghost').get();
  assert(!ghostRun.exists, 'absent run doc is not fabricated by the stamp');

  console.log('\n--- Malformed runDocPath cannot veto the claim ---');
  const badPath = await claimOpsAlert({
    alertKey: `${ALERT_KEY}:badpath`,
    kind: 'signoff',
    runDocPath: 'collection-only',
  });
  assert(badPath === 'claimed', 'malformed runDocPath still returns "claimed" (observability-only)');
  await db.doc(`${FirestoreCollection.OPS_ALERT_CLAIMS}/${ALERT_KEY}:badpath`).delete();
  await db.doc(ghostPath).delete();

  console.log('\n--- Invalid alertKey rejected ---');
  const bad = await claimOpsAlert({ alertKey: 'bad/key', kind: 'signoff' });
  assert(bad === 'error', 'alertKey containing "/" returns "error" without writing');

  console.log('\n--- Cleaning up probe docs ---');
  await db.doc(CLAIM_PATH).delete();
  await db.doc(concurrentPath).delete();
  await db.doc(RUN_DOC_PATH).delete();
  const gone = await db.doc(CLAIM_PATH).get();
  assert(!gone.exists, 'probe claim doc deleted');

  console.log('\n=== All verification checks passed ===');
  process.exit(0);
}

main().catch((err) => {
  console.error('FAIL: unexpected error', err);
  process.exit(1);
});
