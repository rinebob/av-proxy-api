import { db } from '../../../firebase-admin-init';
import { Timestamp } from 'firebase-admin/firestore';
import { onSchedule } from 'firebase-functions/v2/scheduler';

import { DayOfWeek, TimeSeriesInterval } from '@shared/alpha-vantage';
import { FirestoreCollection } from '@shared/firestore';

import { betterLogger, type BetterLogPayload } from '../../utils/utils';
import { TS_POST_PDR_WATCHDOG_SCHEDULE } from '../../common/function-schedules';

const logger = betterLogger('pPW');

/**
 * Per-interval status for the health doc.
 * - `ok` — run doc exists and PDR was sent.
 * - `pdr_missing` — run doc exists but PDR was not sent.
 * - `run_missing` — run doc does not exist (scheduler did not fire).
 */
export type PostWatchdogIntervalStatus = 'ok' | 'pdr_missing' | 'run_missing';

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
 * Checks whether the POST A run for the given market date delivered
 * Partner Data Ready (PDR) messages for all 3 intervals (DAILY, WEEKLY,
 * MONTHLY).
 *
 * For each interval, queries the `realtime-runs/{runId}` doc and checks
 * `partnerDataReady.messageSent`. Logs an ERROR-level message for any
 * interval that is missing or has PDR not sent. Writes a health doc to
 * `realtime-health/{marketDate}` with per-interval and overall status.
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
      if (pdrSent) {
        status = 'ok';
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

  // Write health doc to realtime-health/{marketDate}
  await db.doc(`${FirestoreCollection.REALTIME_HEALTH}/${marketDate}`).set({
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
 * Fires at 1900 PT on weekdays — after the A (1335) and B (1800) POST runs.
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
