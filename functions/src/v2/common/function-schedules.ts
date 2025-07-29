/**
 * Schedule properties for Firebase Functions
 */
import { DataMaintainerEndpoint } from "./common-dm";

 

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


/**
 * TTL configuration in seconds for each endpoint
 * These values should match the TTLs specified in data-maintainer.md
 */
export const ENDPOINT_TTLS: Record<DataMaintainerEndpoint, number> = {
    // Benzinga Endpoints (alphabetical order)
    [DataMaintainerEndpoint.ANALYST_INSIGHTS]: 72 * 60 * 60, // 72 hours
    [DataMaintainerEndpoint.ANALYST_RATINGS]: 72 * 60 * 60, // 72 hours
    [DataMaintainerEndpoint.DIVIDENDS]: 24 * 60 * 60, // 24 hours (recent), Indefinite handled in code
    [DataMaintainerEndpoint.ECONOMIC_CALENDAR]: 24 * 60 * 60, // 24 hours (future), Indefinite handled in code
    [DataMaintainerEndpoint.FUTURE_EARNINGS]: 4 * 60 * 60, // 4 hours (pre-release), Indefinite handled in code
    [DataMaintainerEndpoint.INSIDER_TRADES]: 24 * 60 * 60, // 24 hours (recent), 7 days handled in code
    [DataMaintainerEndpoint.MERGERS_ACQUISITIONS]: 24 * 60 * 60, // 24 hours (minimum, up to 7 days)
    [DataMaintainerEndpoint.TRENDING_TICKERS]: 15 * 60, // 15 minutes (trading hours)
    [DataMaintainerEndpoint.UNUSUAL_OPTIONS]: 5 * 60, // 5 minutes (trading hours)
    
    // Alpha Vantage Endpoints (alphabetical order)
    [DataMaintainerEndpoint.BALANCE_SHEET]: 30 * 24 * 60 * 60, // 30 days (quarterly refresh)
    [DataMaintainerEndpoint.CASH_FLOW]: 30 * 24 * 60 * 60, // 30 days (quarterly refresh)
    [DataMaintainerEndpoint.COMPANY_OVERVIEW]: 8 * 60 * 60, // 8 hours (temporary for production testing)
    [DataMaintainerEndpoint.ECONOMIC_INDICATORS]: 24 * 60 * 60, // 24 hours (most recent), Indefinite handled in code
    [DataMaintainerEndpoint.EARNINGS_CALENDAR]: 7 * 24 * 60 * 60, // 7 days
    [DataMaintainerEndpoint.GLOBAL_QUOTE]: 30, // 30 seconds
    [DataMaintainerEndpoint.HISTORICAL_EPS]: 30 * 24 * 60 * 60, // 30 days (quarterly refresh)
    [DataMaintainerEndpoint.HISTORICAL_OPTIONS]: 30 * 24 * 60 * 60, // 30 days (indefinite in doc, using 30 days as default)
    [DataMaintainerEndpoint.INCOME_STATEMENT]: 30 * 24 * 60 * 60, // 30 days (quarterly refresh)
    [DataMaintainerEndpoint.INSIDER_TRANSACTIONS]: 24 * 60 * 60, // 24 hours (recent), 7 days handled in code
    [DataMaintainerEndpoint.IPO_CALENDAR]: 24 * 60 * 60, // 24 hours
    [DataMaintainerEndpoint.NEWS_SENTIMENT]: 15 * 60, // 15 minutes (recent), Indefinite handled in code
    [DataMaintainerEndpoint.OPTIONS_CHAIN]: 30, // 30 seconds
    [DataMaintainerEndpoint.SECTOR]: 15 * 60, // 15 minutes (trading hours)
    [DataMaintainerEndpoint.SYMBOL_SEARCH]: 30 * 24 * 60 * 60, // 30 days (indefinite in doc, using 30 days as default)
    [DataMaintainerEndpoint.TECHNICAL_INDICATORS]: 5 * 60, // 5 minutes (intraday), 24h handled in code
    [DataMaintainerEndpoint.TIME_SERIES_DAILY_ADJUSTED]: 24 * 60 * 60, // 24 hours
    [DataMaintainerEndpoint.TIME_SERIES_INTRADAY]: 5 * 60, // 5 minutes (current day), Indefinite handled in code
    [DataMaintainerEndpoint.TOP_GAINERS_LOSERS]: 15 * 60, // 15 minutes (trading hours)
    [DataMaintainerEndpoint.TREASURY_YIELD]: 24 * 60 * 60, // 24 hours
    
    // Legacy/Deprecated - keeping these for backward compatibility (alphabetical order)
    [DataMaintainerEndpoint.EARNINGS]: 24 * 60 * 60, // 24 hours
    [DataMaintainerEndpoint.LISTING_STATUS]: 7 * 24 * 60 * 60, // 7 days
    [DataMaintainerEndpoint.OVERVIEW]: 24 * 60 * 60, // 24 hours
    [DataMaintainerEndpoint.QUOTE_ENDPOINT]: 5 * 60, // 5 minutes
    [DataMaintainerEndpoint.SECTOR_PERFORMANCE]: 60 * 60, // 1 hour
    [DataMaintainerEndpoint.TIME_SERIES]: 60 * 60, // 1 hour
  };