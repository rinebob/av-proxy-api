/**
 * Intraday tick signoff emission site (Topic #198).
 *
 * Called by the run-completion aggregator AFTER the tick's partner
 * data-ready (PDR) publish succeeded. Composes the readable signoff text,
 * claims the deterministic alertKey through the send-once guard (dedupes
 * scheduler redelivery and concurrent completion), and emits through the
 * canonical fail-safe emitter.
 *
 * Only the three scheduled ticks (INTRADAY_SIGNOFF_TICKS) qualify —
 * heartbeat, manual, and other clockPt publishes emit nothing. A FAILED
 * republish from self-healing is not routed through here: the signoff
 * asserts normal completion; hard-down conditions are covered by watchdog
 * exceptions instead.
 *
 * Fail-safe contract: this function never throws. Every failure mode is
 * logged and swallowed — alert trouble must never fail a Cloud Task,
 * break a PDR publish, or mark a run incomplete.
 */

import { FirestoreCollection } from '@shared/firestore';

import { betterLogger } from '../../utils/utils';
import { composeIntradaySignoff } from '../../common/ops-alerts/ops-alert.composer';
import { emitOpsAlert } from '../../common/ops-alerts/ops-alert.emitter';
import { claimOpsAlert } from '../../common/ops-alerts/ops-alert.guard';
import { INTRADAY_SIGNOFF_TICKS } from './job-config';

const logger = betterLogger('iS.Signoff');

export interface IntradayTickSignoffArgs {
  runId: string;
  /** ET trading date (YYYY-MM-DD) — part of the alertKey identity. */
  marketDate: string;
  /** PT clock label (HHMM) — must be a scheduled tick to emit. */
  clockPt: string;
  createdJobs?: number;
  successJobs?: number;
  permanentFailureJobs?: number;
  /**
   * Failed-symbol list — logged alongside the signoff via the emit context
   * (ops.alert line + audit doc). NEVER in smsText; the text is counts-only.
   */
  failedSymbols?: string[];
  /** Run duration in milliseconds, when recorded on the run doc. */
  durationMs?: number;
}

export async function emitIntradayTickSignoff(
  args: IntradayTickSignoffArgs,
): Promise<void> {
  try {
    const { runId, marketDate, clockPt } = args;

    // Strict tick-label equality is deliberate and matches the watchdog
    // model: runIds embed the scheduled tick label (`…-LIVE-0800`), so an
    // off-label run (late scheduler fire, manual/dev clockPt) is treated as
    // "the tick didn't happen" and the watchdog exception covers it. A dev
    // run passed an exact tick clockPt is indistinguishable from the
    // scheduled run BY DESIGN (same runId, same run doc) and will claim its
    // signoff — accepted dev-only impersonation.
    if (!INTRADAY_SIGNOFF_TICKS.has(clockPt)) {
      logger.info('intraday.signoff_skipped', { runId, marketDate, clockPt, reason: 'not-a-tick' } as any);
      return;
    }

    const alertKey = `signoff:intraday:${marketDate}:${clockPt}`;
    const smsText = composeIntradaySignoff({
      marketDate,
      clockPt,
      createdJobs: args.createdJobs,
      successJobs: args.successJobs,
      permanentFailureJobs: args.permanentFailureJobs,
      durationMs: args.durationMs,
    });

    const claim = await claimOpsAlert({
      alertKey,
      kind: 'signoff',
      runId,
      marketDate,
      runDocPath: `${FirestoreCollection.INTRADAY_RUNS}/${runId}`,
    });

    if (claim !== 'claimed') {
      // 'already-claimed': a redelivery/concurrent path won — intentional
      // no-op. 'error': fail-closed, the guard logged the detail.
      // Same `reason` field as the not-a-tick skip so the event greps uniformly.
      logger.info('intraday.signoff_skipped', {
        runId,
        marketDate,
        clockPt,
        alertKey,
        reason: claim === 'already-claimed' ? 'already-claimed' : 'claim-error',
      } as any);
      return;
    }

    await emitOpsAlert({
      alertKey,
      kind: 'signoff',
      smsText,
      runId,
      marketDate,
      context: {
        clockPt,
        createdJobs: args.createdJobs,
        successJobs: args.successJobs,
        permanentFailureJobs: args.permanentFailureJobs,
        failedSymbols: args.failedSymbols,
        durationMs: args.durationMs,
      },
    });
    logger.info('intraday.signoff_emit_invoked', { runId, marketDate, clockPt, alertKey } as any);
  } catch (err) {
    logger.warn('intraday.signoff_failed', {
      runId: args?.runId,
      marketDate: args?.marketDate,
      clockPt: args?.clockPt,
      error: String(err instanceof Error ? err.message : err),
    } as any);
  }
}
