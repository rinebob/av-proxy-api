// Symbol Management
export { listSymbols } from './symbol-manager/listSymbols.js';
export { syncSymbols } from './symbol-manager/syncSymbols.js';
export { getSymbolDetails } from './symbol-manager/getSymbolDetails.js';
export { cleanupInactiveSymbols } from './symbol-manager/cleanupInactive.js';
export { cleanupOldSyncRequests } from './symbol-manager/cleanupOldRequests.js';

// Alpha Vantage API Gateway
// export { alphaVantageApi } from './api/alpha-vantage/alpha-vantage-gateway';

// // Benzinga endpoints
// export { benzingaApi } from './api/benzinga/benzinga-gateway';

// // New AlphaVantage Data Refresher
// export { refreshAlphaVantageData } from './data-refresher/av-refresh-manager.js';

// // New Benzinga Data Refresher
// export { refreshBenzingaData } from './data-refresher/bz-calendar-refresh-manager.js';

// // New News Data Refresher
// export { refreshNewsEndpoints } from './data-refresher/bz-news-refresh-manager.js';


///////////////////// MIGRATED V2 FUNCTIONS ////////////////////////////////

// Alpha Vantage API Gateway
export { alphaVantageApiV2 } from './v2/alpha-vantage/alpha-vantage-gateway';

// Benzinga endpoints
export { benzingaApiV2 } from './v2/benzinga/benzinga-gateway';

// New AlphaVantage Data Refresher
export { refreshAlphaVantageDataV2 } from './v2/alpha-vantage/data-refresher/av-refresh-manager.js';

// New Benzinga Data Refresher
export { refreshBenzingaCalendarDataV2 } from './v2/benzinga/data-refresher/bz-calendar-refresh-manager.js';

// New News Data Refresher
export { refreshBenzingaNewsEndpointsV2 } from './v2/benzinga/data-refresher/bz-news-refresh-manager.js';

// Symbol Tracking Triggers
export { onSymbolAdded } from './v2/alpha-vantage/triggers/on-symbol-added.function.js';

// In the V2 section of index.ts
export { updateDailyTimeSeries } from './v2/alpha-vantage';

export { symbolSearch } from './v2/alpha-vantage/endpoints/av-symbol-search-endpoint.js';

export { listCollections } from './v2/common/functions/list-collections.js';

export { saveTrackedSymbol } from './v2/common/functions/save-tracked-symbol.function.js';

export { requestBenzingaNews } from './v2/benzinga/data-refresher/bz-news-request-manager.js';

// Remove the underscore from the function name then uncomment the next line to export it
// export { updateAllDailyTimeSeriesBulk } from './v2/alpha-vantage';