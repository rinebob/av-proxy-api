// @topic #5 — Alpha Vantage Endpoint Expansion (opened 2026-08-15)
// Barrel file for shared/alpha-vantage

export * from './av-company-overview';
export * from './av-constants';
export * from './av-endpoint-configs';
export * from './av-endpoints';
export * from './av-global-quote';
export * from './av-historical-options';
export * from './av-symbol-search';
export * from './av-technical-indicators-config';
export * from './av-time-series';
export * from './av-time-series.types';
export * from './av-bulk-import.types';

// Default export: aggregate all named exports into a single object
import * as companyOverview from './av-company-overview';
import * as constants from './av-constants';
import * as endpointConfigs from './av-endpoint-configs';
import * as endpoints from './av-endpoints';
import * as globalQuote from './av-global-quote';
import * as historicalOptions from './av-historical-options';
import * as symbolSearch from './av-symbol-search';
import * as technicalIndicatorsConfig from './av-technical-indicators-config';
import * as timeSeries from './av-time-series';

const alphaVantage = {
  ...companyOverview,
  ...constants,
  ...endpointConfigs,
  ...endpoints,
  ...globalQuote,
  ...historicalOptions,
  ...symbolSearch,
  ...technicalIndicatorsConfig,
  ...timeSeries,
};

export default alphaVantage;
