/**
 * @topic #5 — Alpha Vantage Endpoint Expansion (opened 2026-08-15)
 */
import dotenv from 'dotenv';
import fs from 'node:fs';
import path from 'node:path';

// Load local emulator env only from a non-dot file so Firebase emulator doesn't print dotenv messages
// This is intentionally silent and only active during emulator runs
(() => {
  if (process.env.FUNCTIONS_EMULATOR !== 'true') return;
  const candidates = [
    // Run from functions dir
    path.resolve(process.cwd(), 'local-dev.env.alpha-vantage-proxy-api'),
    // Run from repo root
    path.resolve(process.cwd(), 'functions', 'local-dev.env.alpha-vantage-proxy-api'),
    // Fallback relative to compiled location
    path.resolve(__dirname, '../local-dev.env.alpha-vantage-proxy-api'),
    path.resolve(__dirname, '../../local-dev.env.alpha-vantage-proxy-api'),
  ];
  for (const p of candidates) {
    try {
      if (fs.existsSync(p)) { dotenv.config({ path: p }); break; }
    } catch {}
  }
})();

///////////////////// MIGRATED V2 FUNCTIONS ////////////////////////////////

// Alpha Vantage API Gateway
export { alphaVantageApiV2 } from './v2/alpha-vantage/alpha-vantage-gateway';

// Benzinga endpoints
export { benzingaApiV2 } from './v2/benzinga/benzinga-gateway';

// Partner endpoints (HTTP)
export { partnerTimeSeriesV2 } from './v2/partner/time-series-partner';
export { partnerListTrackedSymbolsV2 } from './v2/partner/tracked-symbols-partner';
export { partnerDataReadyPublishV2 } from './v2/partner/data-ready.publish.function';
export { partnerMarketHolidays } from './v2/partner/market-holidays-partner';
export { partnerIntradaySnapshotV2 } from './v2/partner/intraday-snapshot-partner';
export { partnerCompanyOverviewV2 } from './v2/partner/company-overview-partner';
export { partnerHistoricalOptionsV2 } from './v2/partner/historical-options-partner';
export { partnerHistoricalOptionsContractV2 } from './v2/partner/historical-options-contract-partner';
export { partnerListContractsV2 } from './v2/partner/list-contracts-partner';
export { partnerContractCatalogV2 } from './v2/partner/partner-contract-catalog-partner';
export { partnerSpreadTimeSeries } from './v2/partner/spread-time-series-partner';
export { partnerSpreadTimeSeriesBatch } from './v2/partner/spread-time-series-batch-partner';
export { partnerTechnicalIndicatorsV2 } from './v2/partner/technical-indicators-partner';

// Note: HTTP dataReadyWebhook has been removed. Publishing is internal-only via enqueueDataReadyInternal.

// New AlphaVantage Data Refresher
export { refreshAlphaVantageDataV2 } from './v2/alpha-vantage/data-refresher/av-refresh-manager';

// Note: The following AV time-series schedulers are exported for deploy.
// The 30-minute evening retry and 06:30 catch-up handlers are defined but INTENTIONALLY NOT exported/deployed:
// - refreshAvDailyTimeSeriesPostEveningRetry30
// - refreshAvDailyTimeSeriesPostMorning0630
export {
  refreshAvDailyTimeSeriesIntradayHourly,
  refreshAvDailyTimeSeriesPostClose,
  refreshAvTimeSeriesPostAllIntervals,
  refreshAvWeeklyTimeSeriesPostClose,
  refreshAvMonthlyTimeSeriesPostClose,
  refreshAvDailyTimeSeriesPostEveningRetry00,
  refreshAvDailyTimeSeriesPostMorning0700,
} from './v2/alpha-vantage/data-refresher/av-time-series-refresh-manager';

// Intraday RTH-close snapshot superseded by hourly Cloud Tasks pipeline (refreshAvDailyTimeSeriesIntradayHourly)

// New Benzinga Data Refresher
export { refreshBenzingaCalendarDataV2 } from './v2/benzinga/data-refresher/bz-calendar-refresh-manager';

