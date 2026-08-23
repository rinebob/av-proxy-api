// Barrel file for shared/alpha-vantage

export * from './av-company-overview';
export * from './av-constants';
export * from './av-earnings-calendar-types';
export * from './av-earnings-estimates-types';
export * from './av-earnings-types';
export * from './av-endpoint-configs';
export * from './av-endpoints';
export * from './av-global-quote';
export * from './av-historical-options';
export * from './av-symbol-search';
export * from './av-technical-indicators-config';
export * from './av-technical-indicators-types';
export * from './av-time-series';
export * from './av-time-series.types';
export * from './av-bulk-import.types';
export * from './savant-api-endpoints';

// Default export: aggregate all named exports into a single object
import * as companyOverview from './av-company-overview';
import * as constants from './av-constants';
import * as earningsCalendarTypes from './av-earnings-calendar-types';
import * as earningsEstimatesTypes from './av-earnings-estimates-types';
import * as earningsTypes from './av-earnings-types';
import * as endpointConfigs from './av-endpoint-configs';
import * as endpoints from './av-endpoints';
import * as globalQuote from './av-global-quote';
import * as historicalOptions from './av-historical-options';
import * as symbolSearch from './av-symbol-search';
import * as savantApiEndpoints from './savant-api-endpoints';
import * as technicalIndicatorsConfig from './av-technical-indicators-config';
import * as technicalIndicatorsTypes from './av-technical-indicators-types';
import * as timeSeries from './av-time-series';

const alphaVantage = {
  ...companyOverview,
  ...constants,
  ...earningsCalendarTypes,
  ...earningsEstimatesTypes,
  ...earningsTypes,
  ...endpointConfigs,
  ...endpoints,
  ...globalQuote,
  ...historicalOptions,
  ...symbolSearch,
  ...savantApiEndpoints,
  ...technicalIndicatorsConfig,
  ...technicalIndicatorsTypes,
  ...timeSeries,
};

export default alphaVantage;
