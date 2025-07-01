// Common frontend Data Maintainer enums, interfaces, and constants

/**
 * Enum for Data Maintainer endpoints used in the UI and backend integration.
 * Add all new endpoints here for type safety and maintainability.
 */
export enum DataMaintainerEndpoint {
  COMPANY_OVERVIEW = 'company-overview',
  BALANCE_SHEET = 'balance-sheet',
  INCOME_STATEMENT = 'income-statement',
  CASH_FLOW = 'cash-flow',
  EARNINGS = 'earnings',
  LISTING_STATUS = 'listing-status',
  IPO_CALENDAR = 'ipo-calendar',
  SECTOR_PERFORMANCE = 'sector-performance',
  OVERVIEW = 'overview',
  SYMBOL_SEARCH = 'symbol-search',
  TIME_SERIES = 'time-series',
  QUOTE_ENDPOINT = 'quote-endpoint',
}


/**
 * List of Data Maintainer endpoints for UI selection, with labels and disabled flags.
 */
export const DATA_MAINTAINER_ENDPOINTS_METADATA = [
  { key: DataMaintainerEndpoint.COMPANY_OVERVIEW, label: 'Company Overview', disabled: false },
  { key: DataMaintainerEndpoint.BALANCE_SHEET, label: 'Balance Sheet', disabled: true },
  { key: DataMaintainerEndpoint.INCOME_STATEMENT, label: 'Income Statement', disabled: true },
  { key: DataMaintainerEndpoint.CASH_FLOW, label: 'Cash Flow', disabled: true },
  { key: DataMaintainerEndpoint.EARNINGS, label: 'Earnings', disabled: true },
  { key: DataMaintainerEndpoint.LISTING_STATUS, label: 'Listing Status', disabled: true },
  { key: DataMaintainerEndpoint.IPO_CALENDAR, label: 'IPO Calendar', disabled: true },
  { key: DataMaintainerEndpoint.SECTOR_PERFORMANCE, label: 'Sector Performance', disabled: true },
  { key: DataMaintainerEndpoint.OVERVIEW, label: 'Overview', disabled: true },
  { key: DataMaintainerEndpoint.SYMBOL_SEARCH, label: 'Symbol Search', disabled: true },
  { key: DataMaintainerEndpoint.TIME_SERIES, label: 'Time Series', disabled: true },
  { key: DataMaintainerEndpoint.QUOTE_ENDPOINT, label: 'Quote Endpoint', disabled: true },
  // Add more endpoints as needed
];


/**
 * Map type for Data Maintainer API results, keyed by endpoint.
 */
export interface DataMaintainerResultsMap {
  [DataMaintainerEndpoint.COMPANY_OVERVIEW]?: import('./fe-common-dm-api').AvCompanyOverviewResponse | null;
  // Add types for other endpoints as needed
  [key: string]: any;
}

// All future Data Maintainer frontend constants, types, and interfaces should go here.
