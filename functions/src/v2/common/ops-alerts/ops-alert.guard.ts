/**
 * Send-once guard for the canonical ops-alert seam (Topic #198).
 *
 * Scheduler redelivery and concurrent interval completion can invoke an
 * emission site more than once. This guard claims `ops-alert-claims/{alertKey}`
 * inside a Firestore transaction BEFORE the caller emits — exactly one caller
 * wins; everyone else gets 'already-claimed'.
 *
 * The claim doc is the authority — uniform for signoffs AND exceptions
 * (exception run docs may not exist). Optionally stamps
 * `opsSms.claimed[alertKey]` on a run doc in the same transaction so the run
 * doc itself shows the alert was handled (mirrors partnerDataReady.messageSent).
 * The stamp records claim intent, not confirmed SMS delivery — delivery
 * happens after the claim and its outcome lives on the audit doc.
 *
 * Fail-closed: a transaction error returns 'error' and the caller must NOT
 * emit — we cannot prove once-only, so we skip and log rather than risk a
 * duplicate text. The guard never throws into pipeline code.
 */

import { FieldValue } from 'firebase-admin/firestore';

import { db } from '../../../firebase-admin-init';
import { FirestoreCollection } from '@shared/firestore';
import { betterLogger } from '../../utils/utils';
import { isValidAlertKey, type OpsAlertKind } from './ops-alert.types';

const logger = betterLogger('opsAlert');

export type OpsAlertClaimResult = 'claimed' | 'already-claimed' | 'error';

export interface ClaimOpsAlertInput {
  /** Dedupe identity — becomes the claim doc id. Same key the emitter audits under. */
  alertKey: string;
  /** 'signoff' | 'exception' — always known at the call site; recorded on the claim doc. */
  kind: OpsAlertKind;
  runId?: string;
  marketDate?: string;
  /**
   * Optional run doc path (e.g. 'realtime-runs/rt-...'). When provided, the
   * same transaction stamps `opsSms.claimed[alertKey]` on it — purely for
   * observability; the claim doc remains the authority. Omit for exceptions
   * whose run doc may not exist.
   */
  runDocPath?: string;
}

/** A Firestore document path: >= 2 non-empty segments, even count. */
function isValidDocPath(path: string): boolean {
  const segs = path.split('/');
  return segs.length >= 2 && segs.length % 2 === 0 && segs.every((s) => s.length > 0);
}

export async function claimOpsAlert(input: ClaimOpsAlertInput): Promise<OpsAlertClaimResult> {
  if (!input || !isValidAlertKey(input.alertKey)) {
    logger.error('ops.alert_claim_failed', {
      function: 'claimOpsAlert',
      alertKey: input?.alertKey,
      message: `invalid alertKey '${input?.alertKey}' — must be non-empty and contain no '/'`,
    });
    return 'error';
  }
  const { alertKey } = input;

  // runDocPath is observability-only — a malformed or SDK-rejected path must
  // not veto the send-once claim. Log and drop it rather than failing.
  // (Server-side write rejects on legal-but-reserved ids can't be fully
  // pre-empted — those still land in the fail-closed catch below.)
  let runRef: FirebaseFirestore.DocumentReference | undefined;
  if (input.runDocPath) {
    try {
      if (!isValidDocPath(input.runDocPath)) {
        throw new Error('must be a document path (even segments)');
      }
      runRef = db.doc(input.runDocPath);
    } catch (err) {
      logger.warn('ops.alert_stamp_skipped', {
        function: 'claimOpsAlert',
        message: `invalid runDocPath '${input.runDocPath}' — ${err instanceof Error ? err.message : String(err)}`,
        alertKey,
      });
    }
  }

  try {
    const claimRef = db.doc(`${FirestoreCollection.OPS_ALERT_CLAIMS}/${alertKey}`);

    return await db.runTransaction(async (tx) => {
      const snap = await tx.get(claimRef);
      if (snap.exists) return 'already-claimed' as const;

      // All reads precede writes (Firestore tx requirement). Read the run
      // doc and stamp it only when it actually exists — never fabricate a
      // stub run doc for observability.
      const runSnap = runRef ? await tx.get(runRef) : undefined;

      tx.set(claimRef, {
        alertKey,
        kind: input.kind,
        runId: input.runId ?? null,
        marketDate: input.marketDate ?? null,
        claimedAt: FieldValue.serverTimestamp(),
      });

      if (runSnap?.exists && runRef) {
        tx.set(
          runRef,
          { opsSms: { claimed: { [alertKey]: FieldValue.serverTimestamp() } } },
          { merge: true },
        );
      }

      return 'claimed' as const;
    });
  } catch (err) {
    logger.error('ops.alert_claim_failed', {
      function: 'claimOpsAlert',
      runId: input.runId,
      marketDate: input.marketDate,
      message: `claim failed: ${err instanceof Error ? err.message : String(err)}`,
      alertKey,
    });
    return 'error';
  }
}
