import { db } from '../../../firebase-admin-init';
import { FirestoreCollection } from '@shared/firestore';
import type { TimeSeriesInterval } from '@shared/alpha-vantage';
import { POST_ALL_INTERVALS_RETRY_RUN_TYPE } from '../jobs/job-config';
import { getPostSkipReason } from './post-calendar-gate';

/** Small window of candidates — enough to walk past stale/anomalous docs. */
const CANDIDATE_LIMIT = 5;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

function todayNyIso(): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/New_York',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
}

/**
 * Returns the marketDate of the most recent POST retry-pass run doc
 * (`ts-post-all-intervals-retry` — the B/C passes) for the given
 * interval, or `null` when no retry runs exist.
 *
 * This is the same lookup the 04:00 PT C-pass orchestrator uses to pick
 * its target date; the C-pass watchdog reuses it so both sides agree on
 * which market date the C run should have covered.
 *
 * Candidates are validated — the newest doc that is well-formed, not
 * future-dated, and a trading day wins. A malformed, future-stamped, or
 * closed-day retry doc must not hijack the target: blind max() would
 * displace the real pending retry chain and (for the watchdog) produce
 * an unchecked closed-day check or a false expectation.
 */
export async function getLatestRetryRunMarketDateForInterval(
  interval: TimeSeriesInterval,
  todayEt?: string,
): Promise<string | null> {
  const today = todayEt ?? todayNyIso();
  const runsRef = db.collection(FirestoreCollection.REALTIME_RUNS);

  const snap = await runsRef
    .where('interval', '==', interval)
    .where('runType', '==', POST_ALL_INTERVALS_RETRY_RUN_TYPE)
    .orderBy('marketDate', 'desc')
    .limit(CANDIDATE_LIMIT)
    .get();

  for (const docSnap of snap.docs) {
    const md = String((docSnap.data() as any).marketDate || '');
    if (!ISO_DATE.test(md) || md > today) continue;
    try {
      if (getPostSkipReason(md) === null) return md;
    } catch {
      // Can't verify the trading status (e.g. year outside the holiday
      // table) — don't target what we can't reason about.
      continue;
    }
  }

  return null;
}
