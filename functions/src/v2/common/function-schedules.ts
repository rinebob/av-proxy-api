/**
 * Schedule properties for Firebase Functions
 */ 

// for updateAllDailyTimeSeriesBulk
// functions/src/alpha-vantage/data-refresher/av-daily-time-series-bulk-updater.ts
// export const BULK_QUOTE_UPDATE_SCHEDULE = '20 20 * * *';  // 4:20 PM ET (20:20 UTC during EDT, 21:20 UTC during EST)
export const BULK_QUOTE_UPDATE_SCHEDULE = '12 13 * * *';  // 12:12 PM ET (13:12 UTC)


// for updateDailyTimeSeries
// functions/src/alpha-vantage/data-refresher/av-daily-time-series-updater.ts
// export const DAILY_TIME_SERIES_UPDATE_SCHEDULE = '20 20 * * *';  // 4:20 PM ET (20:20 UTC during EDT, 21:20 UTC during EST)
export const DAILY_TIME_SERIES_UPDATE_SCHEDULE = '45 13 * * *';  // 12:45 PM ET (13:45 UTC)


// for refreshAlphaVantageDataV2
// functions/src/alpha-vantage/data-refresher/av-refresh-manager.ts
// export const AV_REFRESH_MANAGER_SCHEDULE = 'every 15 minutes'; 
export const AV_REFRESH_MANAGER_SCHEDULE = '45 13 * * *';  // 12:45 PM ET (13:45 UTC)


// for refreshBenzingaCalendarDataV2
// functions/src/benzinga/data-refresher/bz-calendar-refresh-manager.ts
export const BZ_CALENDAR_REFRESH_SCHEDULE = 'every 15 minutes';


// for refreshBenzingaNewsEndpointsV2
// functions/src/benzinga/data-refresher/bz-news-refresh-manager.ts
export const BZ_NEWS_REFRESH_SCHEDULE = 'every 15 minutes';


// for cleanupInactiveSymbols
// functions/src/common/symbol-cleanup.ts
export const INACTIVE_SYMBOL_CLEANUP_SCHEDULE = '0 0 * * *'; // Every day at midnight


// for cleanupOldSyncRequests
// functions/src/common/symbol-cleanup.ts
export const OLD_SYNC_REQUEST_CLEANUP_SCHEDULE = '0 0 * * 0'; // Every Sunday at midnight