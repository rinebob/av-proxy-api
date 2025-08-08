// Common frontend Data Maintainer interfaces and constants

import { AlphaVantageEndpoint } from '@shared/alpha-vantage';

/**
 * List of Data Maintainer endpoints for UI selection, with labels and disabled flags.
 * Only endpoints with backend implementations are enabled by default.
 */
export const DATA_MAINTAINER_ENDPOINTS_METADATA = [
  { key: AlphaVantageEndpoint.OVERVIEW, label: 'Company Overview', disabled: false }, 
  { key: AlphaVantageEndpoint.BALANCE_SHEET, label: 'Balance Sheet', disabled: true },
  { key: AlphaVantageEndpoint.INCOME_STATEMENT, label: 'Income Statement', disabled: true },
  { key: AlphaVantageEndpoint.CASH_FLOW, label: 'Cash Flow', disabled: true },
  { key: AlphaVantageEndpoint.EARNINGS, label: 'Earnings', disabled: true },
  { key: AlphaVantageEndpoint.SYMBOL_SEARCH, label: 'Symbol Search', disabled: true },
  { key: AlphaVantageEndpoint.TIME_SERIES_DAILY, label: 'Daily Time Series', disabled: false }, // Implemented
  { key: AlphaVantageEndpoint.GLOBAL_QUOTE, label: 'Global Quote', disabled: false }, // Implemented
];

/**
 * Map type for Data Maintainer API results, keyed by AlphaVantageEndpoint.
 * Each endpoint maps to its specific response type.
 */
export interface DataMaintainerResultsMap {
  [AlphaVantageEndpoint.OVERVIEW]?: any | null;
  [AlphaVantageEndpoint.BALANCE_SHEET]?: any | null;
  [AlphaVantageEndpoint.INCOME_STATEMENT]?: any | null;
  [AlphaVantageEndpoint.CASH_FLOW]?: any | null;
  [AlphaVantageEndpoint.EARNINGS]?: any | null;
  [AlphaVantageEndpoint.SYMBOL_SEARCH]?: any | null;
  [AlphaVantageEndpoint.TIME_SERIES_DAILY]?: any | null;
  [AlphaVantageEndpoint.GLOBAL_QUOTE]?: any | null;
  
  // Index signature for type safety with dynamic access
  [key: string]: any;
}
