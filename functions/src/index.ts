import 'module-alias/register';

console.log('Module aliases loaded:', require('module-alias'));

///////////////////// MIGRATED V2 FUNCTIONS ////////////////////////////////

// Alpha Vantage API Gateway
export { alphaVantageApiV2 } from './v2/alpha-vantage/alpha-vantage-gateway';

// Benzinga endpoints
export { benzingaApiV2 } from './v2/benzinga/benzinga-gateway';

// Partner endpoints (HTTP)
export { partnerTimeSeriesV2 } from './v2/partner/time-series-partner';

// Note: HTTP dataReadyWebhook has been removed. Publishing is internal-only via enqueueDataReadyInternal.

// New AlphaVantage Data Refresher
export { refreshAlphaVantageDataV2 } from './v2/alpha-vantage/data-refresher/av-refresh-manager.js';

// New HTTP wrapper for emulator testing only
export { refreshAlphaVantageDataV2Http } from './v2/alpha-vantage/data-refresher/av-refresh-http.js';

// New Benzinga Data Refresher
export { refreshBenzingaCalendarDataV2 } from './v2/benzinga/data-refresher/bz-calendar-refresh-manager.js';

// Symbol Tracking Triggers
export { onSymbolAdded } from './v2/alpha-vantage/triggers/on-symbol-added.function.js';

// In the V2 section of index.ts
export { updateDailyTimeSeries } from './v2/alpha-vantage';

export { listCollections } from './v2/common/functions/list-collections.js';

export { saveTrackedSymbol } from './v2/common/functions/save-tracked-symbol.function.js';

export { listSymbolsV2 } from './v2/common/functions/listSymbolsV2.js';

export { requestBenzingaNews } from './v2/benzinga/data-refresher/bz-news-request-manager.js';

// Remove the underscore from the function name then uncomment the next line to export it
// export { updateAllDailyTimeSeriesBulk } from './v2/alpha-vantage';