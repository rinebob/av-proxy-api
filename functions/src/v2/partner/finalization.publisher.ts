import { onDocumentCreated } from 'firebase-functions/v2/firestore';
import { FirestoreCollection } from '@shared/firestore';
import { enqueueDataReadyInternal } from './data-ready.handler';
import { PartnerPhase, PartnerRunStatus, PartnerRunType, PartnerPublishStatus } from './constants';
import { TimeSeriesInterval } from '@shared/alpha-vantage';
import { TradingPhase } from '@shared/health-metrics';
import { computeNextRefreshAtUtc } from '../alpha-vantage/data-refresher/av-refresh-manager';

/**
 * Publish a single partner data-ready message when a day is finalized.
 * Trigger: onCreate of /system/time-series-finalization/daily-adjusted/{marketDate}
 */
export const onDailyAdjustedFinalizedPublish = onDocumentCreated({
  document: `${FirestoreCollection.SYSTEM}/${FirestoreCollection.TIME_SERIES_FINALIZATION}/${FirestoreCollection.DAILY_ADJUSTED}/{marketDate}`,
}, async (event) => {
  const marketDate: string = event.params.marketDate;
  const data = event.data?.data() as any;

  // Build runId with current ET wall time (HHmm) and phase post
  const tz = 'America/New_York';
  const hhmm = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).format(new Date()).replace(':', '');
  const runId = `${marketDate}-${hhmm}-${PartnerPhase.POST}`;

  const totalSymbols = Number(data?.totalSymbols ?? 0);
  const finalizedCountTotal = Number(data?.finalizedCountTotal ?? 0);
  const finalizedAtUTC = typeof data?.finalizedAtUTC === 'string' ? data.finalizedAtUTC : undefined;

  const nextRefreshAtUTC = computeNextRefreshAtUtc(TradingPhase.POST);

  const runStatus: PartnerRunStatus = (finalizedCountTotal >= totalSymbols && totalSymbols > 0)
    ? PartnerRunStatus.COMPLETED
    : PartnerRunStatus.COMPLETED; // finalization doc implies completion for the day

  await enqueueDataReadyInternal({
    version: 'v1',
    runId,
    phase: PartnerPhase.POST,
    intervals: [TimeSeriesInterval.DAILY],
    time: Date.now(),
    marketDate,
    env: (process.env.NODE_ENV || 'dev') as string,
    status: PartnerPublishStatus.END,
    runStatus,
    nextRefreshAtUTC,
    finalizedAtUTC,
    pendingCount: 0,
    finalizedCountTotal,
  }, undefined, {
    runType: PartnerRunType.TS_DAILY_POST,
  });
});
