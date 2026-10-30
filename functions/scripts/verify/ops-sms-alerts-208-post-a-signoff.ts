/**
 * Verification script for Task #208 — POST-A last-interval signoff emission.
 *
 * Calls emitPostASignoff() for real against prod: seeds three sibling
 * realtime-runs docs for a synthetic A pass, confirms the partial gate
 * (2/3 messageSent → nothing), the full gate (3/3 → claim + emit once),
 * redelivery dedupe, and the B/C sequence gate. Cleans up all probe docs.
 *
 * Mutating: writes + deletes three realtime-runs/verify-* docs, one
 * ops-alert-claims/signoff:post:* doc, and one ops-alerts/signoff:post:*
 * doc in prod. The synthetic marketDate (2099-01-05) cannot collide with
 * real pipeline identities. Run manually — not part of run-all.ts.
 * NOTE: the emit produces a real canonical `ops.alert` log line; once a
 * delivery route subscribes to that event (Task #211), running this script
 * can send a real SMS.
 *
 * Usage: npx ts-node -r tsconfig-paths/register -P scripts/tsconfig.json scripts/verify/ops-sms-alerts-208-post-a-signoff.ts
 */
import { db } from '../../src/firebase-admin-init';
import { FirestoreCollection } from '@shared/firestore';
import { emitPostASignoff } from '../../src/v2/alpha-vantage/jobs/post-ops-signoff';

function assert(condition: boolean, message: string): void {
  if (!condition) {
    console.error(`FAIL: ${message}`);
    process.exit(1);
  }
  console.log(`PASS: ${message}`);
}

// Probe identities — a far-future marketDate cannot collide with real runs.
const MARKET_DATE = '2099-01-05';
const runId = (interval: string) => `${MARKET_DATE}-MON-A-${interval}-LIVE-POST-1335`;
const DAILY_ID = runId('DAILY');
const WEEKLY_ID = runId('WEEKLY');
const MONTHLY_ID = runId('MONTHLY');
const ALERT_KEY = `signoff:post:${MARKET_DATE}:A`;
const CLAIM_PATH = `${FirestoreCollection.OPS_ALERT_CLAIMS}/${ALERT_KEY}`;
const AUDIT_PATH = `${FirestoreCollection.OPS_ALERTS}/${ALERT_KEY}`;

const intervalDoc = (interval: string, messageSent: boolean, overrides: Record<string, unknown> = {}) => ({
  runId: runId(interval),
  runType: 'ts-post-all-intervals-initial',
  sequence: 'A',
  marketDate: MARKET_DATE,
  phase: 'POST',
  interval: interval.toLowerCase(),
  status: 'COMPLETE',
  probe: true,
  task: 208,
  createdJobs: 10,
  successJobs: 9,
  permanentFailureJobs: 1,
  permanentFailureSymbols: ['ZZTEST'],
  partnerDataReady: { messageSent },
  ...overrides,
});

