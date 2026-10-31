import { db } from '../../../firebase-admin-init';
import { Timestamp } from 'firebase-admin/firestore';
import { onSchedule } from 'firebase-functions/v2/scheduler';

import { DayOfWeek, TimeSeriesInterval } from '@shared/alpha-vantage';
import { FirestoreCollection } from '@shared/firestore';

import { betterLogger, type BetterLogPayload } from '../../utils/utils';
import { TimeSeriesRunStatus } from '../jobs/time-series-jobs.model';
import { getPostSkipReason } from '../data-refresher/post-calendar-gate';
import { getLatestRetryRunMarketDateForInterval } from '../data-refresher/post-retry-target';
import {
  TS_POST_PDR_WATCHDOG_SCHEDULE,
  TS_POST_B_PDR_WATCHDOG_SCHEDULE,
  TS_POST_C_PDR_WATCHDOG_SCHEDULE,
} from '../../common/function-schedules';

const logger = betterLogger('pPW');

/**
 * Per-interval status for the health doc.
 * - `ok` — run doc exists and PDR was sent.
 * - `no_jobs` — B/C retry interval COMPLETE with zero jobs; no PDR was
 *   expected (empty retry set completes the run without a publish).
 * - `pdr_missing` — run doc exists but PDR was not sent.
 * - `run_missing` — run doc does not exist (scheduler did not fire).
 */
export type PostWatchdogIntervalStatus = 'ok' | 'no_jobs' | 'pdr_missing' | 'run_missing';

/**
 * Overall tick status for the health doc.
 * - `ok` — all intervals have PDR sent.
 * - `pdr_missing` — at least one interval has PDR not sent.
 * - `run_missing` — at least one interval's run doc does not exist.
 */
export type PostWatchdogTickStatus = 'ok' | 'pdr_missing' | 'run_missing';

/**
 * Alert state for the health doc.
 * - `none` — no alert.
 * - `pdr_missing` — at least one interval has PDR not sent.
 * - `run_missing` — at least one interval's run doc does not exist.
 */
export type PostWatchdogAlertState = 'none' | 'pdr_missing' | 'run_missing';

const DOW_ENUM: DayOfWeek[] = [
  DayOfWeek.Sun, DayOfWeek.Mon, DayOfWeek.Tue, DayOfWeek.Wed,
  DayOfWeek.Thu, DayOfWeek.Fri, DayOfWeek.Sat,
];

const POST_INTERVALS: TimeSeriesInterval[] = [
  TimeSeriesInterval.DAILY,
  TimeSeriesInterval.WEEKLY,
  TimeSeriesInterval.MONTHLY,
];

/**
 * Fail-open calendar lookup: returns the skip reason, or `null` when the
 * market date is a trading day OR the calendar can't decide. Retry-run
 * docs can carry years outside the holiday table — proceeding with the
 * check is safer than crashing the scheduled function.
 */
function safePostSkipReason(
  marketDate: string,
  fnString: string,
): ReturnType<typeof getPostSkipReason> {
  try {
    return getPostSkipReason(marketDate);
  } catch (e) {
    logger.warn('post.watchdog.calendar_error', {
      function: fnString,
      marketDate,
      message: `calendar lookup failed (${e instanceof Error ? e.message : e}) — proceeding`,
    } as BetterLogPayload);
    return null;
  }
}

/**
 * Checks whether the POST run for the given market date and sequence
 * delivered Partner Data Ready (PDR) messages for all 3 intervals
 * (DAILY, WEEKLY, MONTHLY).
 *
 * For each interval, queries the `realtime-runs/{runId}` doc and checks
 * `partnerDataReady.messageSent`. Logs an ERROR-level message for any
 * interval that is missing or has PDR not sent. Writes a health doc to
 * `realtime-health/{marketDate}` with per-interval and overall status.
 *
 * If the market was closed all day for the given date (weekend or
 * holiday), the check skips silently — no run was expected.
 *
 * For B/C sequences, an interval whose run doc is COMPLETE with zero
 * created jobs is reported `no_jobs` rather than `pdr_missing`: an empty
 * retry set completes the run without any job-terminal events, so no
 * PDR was ever expected for it.
 *
 * @param options.marketDate ET trading date (YYYY-MM-DD).
 * @param options.sequence   Run sequence to check (default: 'A').
 * @param options.clockPt    PT clock label (HHMM) of the run to check.
 */
