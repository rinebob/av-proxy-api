/**
 * Watchdog → canonical alert seam for hard-down exceptions (Topic #198).
 *
 * Composes the exception text, claims the send-once slot, and emits —
 * the exact pipeline signoff call sites use, condensed so watchdogs stay
 * focused on detection. Fail-safe end to end: compose is pure, the guard
 * is fail-closed (a claim error suppresses emission rather than risking a
 * duplicate), the emitter never throws, and the whole body is wrapped so
 * an alerting bug can never break the watchdog's health-doc path.
 */

import { betterLogger } from '../../utils/utils';
import { composeException, type OpsExceptionCondition } from './ops-alert.composer';
import { emitOpsAlert } from './ops-alert.emitter';
import { claimOpsAlert } from './ops-alert.guard';

const logger = betterLogger('opsAlert');

/**
 * Classifies a hard-down condition for a run doc that EXISTS but has no
 * PDR sent. Zero or absent `createdJobs` means the orchestrator never
 * produced work — `orchestrator_no_start` is the sharper diagnosis than
 * a generic missing-PDR. `?? 0` is intentional: both run-doc writers
 * initialize `createdJobs` at creation, so an absent field means a
 * malformed doc and "no jobs were created" is still the truthful bucket.
 */
export function exceptionConditionForRunDoc(createdJobs: number | undefined): OpsExceptionCondition {
  return (createdJobs ?? 0) === 0 ? 'orchestrator_no_start' : 'pdr_missing';
}

export interface WatchdogExceptionInput {
  /** Deterministic dedupe/audit key — build with `opsAlertKey` (e.g.
   *  'exception:post:2026-09-11:A:weekly:run_missing'). */
  alertKey: string;
  condition: OpsExceptionCondition;
  marketDate: string;
  /** PT clock label — identifies an intraday run; on POST runs it names
   *  the scheduled window the run was expected in (e.g. '1335'|'1800'|'0400'). */
  clockPt?: string;
  /** POST sequence — identifies a POST run together with `interval`. */
  sequence?: string;
  /** POST interval — identifies a POST run together with `sequence`. */
  interval?: string;
  /** Expected/observed run doc id, when known. */
  runId?: string;
  /** Run doc path to stamp opsSms.claimed — only when the doc exists. */
  runDocPath?: string;
  /** Extra structured context for the audit doc. */
  context?: Record<string, unknown>;
}

export async function emitWatchdogException(input: WatchdogExceptionInput): Promise<void> {
  try {
    const smsText = composeException({
      condition: input.condition,
      marketDate: input.marketDate,
      clockPt: input.clockPt,
      sequence: input.sequence,
      interval: input.interval,
      runId: input.runId,
    });

    const claim = await claimOpsAlert({
      alertKey: input.alertKey,
      kind: 'exception',
      runId: input.runId,
      marketDate: input.marketDate,
      runDocPath: input.runDocPath,
    });

    if (claim !== 'claimed') {
      // 'already-claimed': a redelivery/concurrent check already sent it —
      // intentional no-op. 'error': fail-closed; the guard logged the detail.
      logger.info('ops.alert_exception_skipped', {
        function: 'emitWatchdogException',
        alertKey: input.alertKey,
        runId: input.runId,
        marketDate: input.marketDate,
        message: claim === 'already-claimed' ? 'already-claimed' : 'claim-error',
      });
      return;
    }

    await emitOpsAlert({
      alertKey: input.alertKey,
      kind: 'exception',
      smsText,
      runId: input.runId,
      marketDate: input.marketDate,
      // Caller context first, condition pinned — the audit trail always
      // records the classified condition, never a caller-supplied one.
      context: { ...input.context, condition: input.condition },
    });
  } catch (err) {
    logger.error('ops.alert_exception_failed', {
      function: 'emitWatchdogException',
      alertKey: input?.alertKey,
      runId: input?.runId,
      marketDate: input?.marketDate,
      message: `exception alert failed: ${err instanceof Error ? err.message : String(err)}`,
    });
  }
}
