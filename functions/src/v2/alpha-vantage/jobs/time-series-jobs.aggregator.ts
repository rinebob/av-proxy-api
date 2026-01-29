import { db } from '../../../firebase-admin-init';
import { Timestamp } from 'firebase-admin/firestore';

import { TimeSeriesInterval } from '@shared/alpha-vantage';
import { FirestoreCollection } from '@shared/firestore';
import { publishTimeSeriesRunCompletedFromJobs } from '../../partner/time-series-run-completion.publisher';
import { TimeSeriesJobTerminalStatus } from './time-series-jobs.model';

export interface OnTimeSeriesJobTerminalArgs {
  marketDate: string;
  symbol: string;
  interval: TimeSeriesInterval;
  status: TimeSeriesJobTerminalStatus;
}

export interface OnTimeSeriesJobTerminalResult {
  newlyReadySymbols: string[];
  runJustCompleted: boolean;
}

interface SymbolIntervalState {
  successIntervals: TimeSeriesInterval[];
  permanentFailureIntervals: TimeSeriesInterval[];
  readyEmitted?: boolean;
}

interface TimeSeriesJobsDateDoc {
  marketDate: string;
  phase?: string;
  totalJobs?: number;
  successJobs?: number;
  permanentFailureJobs?: number;
  symbols?: Record<string, SymbolIntervalState>;
  runStartedAt?: FirebaseFirestore.Timestamp;
  runCompletedAt?: FirebaseFirestore.Timestamp;
  runId?: string;
  dataReadyPublished?: boolean;
  // True when the scheduler has finished creating/enqueuing all jobs
  // for this marketDate/phase. This guards against declaring the
  // universe-level run complete while additional jobs are still
  // being created.
  jobsCreationComplete?: boolean;
  // High-level status for this marketDate run. Set to 'IN_PROGRESS' when any
  // job is created/enqueued and flipped to 'COMPLETE' when all jobs reach a
  // terminal state (success or permanent failure).
  status?: string;
}

const REQUIRED_INTERVALS: ReadonlyArray<TimeSeriesInterval> = [
  TimeSeriesInterval.DAILY,
  TimeSeriesInterval.WEEKLY,
  TimeSeriesInterval.MONTHLY,
];

export async function onTimeSeriesJobTerminal(
  args: OnTimeSeriesJobTerminalArgs,
): Promise<OnTimeSeriesJobTerminalResult> {
  const { marketDate, symbol, interval, status } = args;
  const dateRef = db.doc(`${FirestoreCollection.TIME_SERIES_JOBS}/${marketDate}`);

  const newlyReadySymbols: string[] = [];
  let runJustCompleted = false;

  await db.runTransaction(async (tx) => {
    const snap = await tx.get(dateRef);
    if (!snap.exists) {
      return;
    }

    const data = snap.data() as TimeSeriesJobsDateDoc;
    const now = Timestamp.now();

    if (!data.runStartedAt) {
      data.runStartedAt = now;
    }

    const successJobs = typeof data.successJobs === 'number' ? data.successJobs : 0;
    const permanentFailureJobs = typeof data.permanentFailureJobs === 'number' ? data.permanentFailureJobs : 0;
    const symbols = data.symbols ?? {};

    const current: SymbolIntervalState = symbols[symbol] ?? {
      successIntervals: [],
      permanentFailureIntervals: [],
    };

    let nextSuccessJobs = successJobs;
    let nextPermanentFailureJobs = permanentFailureJobs;

    if (status === 'SUCCESS') {
      nextSuccessJobs += 1;
      if (!current.successIntervals.includes(interval)) {
        current.successIntervals = [...current.successIntervals, interval];
      }
    } else {
      nextPermanentFailureJobs += 1;
      if (!current.permanentFailureIntervals.includes(interval)) {
        current.permanentFailureIntervals = [...current.permanentFailureIntervals, interval];
      }
    }

    const allIntervalsSatisfied = REQUIRED_INTERVALS.every((req) =>
      current.successIntervals.includes(req),
    );

    if (allIntervalsSatisfied && !current.readyEmitted) {
      current.readyEmitted = true;
      newlyReadySymbols.push(symbol);
    }

    symbols[symbol] = current;

    const totalJobs = typeof data.totalJobs === 'number' ? data.totalJobs : 0;
    const finishedJobs = nextSuccessJobs + nextPermanentFailureJobs;
    const jobsCreationComplete = data.jobsCreationComplete === true;

    const nextData: TimeSeriesJobsDateDoc = {
      ...data,
      successJobs: nextSuccessJobs,
      permanentFailureJobs: nextPermanentFailureJobs,
      symbols,
    };

    // Only declare the universe-level run COMPLETE once:
    //  - The scheduler has finished creating all jobs for this marketDate
    //    (jobsCreationComplete === true), and
    //  - Every created job has reached a terminal state.
    if (
      jobsCreationComplete &&
      totalJobs > 0 &&
      finishedJobs === totalJobs &&
      !data.dataReadyPublished
    ) {
      nextData.runCompletedAt = now;
      nextData.dataReadyPublished = true;
      // All jobs for this marketDate have reached a terminal state.
      nextData.status = 'COMPLETE';
      runJustCompleted = true;
    }

    tx.set(dateRef, nextData, { merge: true });
  });

  if (runJustCompleted) {
    const snap = await db.doc(`${FirestoreCollection.TIME_SERIES_JOBS}/${args.marketDate}`).get();
    if (snap.exists) {
      const data = snap.data() as TimeSeriesJobsDateDoc;
      await publishTimeSeriesRunCompletedFromJobs(args.marketDate, data);
    }
  }

  return { newlyReadySymbols, runJustCompleted };
}