export async function checkPostPdrDelivery(options: {
  marketDate: string;
  sequence?: string;
  clockPt?: string;
}): Promise<void> {
  const { marketDate } = options;
  const sequence = options.sequence ?? 'A';
  const clockPt = options.clockPt ?? '1335';
  const fnString = 'cPPD';

  // Calendar gate: skip silently if the market was closed all day — no
  // scheduled POST run happens on closed days (the orchestrators are
  // gated the same way).
  const skipReason = safePostSkipReason(marketDate, fnString);
  if (skipReason) {
    logger.info('post.watchdog.skip', {
      function: fnString,
      marketDate,
      message: `market closed (${skipReason}) seq=${sequence}`,
    } as BetterLogPayload);
    return;
  }

  // Construct runIds for all 3 intervals.
  const [y, m, d] = marketDate.split('-').map(Number);
  const dowIdx = new Date(y, m - 1, d).getDay();
  const dow = DOW_ENUM[dowIdx];
  const dowStr = String(dow).toUpperCase();

  const intervalStatuses: Record<string, PostWatchdogIntervalStatus> = {};
  let overallTickStatus: PostWatchdogTickStatus = 'ok';
  let overallAlertState: PostWatchdogAlertState = 'none';

  for (const interval of POST_INTERVALS) {
    const runId = `${marketDate}-${dowStr}-${sequence}-${interval.toUpperCase()}-LIVE-POST-${clockPt}`;
    const runRef = db.doc(`${FirestoreCollection.REALTIME_RUNS}/${runId}`);
    const runSnap = await runRef.get();

    let status: PostWatchdogIntervalStatus;

    if (!runSnap.exists) {
      status = 'run_missing';
      if (overallTickStatus !== 'run_missing') {
        overallTickStatus = 'run_missing';
        overallAlertState = 'run_missing';
      }
      logger.error('post.watchdog.run_missing', {
        function: fnString,
        runId,
        marketDate,
        interval,
      } as BetterLogPayload);
    } else {
      const runData = runSnap.data() as any;
      const pdrSent = runData?.partnerDataReady?.messageSent === true;
      // B/C intervals with an empty retry set complete with zero jobs —
      // no job-terminal events fire, so no PDR is ever published. An A
      // run with zero jobs is still anomalous (full universe) and keeps
      // the pdr_missing alert.
      const zeroJobComplete =
        sequence !== 'A' &&
        runData?.status === TimeSeriesRunStatus.COMPLETE &&
        (runData?.createdJobs ?? 0) === 0;
      if (pdrSent) {
        status = 'ok';
      } else if (zeroJobComplete) {
        status = 'no_jobs';
      } else {
        status = 'pdr_missing';
        if (overallTickStatus === 'ok') {
          overallTickStatus = 'pdr_missing';
          overallAlertState = 'pdr_missing';
        }
        logger.error('post.watchdog.pdr_missing', {
          function: fnString,
          runId,
          marketDate,
          interval,
        } as BetterLogPayload);
      }
    }

    intervalStatuses[interval] = status;
  }

  // Write health doc. A keeps the legacy {marketDate} id; B/C suffix the
  // sequence so their checks don't clobber the A doc.
  const healthDocId = sequence === 'A' ? marketDate : `${marketDate}-${sequence}`;
  await db.doc(`${FirestoreCollection.REALTIME_HEALTH}/${healthDocId}`).set({
    marketDate,
    sequence,
    clockPt,
    intervalStatuses,
    tickStatus: overallTickStatus,
    alertState: overallAlertState,
    checkedAt: Timestamp.now(),
  });
}