async function main() {
  console.log('--- Seeding probe sibling docs (DAILY+WEEKLY sent, MONTHLY pending) ---');
  await db.doc(`${FirestoreCollection.REALTIME_RUNS}/${DAILY_ID}`).set(intervalDoc('DAILY', true));
  await db.doc(`${FirestoreCollection.REALTIME_RUNS}/${WEEKLY_ID}`).set(intervalDoc('WEEKLY', true));
  await db.doc(`${FirestoreCollection.REALTIME_RUNS}/${MONTHLY_ID}`).set(intervalDoc('MONTHLY', false));

  console.log('\n--- Partial completion (2/3 PDRs) emits nothing ---');
  await emitPostASignoff({
    runId: DAILY_ID,
    marketDate: MARKET_DATE,
    sequence: 'A',
    runType: 'ts-post-all-intervals-initial',
  });
  let claimSnap = await db.doc(CLAIM_PATH).get();
  assert(!claimSnap.exists, 'no claim doc while a sibling PDR is pending');

  console.log('\n--- Last interval completes (3/3 PDRs) ---');
  await db.doc(`${FirestoreCollection.REALTIME_RUNS}/${MONTHLY_ID}`).update({
    'partnerDataReady.messageSent': true,
  });
  await emitPostASignoff({
    runId: MONTHLY_ID,
    marketDate: MARKET_DATE,
    sequence: 'A',
    runType: 'ts-post-all-intervals-initial',
  });

  claimSnap = await db.doc(CLAIM_PATH).get();
  assert(claimSnap.exists, `claim doc exists at ${CLAIM_PATH}`);
  const claimData = claimSnap.data()!;
  assert(claimData.kind === 'signoff', 'claim doc kind is signoff');
  assert(claimData.runId === MONTHLY_ID, 'claim doc runId is the last-finishing interval');
  assert(!!claimData.claimedAt, 'claim doc carries claimedAt timestamp');

  const auditSnap = await db.doc(AUDIT_PATH).get();
  assert(auditSnap.exists, `audit doc exists at ${AUDIT_PATH}`);
  const auditData = auditSnap.data()!;
  assert(auditData.smsText.includes('POST A run finished'), 'smsText names the POST A signoff');
  assert(auditData.smsText.includes(MARKET_DATE), 'smsText carries the market date');
  assert(auditData.smsText.includes('daily 9/10'), 'smsText carries per-interval counts');
  assert(
    auditData.smsText.includes('All 3 partner data-ready messages sent'),
    'smsText confirms all interval PDRs',
  );
  assert(!auditData.smsText.includes('ZZTEST'), 'smsText carries counts only — no symbol lists');
  const ctx = (auditData as any).context ?? {};
  assert(
    Array.isArray(ctx.failedSymbols) && ctx.failedSymbols.includes('ZZTEST'),
    'audit context aggregates failed symbols from siblings',
  );
  const firstEmittedAt = auditData.emittedAt;

  const runSnap = await db.doc(`${FirestoreCollection.REALTIME_RUNS}/${MONTHLY_ID}`).get();
  assert(
    !!runSnap.data()!.opsSms?.claimed?.[ALERT_KEY],
    'triggering run doc carries opsSms.claimed[alertKey] stamp',
  );

  console.log('\n--- Second invocation (redelivery dedupe) ---');
  await emitPostASignoff({
    runId: WEEKLY_ID,
    marketDate: MARKET_DATE,
    sequence: 'A',
    runType: 'ts-post-all-intervals-initial',
  });
  const auditAgain = await db.doc(AUDIT_PATH).get();
  const secondEmittedAt = auditAgain.data()!.emittedAt;
  assert(
    !!secondEmittedAt &&
      typeof firstEmittedAt?.toMillis === 'function' &&
      secondEmittedAt.toMillis() === firstEmittedAt.toMillis(),
    'second invocation did not re-emit (audit doc emittedAt unchanged)',
  );

  console.log('\n--- B/C sequence emits nothing ---');
  await emitPostASignoff({
    runId: DAILY_ID,
    marketDate: MARKET_DATE,
    sequence: 'B',
    runType: 'ts-post-all-intervals-retry',
  });
  const bClaim = await db.doc(`${FirestoreCollection.OPS_ALERT_CLAIMS}/signoff:post:${MARKET_DATE}:B`).get();
  assert(!bClaim.exists, 'no claim doc for sequence B');

  console.log('\n--- MANUAL A-pass emits nothing (M1 fix) ---');
  // A manual run is a distinct identity from the scheduled LIVE pass — even
  // with all three MANUAL siblings' PDRs sent, it must never claim the
  // signoff key (post-review remediation M1).
  const MANUAL_DATE = '2099-01-06';
  const manualRunId = (interval: string) => `${MANUAL_DATE}-TUE-A-${interval}-MANUAL-POST-1335`;
  for (const interval of ['DAILY', 'WEEKLY', 'MONTHLY']) {
    await db.doc(`${FirestoreCollection.REALTIME_RUNS}/${manualRunId(interval)}`).set({
      ...intervalDoc(interval, true),
      runId: manualRunId(interval),
      marketDate: MANUAL_DATE,
    });
  }
  await emitPostASignoff({
    runId: manualRunId('MONTHLY'),
    marketDate: MANUAL_DATE,
    sequence: 'A',
    runType: 'ts-post-all-intervals-initial',
  });
  const manualClaim = await db.doc(`${FirestoreCollection.OPS_ALERT_CLAIMS}/signoff:post:${MANUAL_DATE}:A`).get();
  assert(!manualClaim.exists, 'MANUAL A-pass created no claim doc');
  const manualAudit = await db.doc(`${FirestoreCollection.OPS_ALERTS}/signoff:post:${MANUAL_DATE}:A`).get();
  assert(!manualAudit.exists, 'MANUAL A-pass created no audit doc');

  console.log('\n--- Cleaning up probe docs ---');
  for (const interval of ['DAILY', 'WEEKLY', 'MONTHLY']) {
    await db.doc(`${FirestoreCollection.REALTIME_RUNS}/${manualRunId(interval)}`).delete();
  }
  await db.doc(CLAIM_PATH).delete();
  await db.doc(AUDIT_PATH).delete();
  for (const id of [DAILY_ID, WEEKLY_ID, MONTHLY_ID]) {
    await db.doc(`${FirestoreCollection.REALTIME_RUNS}/${id}`).delete();
  }
  const gone = await db.doc(AUDIT_PATH).get();
  assert(!gone.exists, 'probe audit doc deleted');

  console.log('\n=== All verification checks passed ===');
  process.exit(0);
}

main().catch((err) => {
  console.error('FAIL: unexpected error', err);
  process.exit(1);
});
