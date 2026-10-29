/**
 * Verification script for Task #207 — intraday signoff emission (3 ticks).
 *
 * Calls emitIntradayTickSignoff() for real against prod: confirms a tick
 * signoff claims + emits once (claim doc, ops-alerts audit doc, run-doc
 * opsSms.claimed stamp), a second invocation is deduped by the send-once
 * guard, and non-tick clockPt values emit nothing. Cleans up probe docs.
 *
 * Mutating: writes + deletes one intraday-runs/verify-* doc, one
 * ops-alert-claims/signoff:intraday:verify-* doc, and one
 * ops-alerts/signoff:intraday:verify-* doc in prod. The verify runId and
 * marketDate cannot collide with real pipeline identities.
 * Run manually — not part of run-all.ts.
 *
 * Usage: npx ts-node -r tsconfig-paths/register -P scripts/tsconfig.json scripts/verify/ops-sms-alerts-207-intraday-signoff.ts
 */
import { db } from '../../src/firebase-admin-init';
import { FirestoreCollection } from '@shared/firestore';
import { emitIntradayTickSignoff } from '../../src/v2/alpha-vantage/jobs/intraday-ops-signoff';

function assert(condition: boolean, message: string): void {
  if (!condition) {
    console.error(`FAIL: ${message}`);
    process.exit(1);
  }
  console.log(`PASS: ${message}`);
}

// Probe identities that cannot collide with real pipeline artifacts.
const MARKET_DATE = `verify-207-${new Date().toISOString().slice(0, 10)}`;
const RUN_ID = `verify-ops-207-${Date.now()}`;
const RUN_DOC_PATH = `${FirestoreCollection.INTRADAY_RUNS}/${RUN_ID}`;
const TICK_KEY = `signoff:intraday:${MARKET_DATE}:0800`;
const CLAIM_PATH = `${FirestoreCollection.OPS_ALERT_CLAIMS}/${TICK_KEY}`;
const AUDIT_PATH = `${FirestoreCollection.OPS_ALERTS}/${TICK_KEY}`;
const NONTICK_KEY = `signoff:intraday:${MARKET_DATE}:0947`;

async function main() {
  console.log('--- Seeding probe run doc (status COMPLETE — invisible to self-healing) ---');
  await db.doc(RUN_DOC_PATH).set({
    runId: RUN_ID,
    marketDate: MARKET_DATE,
    clockPt: '0800',
    status: 'COMPLETE',
    probe: true,
    task: 207,
    createdJobs: 3,
    successJobs: 3,
    permanentFailureJobs: 0,
  });

  console.log('\n--- First tick signoff (clockPt=0800) ---');
  await emitIntradayTickSignoff({
    runId: RUN_ID,
    marketDate: MARKET_DATE,
    clockPt: '0800',
    createdJobs: 3,
    successJobs: 3,
    permanentFailureJobs: 0,
    durationMs: 60_000,
  });

  const claimSnap = await db.doc(CLAIM_PATH).get();
  assert(claimSnap.exists, `claim doc exists at ${CLAIM_PATH}`);
  const claimData = claimSnap.data()!;
  assert(claimData.kind === 'signoff', 'claim doc kind is signoff');
  assert(claimData.runId === RUN_ID, 'claim doc runId matches');
  assert(claimData.marketDate === MARKET_DATE, 'claim doc marketDate matches');
  assert(!!claimData.claimedAt, 'claim doc carries claimedAt timestamp');

  const auditSnap = await db.doc(AUDIT_PATH).get();
  assert(auditSnap.exists, `audit doc exists at ${AUDIT_PATH}`);
  const auditData = auditSnap.data()!;
  assert(auditData.kind === 'signoff', 'audit doc kind is signoff');
  assert(auditData.smsText.includes('intraday 0800 PT run finished'), 'smsText names the 0800 tick');
  assert(auditData.smsText.includes(MARKET_DATE), 'smsText carries the market date');
  assert(auditData.smsText.includes('3 of 3'), 'smsText carries refreshed counts');
  assert(auditData.smsText.includes('Partner data-ready message sent.'), 'smsText confirms the PDR');
  assert(!!auditData.emittedAt, 'audit doc carries emittedAt timestamp');
  const firstEmittedAt = auditData.emittedAt;

  const runSnap = await db.doc(RUN_DOC_PATH).get();
  const runData = runSnap.data()!;
  assert(!!runData.opsSms?.claimed?.[TICK_KEY], 'run doc carries opsSms.claimed[alertKey] stamp');
  assert(runData.probe === true, 'merge-write preserved pre-existing run-doc fields');

  console.log('\n--- Second invocation of the same tick (redelivery dedupe) ---');
  await emitIntradayTickSignoff({
    runId: RUN_ID,
    marketDate: MARKET_DATE,
    clockPt: '0800',
    createdJobs: 3,
    successJobs: 3,
    permanentFailureJobs: 0,
    durationMs: 60_000,
  });
  const auditAgain = await db.doc(AUDIT_PATH).get();
  const secondEmittedAt = auditAgain.data()!.emittedAt;
  assert(
    !!secondEmittedAt &&
      typeof firstEmittedAt?.toMillis === 'function' &&
      secondEmittedAt.toMillis() === firstEmittedAt.toMillis(),
    'second invocation did not re-emit (audit doc emittedAt unchanged)',
  );

  console.log('\n--- Non-tick clockPt emits nothing ---');
  await emitIntradayTickSignoff({
    runId: RUN_ID,
    marketDate: MARKET_DATE,
    clockPt: '0947',
    createdJobs: 1,
    successJobs: 1,
  });
  const nonTickClaim = await db.doc(`${FirestoreCollection.OPS_ALERT_CLAIMS}/${NONTICK_KEY}`).get();
  const nonTickAudit = await db.doc(`${FirestoreCollection.OPS_ALERTS}/${NONTICK_KEY}`).get();
  assert(!nonTickClaim.exists, 'no claim doc for clockPt 0947 (manual/heartbeat tick)');
  assert(!nonTickAudit.exists, 'no audit doc for clockPt 0947');

  console.log('\n--- Cleaning up probe docs ---');
  await db.doc(CLAIM_PATH).delete();
  await db.doc(AUDIT_PATH).delete();
  await db.doc(RUN_DOC_PATH).delete();
  const gone = await db.doc(AUDIT_PATH).get();
  assert(!gone.exists, 'probe audit doc deleted');

  console.log('\n=== All verification checks passed ===');
  process.exit(0);
}

main().catch((err) => {
  console.error('FAIL: unexpected error', err);
  process.exit(1);
});
