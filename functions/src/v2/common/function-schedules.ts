/**
 * Schedule properties for Firebase Functions
 */

// for updateAllDailyTimeSeriesBulk
// functions/src/alpha-vantage/data-refresher/av-daily-time-series-bulk-updater.ts
/**
 * Alpha Vantage bulk quote updater schedule.
 *
 * Purpose: legacy bulk updater timing retained for reference/tools.
 * Cron: 12 13 * * * (13:12 UTC)
 * Timezone: Cloud Scheduler runs in UTC; corresponds to ~9:12 AM ET (EDT) / 6:12 AM PT.
 */
export const BULK_QUOTE_UPDATE_SCHEDULE = '12 13 * * *';

// for updateDailyTimeSeries
// functions/src/alpha-vantage/data-refresher/av-daily-time-series-updater.ts
/**
 * Daily time-series updater at regular market close boundary.
 *
 * Purpose: historical/legacy daily-close cycle at 16:30 ET.
 * Cron: 30 16 * * *
 * Timezone: America/New_York (set at function registration).
 */
export const DAILY_TIME_SERIES_UPDATE_SCHEDULE = '30 16 * * *';

// Pre-close run (time-series daily compact)
/**
 * Pre-close daily time-series run (compact write only).
 *
 * Purpose: writes PRE phase snapshot fields (intraday price/deltas) without finalizing bar.
 * Cron: 30 15 * * * (3:30 PM ET)
 * Timezone: America/New_York (set at function registration).
 */
export const TS_DAILY_PRE_CLOSE_SCHEDULE = '30 15 * * *';

// for refreshAlphaVantageDataV2
// functions/src/alpha-vantage/data-refresher/av-refresh-manager.ts
/**
 * Alpha Vantage non-time-series refresh manager schedule.
 *
 * Purpose: scans tracked symbols and non-TS endpoints; refreshes when stale per TTL.
 * Cron: 45 13 * * * (13:45 UTC)
 * Timezone: Cloud Scheduler is UTC; ~9:45 AM ET (EDT) / 6:45 AM PT.
 */
export const AV_REFRESH_MANAGER_SCHEDULE = '45 13 * * *';

// New schedules for time-series-only refresh cadence
/**
 * Post-close daily time-series run (daily only).
 *
 * Purpose: writes finalized daily bars and bumps freshness metadata.
 * Cron: 35 16 * * * (4:35 PM ET)
 * Timezone: America/New_York (set at function registration).
 */
export const TS_DAILY_POST_CLOSE_SCHEDULE = '35 16 * * *';

/**
 * Generic post-close schedule used by weekly/monthly time-series runs.
 *
 * Purpose: writes finalized weekly/monthly bars each trading day after close.
 * Cron: 40 16 * * * (4:40 PM ET)
 * Timezone: America/New_York (set at function registration).
 */
export const TS_POST_CLOSE_SCHEDULE = '40 16 * * *';

// for refreshBenzingaCalendarDataV2
// functions/src/benzinga/data-refresher/bz-calendar-refresh-manager.ts
/**
 * Benzinga Calendar refresh cadence.
 *
 * Purpose: periodically refresh calendar endpoints based on per-endpoint TTLs.
 * Cron: every 15 minutes
 * Timezone: explicit on function registration (America/Los_Angeles).
 */
export const BZ_CALENDAR_REFRESH_SCHEDULE = 'every 15 minutes';

// for refreshBenzingaNewsEndpointsV2
// functions/src/benzinga/data-refresher/bz-news-refresh-manager.ts
/**
 * Benzinga News refresh cadence.
 *
 * Purpose: periodically request news batches; handlers apply their own TTLs.
 * Cron: every 15 minutes
 * Timezone: set on function registration.
 */
export const BZ_NEWS_REFRESH_SCHEDULE = 'every 15 minutes';

// for cleanupInactiveSymbols
// functions/src/common/symbol-cleanup.ts
/**
 * Inactive symbol cleanup cadence.
 *
 * Purpose: remove or mark symbols no longer tracked/active to control storage.
 * Cron: 0 0 * * * (midnight daily, UTC)
 * Timezone: UTC (unless overridden at registration).
 */
export const INACTIVE_SYMBOL_CLEANUP_SCHEDULE = '0 0 * * *';

// for cleanupOldSyncRequests
// functions/src/common/symbol-cleanup.ts
/**
 * Old sync request cleanup cadence.
 *
 * Purpose: prune stale synchronization requests and ephemeral artifacts weekly.
 * Cron: 0 0 * * 0 (Sundays at 00:00 UTC)
 * Timezone: UTC (unless overridden at registration).
 */
export const OLD_SYNC_REQUEST_CLEANUP_SCHEDULE = '0 0 * * 0';

// for partner data-ready heartbeat publisher
/**
 * Heartbeat publisher schedule for partner-data-ready topic.
 *
 * Purpose: emit periodic test messages so external subscribers can validate wiring.
 * Cron: every 6 hours
 * Timezone: set at function registration.
 */
export const PARTNER_HEARTBEAT_SCHEDULE = 'every 6 hours';

// Central trading phase enum for time-series runs
/**
 * Trading phase used by time-series schedulers and handlers.
 *
 * PRE: Intraday snapshot writes; do not finalize bars or bump parent metadata.
 * POST: Post-close finalized writes; persist latest bar and update freshness.
 */
export enum TradingPhase {
  PRE = 'pre',
  POST = 'post',
}