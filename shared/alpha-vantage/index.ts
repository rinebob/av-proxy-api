// Barrel file for shared/alpha-vantage

export * from './av-company-overview';
export * from './av-constants';
export * from './av-endpoint-configs';
export * from './av-endpoints';
export * from './global-quote';
export * from './symbol-search';
export * from './time-series';

// Default export: aggregate all named exports into a single object
import * as avCompanyOverview from './av-company-overview';
import * as avConstants from './av-constants';
import * as avEndpointConfigs from './av-endpoint-configs';
import * as avEndpoints from './av-endpoints';
import * as globalQuote from './global-quote';
import * as symbolSearch from './symbol-search';
import * as timeSeries from './time-series';

const alphaVantage = {
  ...avCompanyOverview,
  ...avConstants,
  ...avEndpointConfigs,
  ...avEndpoints,
  ...globalQuote,
  ...symbolSearch,
  ...timeSeries,
};

export default alphaVantage;
