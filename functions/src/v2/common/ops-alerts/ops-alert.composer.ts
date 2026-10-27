/**
 * Pure message composer for the canonical ops-alert seam (Topic #198).
 *
 * Maps run/health state → final human-readable SMS text. No Firestore, no
 * clock — every input is injected, so output is deterministic and fully
 * unit-testable. Failed symbols appear as counts only; symbol lists live in
 * run docs and logs. Target: ~2 SMS segments (<= ~300 chars), verbose
 * readable prose, no jargon requiring a legend.
 */

/** Job counters shared by intraday and POST run shapes. */
export interface RunJobCounts {
  createdJobs?: number;
  successJobs?: number;
  permanentFailureJobs?: number;
}

export interface IntradaySignoffInput extends RunJobCounts {
  /** ET trading date (YYYY-MM-DD). */
  marketDate?: string;
  /** PT clock label of the tick, e.g. '0800' | '1000' | '1200'. */
  clockPt: string;
  /** Run duration in milliseconds, when recorded on the run doc. */
  durationMs?: number;
}

export interface PostIntervalResult extends RunJobCounts {
  /** 'DAILY' | 'WEEKLY' | 'MONTHLY'. */
  interval: string;
}

export interface PostSignoffInput {
  marketDate?: string;
  /** POST sequence ('A' | 'B' | 'C'); defaults to 'A'. */
  sequence?: string;
  intervals: PostIntervalResult[];
}

/** Hard-down conditions that justify an exception text. */
export type OpsExceptionCondition =
  | 'run_missing'
  | 'pdr_missing'
  | 'orchestrator_no_start';

export interface ExceptionInput {
  condition: OpsExceptionCondition;
  marketDate?: string;
  /** PT clock label — identifies an intraday run. */
  clockPt?: string;
  /** POST sequence — identifies a POST run together with `interval`. */
  sequence?: string;
  /** POST interval — identifies a POST run together with `sequence`. */
  interval?: string;
  /** Expected/observed run doc id, included for lookup when known. */
  runId?: string;
}

const PDR_SENT = 'Partner data-ready message sent.';

function fmtDate(marketDate: string | undefined): string {
  return marketDate ?? 'unknown';
}

function fmtDuration(durationMs: number | undefined): string | undefined {
  if (typeof durationMs !== 'number' || !Number.isFinite(durationMs) || durationMs < 0) {
    return undefined;
  }
  const totalSeconds = Math.floor(durationMs / 1_000);
  const mm = Math.floor(totalSeconds / 60);
  const ss = String(totalSeconds % 60).padStart(2, '0');
  return mm > 0 ? `${mm}m ${ss}s` : `${totalSeconds}s`;
}

const isNum = (n: number | undefined): n is number =>
  typeof n === 'number' && Number.isFinite(n);

/** Failure count for a finished run — explicit field, else created - success. */
function failureCount(c: RunJobCounts): number | undefined {
  if (isNum(c.permanentFailureJobs)) return c.permanentFailureJobs;
  if (isNum(c.createdJobs) && isNum(c.successJobs)) {
    return Math.max(0, c.createdJobs - c.successJobs);
  }
  return undefined;
}

function countsPhrase(c: RunJobCounts): { refreshed?: string; failures?: number; noWork: boolean } {
  const failures = failureCount(c);
  if (isNum(c.createdJobs) && c.createdJobs === 0) {
    return { noWork: true, failures: failures ?? 0 };
  }
  if (!isNum(c.createdJobs) || !isNum(c.successJobs)) {
    return { noWork: false };
  }
  return {
    noWork: false,
    refreshed: `${c.successJobs} of ${c.createdJobs}`,
    failures,
  };
}

function failureTail(failures: number | undefined, docNoun: string): string {
  if (failures === undefined) return '';
  if (failures === 0) return ' - no failures.';
  return ` - ${failures} failed permanently; failed symbols are listed in the ${docNoun} and logs.`;
}

/**
 * Signoff for an intraday tick run (0800/1000/1200 PT), emitted after its
 * PDR publish succeeded.
 */
export function composeIntradaySignoff(input: IntradaySignoffInput): string {
  const head =
    `Savant pipeline signoff: intraday ${input.clockPt} PT run finished ` +
    `for market date ${fmtDate(input.marketDate)}.`;

  const { refreshed, failures, noWork } = countsPhrase(input);
  let body: string;
  if (noWork) {
    body = 'No symbols needed refreshing.';
  } else if (refreshed === undefined) {
    body = 'Symbol counts were not recorded.';
  } else {
    const dur = fmtDuration(input.durationMs);
    body = `Refreshed ${refreshed} symbols${dur ? ` in ${dur}` : ''}${failureTail(failures, 'run doc')}`;
  }

  return `${head} ${body} ${PDR_SENT}`;
}

/**
 * Signoff for a POST run after all A-pass intervals (DAILY/WEEKLY/MONTHLY)
 * completed and their PDRs were sent.
 */
export function composePostSignoff(input: PostSignoffInput): string {
  const seq = input.sequence ?? 'A';
  const head =
    `Savant pipeline signoff: POST ${seq} run finished ` +
    `for market date ${fmtDate(input.marketDate)}.`;

  if (input.intervals.length === 0) {
    return `${head} Interval results were not recorded. ${PDR_SENT}`;
  }

  const parts: string[] = [];
  let totalFailures = 0;
  let failuresKnown = true;
  for (const iv of input.intervals) {
    const name = iv.interval.toLowerCase();
    if (isNum(iv.createdJobs) && isNum(iv.successJobs)) {
      parts.push(`${name} ${iv.successJobs}/${iv.createdJobs}`);
    } else {
      parts.push(`${name} counts not recorded`);
    }
    const f = failureCount(iv);
    if (f === undefined) failuresKnown = false;
    else totalFailures += f;
  }

  const failSummary = failuresKnown
    ? totalFailures === 0
      ? ' - no failures.'
      : ` - ${totalFailures} failure${totalFailures === 1 ? '' : 's'} total; ` +
        'failed symbols are listed in the run docs and logs.'
    : '.';

  const n = input.intervals.length;
  return (
    `${head} Refreshed ${parts.join(', ')} symbols${failSummary} ` +
    `All ${n} partner data-ready messages sent; scheduled work for the day is done.`
  );
}

function runLabel(input: ExceptionInput): string {
  if (input.sequence && input.interval) {
    return `the POST ${input.sequence} ${input.interval} run`;
  }
  if (input.clockPt) {
    return `the intraday ${input.clockPt} PT run`;
  }
  return 'the scheduled run';
}

/**
 * Hard-down exception text — run missing, PDR missing, or orchestrator
 * never started. Names what was expected, what happened, and where to look.
 */
export function composeException(input: ExceptionInput): string {
  const label = runLabel(input);
  const date = fmtDate(input.marketDate);
  const tail = 'Needs attention.';

  switch (input.condition) {
    case 'run_missing':
      return (
        `Savant pipeline ALERT: ${label} for market date ${date} never ran - ` +
        `no run doc exists. Check Cloud Scheduler and functions logs. ${tail}`
      );
    case 'pdr_missing': {
      const doc = input.runId ? ` Run doc ${input.runId} has details.` : '';
      return (
        `Savant pipeline ALERT: ${label} for market date ${date} finished ` +
        `but its partner data-ready message was never sent.${doc} ${tail}`
      );
    }
    case 'orchestrator_no_start':
      return (
        `Savant pipeline ALERT: the orchestrator for ${label} for market date ${date} ` +
        `never started - no jobs were created. ` +
        `Check functions logs around the scheduled tick. ${tail}`
      );
  }
}
