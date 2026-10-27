import { FieldValue } from 'firebase-admin/firestore';

import { db } from '../../../firebase-admin-init';
import { FirestoreCollection } from '@shared/firestore';
import { betterLogger } from '../../utils/utils';
import type { OpsAlertEvent } from './ops-alert.types';

const logger = betterLogger('opsAlert');

/**
 * Canonical, fail-safe emission point for operator alerts (Topic #198).
 *
 * Emits a canonical `ops.alert` log line carrying the complete `smsText`,
 * then writes an audit doc to `ops-alerts/{alertKey}` for dedupe and
 * observability. The deterministic doc id means re-emission overwrites
 * rather than duplicates.
 *
 * Fail-safe contract: this function never throws. Any internal failure
 * (validation, audit write) is logged as `ops.alert_emit_failed` and
 * swallowed — an SMS failure must never fail a Cloud Task, break a PDR
 * publish, or mark a run incomplete. The canonical log line is emitted
 * before the audit write so it survives audit failures.
 */
export async function emitOpsAlert(event: OpsAlertEvent): Promise<void> {
  try {
    if (!event?.smsText || !event?.alertKey || event.alertKey.includes('/')) {
      logger.error('ops.alert_emit_failed', {
        function: 'emitOpsAlert',
        message: `invalid event — ${
          !event ? 'null event' : !event.alertKey ? 'missing alertKey' : !event.smsText ? 'missing smsText' : 'alertKey must not contain "/"'
        }`,
      });
      return;
    }

    // Sanitize context (shallow): drop undefined values — Firestore set()
    // rejects them. Deeper nesting still falls to the fail-safe catch.
    const context = event.context
      ? Object.fromEntries(Object.entries(event.context).filter(([, v]) => v !== undefined))
      : {};

    // Safe-serialize for the log — circular/BigInt contexts must not lose
    // the canonical line (and its smsText) to a stringify throw.
    let ctxJson: string | undefined;
    if (Object.keys(context).length) {
      try {
        ctxJson = JSON.stringify(context);
      } catch {
        ctxJson = '[unserializable context]';
      }
    }

    // Canonical log line first — survives any subsequent failure. Carries
    // alertKey (audit-doc correlation) + serialized context per spec.
    // Exceptions log at error level so hard-down conditions stay greppable
    // (event=ops.alert level=error) apart from routine signoffs.
    const logEvent = event.kind === 'exception' ? logger.error : logger.info;
    logEvent('ops.alert', {
      function: 'emitOpsAlert',
      runId: event.runId,
      marketDate: event.marketDate,
      message: event.smsText.replace(/\s+/g, ' '),
      alertKey: event.alertKey,
      ctx: ctxJson,
    });

    // Audit doc — deterministic id for dedupe/observability.
    await db
      .doc(`${FirestoreCollection.OPS_ALERTS}/${event.alertKey}`)
      .set({
        alertKey: event.alertKey,
        kind: event.kind,
        smsText: event.smsText,
        runId: event.runId ?? null,
        marketDate: event.marketDate ?? null,
        context,
        emittedAt: FieldValue.serverTimestamp(),
      });
  } catch (err) {
    logger.error('ops.alert_emit_failed', {
      function: 'emitOpsAlert',
      runId: event?.runId,
      marketDate: event?.marketDate,
      message: `emit failed: ${err instanceof Error ? err.message : String(err)}`,
    });
  }
}
