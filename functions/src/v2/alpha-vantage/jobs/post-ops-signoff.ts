/**
 * POST-A last-interval signoff emission site (Topic #198, Task #208).
 *
 * Called by the realtime run-completion aggregator AFTER an A-sequence
 * interval's partner data-ready (PDR) publish succeeded and
 * `partnerDataReady.messageSent` was written. The three A-pass intervals
 * (DAILY/WEEKLY/MONTHLY) complete independently — whichever finishes last
 * finds all siblings' messageSent true and emits the single all-intervals
 * signoff.
 *
 * Sibling run docs are located by reconstructing their runIds from the
 * triggering runId (same marketDate/dow/sequence/runType/phase/clockPt,
 * interval swapped). A collection query is deliberately NOT used: MANUAL
 * and LIVE A-runs share the same marketDate+sequence+runType doc fields,
 * so a query could gate on an unrelated same-day manual pass.
 *
 * Only sequence-A initial runs qualify — B/C retry passes emit nothing;
 * hard-down conditions are covered by watchdog exceptions instead.
 *
 * Fail-safe contract: this function never throws. Every failure mode is
 * logged and swallowed — alert trouble must never fail a Cloud Task,
 * break a PDR publish, or mark a run incomplete.
 */

import { db } from '../../../firebase-admin-init';
import { FirestoreCollection } from '@shared/firestore';
import { TimeSeriesInterval, DayOfWeek } from '@shared/alpha-vantage';
import { TradingPhase } from '@shared/health-metrics';

import { betterLogger } from '../../utils/utils';
import { composePostSignoff, type PostIntervalResult } from '../../common/ops-alerts/ops-alert.composer';
import { emitOpsAlert } from '../../common/ops-alerts/ops-alert.emitter';
import { claimOpsAlert } from '../../common/ops-alerts/ops-alert.guard';
import { RunIdFactory } from './runid-factory';
import { POST_ALL_INTERVALS_INITIAL_RUN_TYPE } from './job-config';
import type { RealtimeRun } from './time-series-jobs.model';

const logger = betterLogger('rTRA.Signoff');

const POST_INTERVALS: TimeSeriesInterval[] = [
  TimeSeriesInterval.DAILY,
  TimeSeriesInterval.WEEKLY,
  TimeSeriesInterval.MONTHLY,
];

export interface PostASignoffArgs {
  /** RunId of the interval run whose PDR publish just completed. */
  runId: string;
  /** ET trading date (YYYY-MM-DD) from the run doc — log/mismatch-check
   * only; the alertKey identity derives from the parsed runId. */
  marketDate: string;
  /** POST sequence from the run doc ('A' | 'B' | 'C' | ...). */
  sequence?: string;
  /** Run type from the run doc — must be the initial all-intervals pass. */
  runType?: string;
}

export async function emitPostASignoff(args: PostASignoffArgs): Promise<void> {
  try {
    const { runId, marketDate, sequence, runType } = args;

    if (sequence !== 'A' || runType !== POST_ALL_INTERVALS_INITIAL_RUN_TYPE) {
      logger.info('post.signoff_skipped', { runId, marketDate, sequence, runType, reason: 'not-post-a' } as any);
      return;
    }

    // The runId is the authoritative identity — doc fields can only widen
    // the gate, never spoof it. Reject anything whose runId isn't a
    // LIVE A-sequence POST run: a MANUAL A-pass is a distinct identity and
    // must not claim the scheduled pass's signoff key (the post watchdog
    // watches LIVE runs only).
    if (!RunIdFactory.isValidRealtimeRunId(runId)) {
      logger.warn('post.signoff_skipped', { runId, marketDate, reason: 'unparseable-runid' } as any);
      return;
    }
    const parts = RunIdFactory.parseRealtimeRunId(runId);
    if (parts.sequence !== 'A' || parts.phase !== 'POST' || parts.runType !== 'LIVE') {
      logger.info('post.signoff_skipped', {
        runId,
        marketDate,
        reason: parts.runType !== 'LIVE' ? 'not-live' : 'runid-not-post-a',
      } as any);
      return;
    }
    if (parts.marketDate !== marketDate) {
      logger.warn('post.signoff_marketdate_mismatch', {
        runId,
        docMarketDate: marketDate,
        runIdMarketDate: parts.marketDate,
      } as any);
    }
    const canonicalMarketDate = parts.marketDate;

    // Reconstruct the three sibling runIds — the orchestrator creates all
    // A-run docs from identical params with only the interval differing.
    const siblingRunIds = POST_INTERVALS.map((interval) => ({
      interval,
      runId: RunIdFactory.createRealtime({
        marketDate: parts.marketDate,
        dow: parts.dow as DayOfWeek,
        interval,
        isManual: parts.runType === 'MANUAL',
        sequence: parts.sequence,
        phase: parts.phase as TradingPhase,
        clockPt: parts.clockPt,
      }),
    }));

    // Read all three sibling run docs; every one must show messageSent.
    const intervals: PostIntervalResult[] = [];
    const pending: string[] = [];
    const failedSymbols: string[] = [];

    for (const { interval, runId: sibRunId } of siblingRunIds) {
      const snap = await db.doc(`${FirestoreCollection.REALTIME_RUNS}/${sibRunId}`).get();
      const data = snap.exists ? (snap.data() as RealtimeRun) : undefined;
      if (!data?.partnerDataReady?.messageSent) {
        pending.push(String(interval).toUpperCase());
        continue;
      }
      intervals.push({
        interval: String(interval).toUpperCase(),
        createdJobs: data.createdJobs,
        successJobs: data.successJobs,
        permanentFailureJobs: data.permanentFailureJobs,
      });
      if (Array.isArray(data.permanentFailureSymbols)) {
        for (const s of data.permanentFailureSymbols) {
          if (!failedSymbols.includes(s)) failedSymbols.push(s);
        }
      }
    }

    if (pending.length > 0) {
      // A sibling interval hasn't finished publishing yet — the signoff is
      // for the LAST finisher. Informational, not an error.
      logger.info('post.signoff_pending', { runId, marketDate, pending } as any);
      return;
    }

    const alertKey = `signoff:post:${canonicalMarketDate}:A`;
    const smsText = composePostSignoff({ marketDate: canonicalMarketDate, sequence: 'A', intervals });

    const claim = await claimOpsAlert({
      alertKey,
      kind: 'signoff',
      runId,
      marketDate: canonicalMarketDate,
      runDocPath: `${FirestoreCollection.REALTIME_RUNS}/${runId}`,
    });

    if (claim !== 'claimed') {
      // 'already-claimed': a concurrent interval completion won — intentional
      // no-op. 'error': fail-closed, the guard logged the detail.
      logger.info('post.signoff_skipped', {
        runId,
        marketDate,
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
      marketDate: canonicalMarketDate,
      context: {
        sequence: 'A',
        intervals,
        failedSymbols: failedSymbols.length > 0 ? failedSymbols : undefined,
        siblingRunIds: siblingRunIds.map((s) => s.runId),
      },
    });
    logger.info('post.signoff_emit_invoked', { runId, marketDate, alertKey } as any);
  } catch (err) {
    logger.warn('post.signoff_failed', {
      runId: args?.runId,
      marketDate: args?.marketDate,
      error: String(err instanceof Error ? err.message : err),
    } as any);
  }
}
