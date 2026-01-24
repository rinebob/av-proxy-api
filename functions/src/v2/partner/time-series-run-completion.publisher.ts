import { db } from '../../firebase-admin-init';
import { TimeSeriesInterval } from '@shared/alpha-vantage';
import { FirestoreCollection } from '@shared/firestore';

import { PartnerPublishStatus, PartnerRunType } from './constants';
import { enqueueDataReadyInternal } from './data-ready.handler';
import { betterLogger } from '../utils/utils';

interface JobsDateDocLike {
  marketDate: string;
  phase?: string;
  totalJobs?: number;
  successJobs?: number;
  permanentFailureJobs?: number;
  runId?: string;
  runStartedAt?: FirebaseFirestore.Timestamp;
  runCompletedAt?: FirebaseFirestore.Timestamp;
  // Optional per-symbol interval summary written by the jobs aggregator.
  // When present, this allows us to derive rich per-interval run summaries
  // (expected vs. created vs. successful vs. permanently failed jobs).
  symbols?: Record<
    string,
    {
      successIntervals?: TimeSeriesInterval[];
      permanentFailureIntervals?: TimeSeriesInterval[];
      readyEmitted?: boolean;
    }
  >;
}

/**
 * Publishes a single, universe-level "time-series run completed" event based on
 * the aggregated Alpha Vantage time-series job document for a given
 * {@link marketDate}.
 *
 * This function is called once per day (per phase) after the
 * time-series-jobs worker has finished processing all symbol-level jobs and
 * written a roll-up document that summarizes the outcome for that
 * {@link marketDate}. The roll-up document is represented here by the
 * {@link JobsDateDocLike} interface and is expected to contain the
 * high‑level counts of successful and permanently failed symbol runs, plus an
 * optional {@link runId} that uniquely identifies this run.
 *
 * Phase handling
 *  - If {@link JobsDateDocLike.phase} is exactly `'pre'`, this run is treated
 *    as a PRE market refresh and we only advertise the DAILY interval. The
 *    {@link PartnerRunType} is set to {@link PartnerRunType.TS_DAILY_PRE}.
 *  - For any other value (including `undefined`), the run is treated as a
 *    POST market universe refresh that covers DAILY, WEEKLY, and MONTHLY
 *    intervals. The {@link PartnerRunType} is set to
 *    {@link PartnerRunType.TS_POST_ALL_INTERVALS}.
 *
 * Payload semantics
 *  - `version`: Hard‑coded to `'v1'` to allow future evolution of the
 *    envelope without breaking existing consumers.
 *  - `runId`: Passed through directly from {@link JobsDateDocLike.runId} and
 *    may be any non‑empty string. Callers are responsible for ensuring the
 *    ID is human‑readable and stable enough for UI correlation (for example,
 *    `YYYY-MM-DD_DOW_PHASE_ENDPOINT`). If absent, an empty string is used.
 *  - `phase`: Normalized to `'pre'` or `'post'` as described above so that
 *    downstream consumers never need to handle arbitrary phase values.
 *  - `intervals`: Array of {@link TimeSeriesInterval} values that indicates
 *    which AV time‑series intervals are believed to be fully refreshed and
 *    ready for partner consumption.
 *  - `time`: Milliseconds since epoch at the moment of publishing. This is
 *    intended primarily for observability and ordering, not as a canonical
 *    market timestamp.
 *  - `marketDate`: The logical market date for which the time‑series run was
 *    executed (e.g. the trading day whose EOD bars are now available).
 *  - `status`: Always {@link PartnerPublishStatus.END} for this publisher,
 *    indicating that the universe‑level run has completed. (The corresponding
 *    START event is emitted elsewhere.)
 *  - `finalizedCountTotal`: Count of successfully finalized symbol jobs
 *    (derived from {@link JobsDateDocLike.successJobs}). This can be used by
 *    clients to verify completeness or display progress metrics.
 *  - `pendingCount`: Currently always `0` because, by definition, this
 *    publisher runs only after the job orchestrator has reached a terminal
 *    state for the date.
 *
 * Extra Pub/Sub attributes
 *  - `runType`: A {@link PartnerRunType} string that allows subscribers to
 *    distinguish PRE vs POST runs and their expected coverage without
 *    inspecting the JSON payload.
 *  - `successes` / `failures`: Stringified counts of successful and
 *    permanently failed symbol jobs. These are intended for lightweight
 *    routing/filtering at the Pub/Sub attribute level and for observability
 *    in logs.
 *
 * Side effects
 *  - This function has no return value. Its only side effect is to enqueue a
 *    message via {@link enqueueDataReadyInternal}, which ultimately publishes
 *    the event onto the partner "data‑ready" channel. Consumers such as
 *    dashboards or partner‑facing services can subscribe to this channel in
 *    order to be notified when a full time‑series refresh for a given
 *    {@link marketDate} and phase is complete.
 *
 * @param marketDate
 * A `YYYY-MM-DD` string representing the logical market date whose
 * universe‑level time‑series run has completed.
 *
 * @param doc
 * Aggregated job summary document for {@link marketDate}. At minimum,
 * should include a `phase` (or omit for POST), and the counts of
 * successful and permanently failed jobs. If a {@link runId} is present it
 * will be forwarded verbatim into the published payload.
 */
