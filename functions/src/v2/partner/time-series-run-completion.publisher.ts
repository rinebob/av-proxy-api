import { TimeSeriesInterval } from '@shared/alpha-vantage';

import { PartnerPublishStatus, PartnerRunType } from './constants';
import { enqueueDataReadyInternal } from './data-ready.handler';

interface JobsDateDocLike {
  marketDate: string;
  phase?: string;
  totalJobs?: number;
  successJobs?: number;
  permanentFailureJobs?: number;
  runId?: string;
}

export async function publishTimeSeriesRunCompletedFromJobs(marketDate: string, doc: JobsDateDocLike): Promise<void> {
  const phase = doc.phase === 'pre' ? 'pre' : 'post';

  // Derive which interval family this aggregator doc represents based on runId
  // suffix, falling back to DAILY when unknown. This is only for the
  // job-driven END publish path.
  const rawRunId = doc.runId || '';
  let intervals: TimeSeriesInterval[] = [TimeSeriesInterval.DAILY];
  let runType: PartnerRunType = PartnerRunType.TS_DAILY_POST;

  if (rawRunId.includes('TIME_SERIES_WEEKLY_ADJUSTED')) {
    intervals = [TimeSeriesInterval.WEEKLY];
    runType = PartnerRunType.TS_WEEKLY_POST;
  } else if (rawRunId.includes('TIME_SERIES_MONTHLY_ADJUSTED')) {
    intervals = [TimeSeriesInterval.MONTHLY];
    runType = PartnerRunType.TS_MONTHLY_POST;
  } else if (phase === 'pre') {
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

  await enqueueDataReadyInternal(payload, undefined, extraAttributes);
}
