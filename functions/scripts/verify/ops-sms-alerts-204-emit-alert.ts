/**
 * Verification script for Task #204 — canonical ops-alert emitter.
 *
 * Calls emitOpsAlert() for real against prod: confirms the canonical
 * ops.alert log line prints with the complete smsText, and that an audit
 * doc is persisted to ops-alerts/{alertKey} with the full payload.
 * Cleans up its probe doc afterward.
 *
 * Mutating: writes + deletes one ops-alerts/verify:* doc in prod.
 * Run manually — not part of run-all.ts.
 *
 * Usage: npx ts-node -r tsconfig-paths/register -P scripts/tsconfig.json scripts/verify/ops-sms-alerts-204-emit-alert.ts
 */
import { db } from '../../src/firebase-admin-init';
import { FirestoreCollection } from '@shared/firestore';
import { emitOpsAlert } from '../../src/v2/common/ops-alerts/ops-alert.emitter';

function assert(condition: boolean, message: string): void {
  if (!condition) {
    console.error(`FAIL: ${message}`);
    process.exit(1);
  }
  console.log(`PASS: ${message}`);
}

const ALERT_KEY = `verify:ops-204:${new Date().toISOString().slice(0, 10)}`;
const SMS_TEXT =
  'Savant VERIFY probe (Task #204): if you received this as an SMS the delivery path works. Not a real pipeline alert.';

const baseEvent = {
  alertKey: ALERT_KEY,
  kind: 'signoff' as const,
  smsText: SMS_TEXT,
  runId: 'verify-ops-204',
  marketDate: '2026-10-25',
};

async function main() {
  console.log(`--- Emitting canonical alert event (alertKey=${ALERT_KEY}) ---`);
  console.log('Expect an [opsAlert emitOpsAlert] event=ops.alert line below carrying the smsText:\n');

  await emitOpsAlert({ ...baseEvent, context: { probe: true, task: 204 } });

  console.log('\n--- Reading back the audit doc ---');
  const snap = await db.doc(`${FirestoreCollection.OPS_ALERTS}/${ALERT_KEY}`).get();
  assert(snap.exists, `audit doc exists at ops-alerts/${ALERT_KEY}`);

  const data = snap.data()!;
  assert(data.alertKey === ALERT_KEY, 'alertKey field matches');
  assert(data.kind === 'signoff', 'kind field is signoff');
  assert(data.smsText === SMS_TEXT, 'smsText field carries the complete text');
  assert(data.runId === 'verify-ops-204', 'runId field matches');
  assert(data.marketDate === '2026-10-25', 'marketDate field matches');
  assert(data.context?.probe === true, 'context field carries structured data');
  assert(!!data.emittedAt, 'emittedAt timestamp is present');

  console.log('\n--- Re-emitting same alertKey (dedupe = overwrite, not duplicate) ---');
  await emitOpsAlert({ ...baseEvent, context: { probe: true, task: 204, reemit: true } });
  const snap2 = await db.doc(`${FirestoreCollection.OPS_ALERTS}/${ALERT_KEY}`).get();
  assert(snap2.data()?.context?.reemit === true, 're-emission overwrote the same doc (dedupe by doc id)');

  console.log('\n--- Cleaning up probe doc ---');
  await db.doc(`${FirestoreCollection.OPS_ALERTS}/${ALERT_KEY}`).delete();
  const gone = await db.doc(`${FirestoreCollection.OPS_ALERTS}/${ALERT_KEY}`).get();
  assert(!gone.exists, 'probe doc deleted');

  console.log('\n=== All verification checks passed ===');
  process.exit(0);
}

main().catch((err) => {
  console.error('FAIL: unexpected error', err);
  process.exit(1);
});