export async function publishTimeSeriesRunCompletedFromJobs(marketDate: string, doc: JobsDateDocLike): Promise<void> {
  const logger = betterLogger('pTSRC');
  const phase = doc.phase === 'pre' ? 'pre' : 'post';
 
  // This publisher represents a single universe-level time-series run that
  // covers DAILY, WEEKLY, and MONTHLY intervals for the given marketDate.
  // PRE, if ever used here, is treated as DAILY-only for compatibility.

  let intervals: TimeSeriesInterval[] = [
    TimeSeriesInterval.DAILY,
    TimeSeriesInterval.WEEKLY,
    TimeSeriesInterval.MONTHLY,
  ];
  let runType: PartnerRunType = PartnerRunType.TS_POST_ALL_INTERVALS;

  if (phase === 'pre') {
    intervals = [TimeSeriesInterval.DAILY];
    runType = PartnerRunType.TS_DAILY_PRE;
  }

  // Use the runId from the aggregator doc as the canonical identifier. The
  // validator now only requires a non-empty string, so we do not transform the
  // format here.
  const runId = doc.runId || '';

  const payload = {
    version: 'v1',
    runId,
    phase,
    intervals,
    time: Date.now(),
    marketDate,
    status: PartnerPublishStatus.END,
    finalizedCountTotal: doc.successJobs ?? 0,
    pendingCount: 0,
  } as any;

  const extraAttributes: Record<string, string> = {
    runType,
    successes: String(doc.successJobs ?? 0),
    failures: String(doc.permanentFailureJobs ?? 0),
  };

  const hasTiming = !!doc.runStartedAt && !!doc.runCompletedAt;
  if (hasTiming) {
    const durMs = doc.runCompletedAt!.toMillis() - doc.runStartedAt!.toMillis();
    try {
      const totalJobs = doc.totalJobs ?? 0;
      const successJobs = doc.successJobs ?? 0;
      const permanentFailureJobs = doc.permanentFailureJobs ?? 0;

      logger.info(
        `ts.jobs.run_completed mktDate=${marketDate} phase=${phase} runId=${runId} durMs=${durMs} totalJobs=${totalJobs} successJobs=${successJobs} permanentFailureJobs=${permanentFailureJobs}`,
        {
          function: 'pTSRC',
          marketDate,
          phase,
          runId,
          runDurationMs: durMs,
          totalJobs,
          successJobs,
          permanentFailureJobs,
        } as any,
      );

      // When the aggregator has written a per-symbol interval map, emit a
      // richer, human-friendly summary that breaks down expected/created
      // and terminal-status counts per interval, along with the list of
      // symbols that ended in a permanent failure for each interval.
      if (doc.symbols) {
        const symbolsMap = doc.symbols;
        const allSymbols = Object.keys(symbolsMap);
        const totalSymbols = allSymbols.length;

        const intervals: TimeSeriesInterval[] = [
          TimeSeriesInterval.DAILY,
          TimeSeriesInterval.WEEKLY,
          TimeSeriesInterval.MONTHLY,
        ];

        const perIntervalSummary: Record<
          string,
          {
            expectedJobs: number;
            createdJobs: number;
            successJobs: number;
            permanentFailureJobs: number;
            failedSymbols: string[];
          }
        > = {};

        for (const interval of intervals) {
          const intervalKey = String(interval);

          let createdJobs = 0;
          let successCount = 0;
          let permanentFailureCount = 0;
          const failedSymbols: string[] = [];

          for (const sym of allSymbols) {
            const state = symbolsMap[sym] || {};
            const successIntervals: TimeSeriesInterval[] =
              Array.isArray(state.successIntervals) ? state.successIntervals : [];
            const permanentFailureIntervals: TimeSeriesInterval[] =
              Array.isArray(state.permanentFailureIntervals) ? state.permanentFailureIntervals : [];

            const hasAnyStatus =
              successIntervals.includes(interval) ||
              permanentFailureIntervals.includes(interval);
            if (hasAnyStatus) {
              createdJobs += 1;
            }

            if (successIntervals.includes(interval)) {
              successCount += 1;
            }

            if (permanentFailureIntervals.includes(interval)) {
              permanentFailureCount += 1;
              failedSymbols.push(sym);
            }
          }

          perIntervalSummary[intervalKey] = {
            expectedJobs: totalSymbols,
            createdJobs,
            successJobs: successCount,
            permanentFailureJobs: permanentFailureCount,
            failedSymbols,
          };
        }

        logger.info(
          `ts.jobs.run_summary mktDate=${marketDate} phase=${phase} runId=${runId} ` +
            `totalSymbols=${totalSymbols} durMs=${durMs}`,
          {
            function: 'pTSRC',
            marketDate,
            phase,
            runId,
            runDurationMs: durMs,
            totalSymbols,
            summary: perIntervalSummary,
          } as any,
        );
      }
    } catch {}
  }

  // If this jobs doc is associated with a full-backfill run that wrote a
  // root-level backfill-runs document, mark that run record as COMPLETE now
  // that the universe has reached a terminal state.
  if (doc.runId) {
    try {
      const runRef = db.doc(`${FirestoreCollection.BACKFILL_RUNS}/${doc.runId}`);
      await runRef.set(
        {
          status: 'COMPLETE',
          runCompletedAt: doc.runCompletedAt ?? doc.runStartedAt ?? undefined,
        },
        { merge: true },
      );
    } catch {
      // Best-effort only; failure to flip this status should not block
      // publishing the completion event.
    }
  }

  await enqueueDataReadyInternal(payload, undefined, extraAttributes);
}