// Health Metrics Scheduler
export {
    healthMetricsScheduler,
    purgeOldHealthHistory,
    purgeOldRequestLogs
} from './v2/health-metrics/health-metrics.scheduler';

// Health Metrics HTTPS (internal)
export {
  getHealthSummary,
  getRequestLogs,
  getHealthMetrics,
  getSymbolStatusV2,
  getSymbolMetricsV2,
} from './v2/health-metrics/health-metrics.function';

// Symbol Tracking Triggers
export { onSymbolAdded } from './v2/alpha-vantage/triggers/on-symbol-added.function';

// In the V2 section of index.ts
// Legacy daily updater export removed; use TS_* scheduled wrappers and HTTP emu endpoints.

export { listCollections } from './v2/common/functions/list-collections';

export { cleanupOldRunDocs } from './v2/common/run-doc-cleanup';

export { saveTrackedSymbol } from './v2/common/functions/save-tracked-symbol.function';

export { listSymbolsV2 } from './v2/common/functions/listSymbolsV2';

export { getSymbolDetailsV2 } from './v2/common/functions/get-symbol-details';

export { requestBenzingaNews } from './v2/benzinga/data-refresher/bz-news-request-manager';

// Bulk symbol import for tracked-symbols
export { bulkImportSymbolsV2 } from './v2/alpha-vantage/bulk-import/bulk-import-symbols.function';

// Partner heartbeat publisher (scheduled)
export { partnerDataReadyHeartbeat } from './v2/partner/heartbeat.publisher';

// Partner finalization-based publisher
export { onDailyAdjustedFinalizedPublish } from './v2/partner/finalization.publisher';

// Remove the underscore from the function name then uncomment the next line to export it
// export { updateAllDailyTimeSeriesBulk } from './v2/alpha-vantage';

// Split History Remediation Task
export { remediateSplitHistory } from './v2/alpha-vantage/tasks/split-remediator.task';

// Company Overview onboarding retry task
export { processCompanyOverviewOnboardingTask } from './v2/alpha-vantage/tasks/company-overview-onboarding.task';

// Cloud Task worker and DEV/EMULATOR HTTP entry point for AV
// time-series jobs. The task wrapper is the production target;
// the HTTP function remains emulator/dev-only.
export { processTimeSeriesJobTask } from './v2/alpha-vantage/jobs/time-series-jobs.task';
export { processTimeSeriesJobDev } from './v2/alpha-vantage/jobs/time-series-jobs.http';
export { processIntradaySnapshotJobTask } from './v2/alpha-vantage/jobs/intraday-snapshot-jobs.task';
export { runIntradaySnapshotDev, processIntradaySnapshotJobDev } from './v2/alpha-vantage/jobs/intraday-snapshot-jobs.http';

export { processFullBackfillRunTask } from './v2/alpha-vantage/data-refresher/av-full-backfill.task';

export { triggerFullBackfillJobs } from './v2/alpha-vantage/data-refresher/av-full-backfill.http';

// Historical options corpus seed worker (exported for deployment after pilot approval)
export { processHistoricalOptionsCorpusSeedTask } from './v2/historical-options-corpus/handlers/corpus-seed.task';

export { triggerHistoricalOptionsPilot } from './v2/historical-options-corpus/handlers/trigger-historical-options-pilot.http';
export { triggerHistoricalOptionsTimeSeriesBuild } from './v2/historical-options-corpus/handlers/trigger-historical-options-time-series-build.http';
export { storageFileViewer } from './v2/historical-options-corpus/handlers/storage-file-viewer.http';
export { processOptionsIndexWriteTask } from './v2/historical-options-corpus/handlers/options-index-write.task';
export { refreshHistoricalOptionsCorpusNightly } from './v2/historical-options-corpus/jobs/historical-options-nightly.scheduler';
export { processHistoricalOptionsTsBuildTask } from './v2/historical-options-corpus/handlers/ts-build.task';