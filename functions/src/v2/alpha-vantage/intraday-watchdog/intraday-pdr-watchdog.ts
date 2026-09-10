import { db } from '../../../firebase-admin-init';
import { Timestamp } from 'firebase-admin/firestore';
import { onSchedule } from 'firebase-functions/v2/scheduler';

import { DayOfWeek } from '@shared/alpha-vantage';
import { FirestoreCollection } from '@shared/firestore';

import { betterLogger, type BetterLogPayload } from '../../utils/utils';
import { clockPtNow } from '../../common/bar-status/bar-status.service';
import { getIntradaySkipReason } from '../data-refresher/intraday-calendar-gate';
import { TS_DAILY_INTRADAY_WATCHDOG_SCHEDULE } from '../../common/function-schedules';

const logger = betterLogger('iPW');

/**
 * Tick status for the health doc.
 * - `ok` — run doc exists and PDR was sent.
 * - `pdr_missing` — run doc exists but PDR was not sent.
 * - `run_missing` — run doc does not exist (scheduler did not fire).
 */
export type IntradayWatchdogTickStatus = 'ok' | 'pdr_missing' | 'run_missing';

/**
 * PDR state for the health doc.
 * - `sent` — PDR message was sent.
 * - `not_sent` — PDR message was not sent.
 * - `n/a` — run doc does not exist, so PDR state is not applicable.
 */
export type IntradayWatchdogPdrState = 'sent' | 'not_sent' | 'n/a';

/**
 * Alert state for the health doc.
 * - `none` — no alert.
 * - `pdr_missing` — PDR was not sent.
 * - `run_missing` — run doc does not exist.
 */
export type IntradayWatchdogAlertState = 'none' | 'pdr_missing' | 'run_missing';

/**
 * Checks whether the intraday run for the given market date and tick
 * delivered its Partner Data Ready (PDR) message.
 *
 * If the market was closed for this tick (holiday, weekend, or
 * post-early-close), the watchdog skips silently — no run was expected.
 *
 * Otherwise, it queries the intraday run doc and checks
 * `partnerDataReady.messageSent`. It logs an ERROR-level message and
 * writes a health doc to `intraday-health/{marketDate}-{clockPt}` with
 * the tick status, PDR state, and alert state.
 *
 * @param options.marketDate ET trading date (YYYY-MM-DD).
 * @param options.clockPt    PT clock label (HHMM) of the tick to check.
 */
export async function checkIntradayPdrDelivery(options: {
  marketDate: string;
  clockPt: string;
}): Promise<void> {
  const { marketDate, clockPt } = options;
  const fnString = 'cIPD';

  // Calendar gate: skip silently if the market was closed for this tick.
  const skipReason = getIntradaySkipReason(marketDate, clockPt);
  if (skipReason) {
    logger.info('intraday.watchdog.skip', {
      function: fnString,
      marketDate,
      clockPt,
      reason: skipReason,
    } as BetterLogPayload);
    return;
  }

  // Construct the expected runId: {marketDate}-{DOW}-LIVE-{clockPt}
  const [y, m, d] = marketDate.split('-').map(Number);
  const dowIdx = new Date(y, m - 1, d).getDay();
  const DOW_ENUM: DayOfWeek[] = [
    DayOfWeek.Sun, DayOfWeek.Mon, DayOfWeek.Tue, DayOfWeek.Wed,
    DayOfWeek.Thu, DayOfWeek.Fri, DayOfWeek.Sat,
  ];
  const dow = DOW_ENUM[dowIdx];
  const runId = `${marketDate}-${dow.toUpperCase()}-LIVE-${clockPt}`;

  // Query the intraday run doc.
  const runRef = db.doc(`${FirestoreCollection.INTRADAY_RUNS}/${runId}`);
  const runSnap = await runRef.get();

  let tickStatus: IntradayWatchdogTickStatus;
  let pdrState: IntradayWatchdogPdrState;
  let alertState: IntradayWatchdogAlertState;

  if (!runSnap.exists) {
    tickStatus = 'run_missing';
    pdrState = 'n/a';
    alertState = 'run_missing';
    logger.error('intraday.watchdog.run_missing', {
      function: fnString,
      runId,
      marketDate,
      clockPt,
    } as BetterLogPayload);
  } else {
    const runData = runSnap.data() as any;
    const pdrSent = runData?.partnerDataReady?.messageSent === true;
    if (pdrSent) {
      tickStatus = 'ok';
      pdrState = 'sent';
      alertState = 'none';
    } else {
      tickStatus = 'pdr_missing';
      pdrState = 'not_sent';
      alertState = 'pdr_missing';
      logger.error('intraday.watchdog.pdr_missing', {
        function: fnString,
        runId,
        marketDate,
        clockPt,
      } as BetterLogPayload);
    }
  }

  // Write health doc to intraday-health/{marketDate}-{clockPt}
  const healthDocId = `${marketDate}-${clockPt}`;
  await db.doc(`${FirestoreCollection.INTRADAY_HEALTH}/${healthDocId}`).set({
    marketDate,
    clockPt,
    runId,
    tickStatus,
    pdrState,
    alertState,
    checkedAt: Timestamp.now(),
  });
}

/**
 * Maps a watchdog fire time (PT HHMM) to the tick being checked.
 *
 * The watchdog fires at 0815, 1015, and 1215 PT — 15 minutes after each
 * intraday tick. This maps the fire time back to the tick clock.
 *
 * Returns `null` if the current PT time does not correspond to a known
 * watchdog fire window.
 */
function mapWatchdogFireToTick(clockPt: string): string | null {
  const hour = clockPt.substring(0, 2);
  switch (hour) {
    case '08': return '0800';
    case '10': return '1000';
    case '12': return '1200';
    default: return null;
  }
}

/**
 * Scheduled function: Intraday PDR delivery watchdog.
 *
 * Fires at 0815, 1015, and 1215 PT on weekdays — 15 minutes after each
 * intraday snapshot tick. Verifies that the tick's run doc exists and
 * that the Partner Data Ready (PDR) message was sent.
 *
 * Alerts (ERROR-level log + health doc) if:
 * - The run doc doesn't exist (scheduler didn't fire).
 * - The run doc exists but PDR was not sent.
 *
 * Writes a health doc to `intraday-health/{marketDate}-{clockPt}` for
 * consumption by the future Run Status Dashboard (Topic #61).
 */
export const intradayPdrWatchdog = onSchedule({
  schedule: TS_DAILY_INTRADAY_WATCHDOG_SCHEDULE,
  timeZone: 'America/Los_Angeles',
}, async () => {
  const now = new Date();
  const marketDate = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/New_York',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);

  const fireClockPt = clockPtNow();
  const tickClockPt = mapWatchdogFireToTick(fireClockPt);
  if (!tickClockPt) {
    logger.info('intraday.watchdog.no_tick_for_clock', {
      fireClockPt,
    } as BetterLogPayload);
    return;
  }

  await checkIntradayPdrDelivery({ marketDate, clockPt: tickClockPt });
});