/**
 * Scheduled function: POST PDR delivery watchdog.
 *
 * Fires at 1900 PT on weekdays — after the A (1335) POST run completes.
 * Verifies that the A run's 3 interval run docs (DAILY, WEEKLY, MONTHLY)
 * exist and that their Partner Data Ready (PDR) messages were sent.
 *
 * Alerts (ERROR-level log + health doc) if:
 * - Any interval's run doc doesn't exist (scheduler didn't fire).
 * - Any interval's run doc exists but PDR was not sent.
 *
 * Writes a health doc to `realtime-health/{marketDate}` for consumption
 * by the future Run Status Dashboard (Topic #61).
 */
export const postPdrWatchdog = onSchedule({
  schedule: TS_POST_PDR_WATCHDOG_SCHEDULE,
  timeZone: 'America/Los_Angeles',
}, async () => {
  const now = new Date();
  const marketDate = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/New_York',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);

  await checkPostPdrDelivery({ marketDate, sequence: 'A', clockPt: '1335' });
});

/**
 * Checks whether the POST C run (04:00 PT next-morning catch-up)
 * delivered PDR for its target market date.
 *
 * The C orchestrator targets the marketDate of the latest retry-pass
 * run doc; this check performs the same lookup so both sides agree.
 * When no retry runs exist the C pass self-skips — and so do we.
 *
 * Today's gate: when today is market-closed the C orchestrator defers
 * its pass to the next trading day, so no C run was expected — skip
 * before resolving the target (a stale holiday-dated retry doc must
 * not produce a run_missing alert for a deliberately deferred pass).
 */
export async function checkPostCPdrDelivery(options: { todayEt?: string } = {}): Promise<void> {
  const fnString = 'cPCPD';
  const todayEt = options.todayEt ?? new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/New_York',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());

  const todaySkip = safePostSkipReason(todayEt, fnString);
  if (todaySkip) {
    logger.info('post.watchdog.skip', {
      function: fnString,
      marketDate: todayEt,
      message: `market closed (${todaySkip}) — C pass deferred by orchestrator gate`,
    } as BetterLogPayload);
    return;
  }

  const targetDate = await getLatestRetryRunMarketDateForInterval(TimeSeriesInterval.DAILY, todayEt);
  if (!targetDate) {
    logger.info('post.watchdog.skip', {
      function: fnString,
      message: 'no retry runs — C pass not expected',
    } as BetterLogPayload);
    return;
  }

  await checkPostPdrDelivery({ marketDate: targetDate, sequence: 'C', clockPt: '0400' });
}

/**
 * Scheduled function: POST B-pass PDR delivery watchdog.
 *
 * Fires at 1915 PT on weekdays — after the B run's 60-minute window
 * (1800 start). Verifies the B pass's 3 interval run docs exist and
 * that their PDRs were sent (or the intervals completed with an empty
 * retry set — `no_jobs`).
 */
export const postPdrWatchdogB = onSchedule({
  schedule: TS_POST_B_PDR_WATCHDOG_SCHEDULE,
  timeZone: 'America/Los_Angeles',
}, async () => {
  const now = new Date();
  const marketDate = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/New_York',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);

  await checkPostPdrDelivery({ marketDate, sequence: 'B', clockPt: '1800' });
});

/**
 * Scheduled function: POST C-pass PDR delivery watchdog.
 *
 * Fires at 0515 PT on weekdays — after the C run's window (0400 start).
 * Resolves the C run's target market date via the same latest-retry-run
 * lookup the orchestrator uses, then verifies PDR delivery. Skips when
 * no retry runs exist (the C pass was not expected).
 */
export const postPdrWatchdogC = onSchedule({
  schedule: TS_POST_C_PDR_WATCHDOG_SCHEDULE,
  timeZone: 'America/Los_Angeles',
}, async () => {
  await checkPostCPdrDelivery();
});
