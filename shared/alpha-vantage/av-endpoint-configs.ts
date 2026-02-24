import { OutputSize, TimeSeriesInterval} from './av-time-series';
import { AlphaVantageEndpoint, AvEndpointCategory } from './av-endpoints';
import {
  HttpMethod,
  EndpointSymbolUsage,
  EndpointConfig,
} from '../core/types';

import { ApiProvider } from '../core/data-providers';
import { FirestoreCollection } from '../firestore/firestore';



export interface TimeSeriesEndpointConfig<TId extends string = string> extends EndpointConfig<TId> {
    interval: string;
     /** UI display ordering within time series (lower renders first). Optional */
     displayOrder?: number;
}

/**
 * Base configurations for Alpha Vantage API endpoints
 * Using Partial<Record<>> to make all endpoints optional for incremental implementation
 */
export const AV_ENDPOINT_CONFIGS: Partial<Record<AlphaVantageEndpoint, EndpointConfig>> = {
    // Quote Endpoint
  [AlphaVantageEndpoint.GLOBAL_QUOTE]: {
    id: AlphaVantageEndpoint.GLOBAL_QUOTE,
    name: 'Global Quote',
    provider: ApiProvider.ALPHA_VANTAGE,
    category: AvEndpointCategory.QUOTES,
    apiEndpoint: '/query',
    method: HttpMethod.GET,
    description: 'Returns realtime and delayed stock quotes for a single symbol.',
    ttl: 0, // ttl is not used for this endpoint
    symbolUsage: EndpointSymbolUsage.REQUIRED,
    firestorePath: '',  // firestorePath is not used for this endpoint
    documentationUrl: 'https://www.alphavantage.co/documentation/#latestprice',
    parameters: {
      symbol: {
        type: 'string',
        required: true,
        description: 'The name of the equity of your choice. For example: symbol=IBM',
      },
      datatype: {
        type: 'string',
        required: false,
        description: 'The format of the output. Default is json.',
        default: 'json',
      },
    },
  },

  // Bulk Quote Endpoint
  [AlphaVantageEndpoint.REALTIME_BULK_QUOTES]: {
    id: AlphaVantageEndpoint.REALTIME_BULK_QUOTES,
    name: 'Realtime Bulk Quotes',
    provider: ApiProvider.ALPHA_VANTAGE,
    category: AvEndpointCategory.QUOTES,
    apiEndpoint: '/query',
    method: HttpMethod.GET,
    description: 'Returns realtime and delayed stock quotes for multiple symbols in a single API call.',
    ttl: 0, // ttl is not used for this endpoint
    symbolUsage: EndpointSymbolUsage.REQUIRED,
    firestorePath: '',  // firestorePath is not used for this endpoint
    documentationUrl: 'https://www.alphavantage.co/documentation/#latestprice',
    parameters: {
      symbols: {
        type: 'string',
        required: true,
        description: 'A comma-separated list of up to 100 stock symbols to fetch quotes for. Example: symbols=IBM,AAPL,MSFT',
      },
      datatype: {
        type: 'string',
        required: false,
        description: 'The format of the output. Default is json.',
        default: 'json',
      },
    },
  },
  
  // Fundamental Data 
  // Company overview
  [AlphaVantageEndpoint.OVERVIEW]: {
    id: AlphaVantageEndpoint.OVERVIEW,
    name: 'Company Overview',
    provider: ApiProvider.ALPHA_VANTAGE,
    category: AvEndpointCategory.FUNDAMENTAL_DATA,
    apiEndpoint: '/query',
    method: HttpMethod.GET,
    description: 'Returns the company information, financial ratios, and other key metrics for the equity specified.',
    ttl: 7 * 24 * 60 * 60, // 1 week
    symbolUsage: EndpointSymbolUsage.REQUIRED,
    firestorePath: `${FirestoreCollection.SYMBOL_DATA}/{symbol}/${FirestoreCollection.COMPANY_OVERVIEW}/av-${FirestoreCollection.COMPANY_OVERVIEW}`,
    documentationUrl: 'https://www.alphavantage.co/documentation/#company-overview',
    parameters: {
      symbol: {
        type: 'string',
        required: true,
        description: 'The name of the equity of your choice. For example: symbol=IBM',
      },
    },
  },
  
  // earnings history
  [AlphaVantageEndpoint.EARNINGS]: {
    id: AlphaVantageEndpoint.EARNINGS,
    name: 'Earnings',
    provider: ApiProvider.ALPHA_VANTAGE,
    category: AvEndpointCategory.FUNDAMENTAL_DATA,
    apiEndpoint: '/query',
    method: HttpMethod.GET,
    description: 'Returns the annual and quarterly earnings (EPS) for the company of interest.',
    ttl: 30 * 24 * 60 * 60, // 30 days
    symbolUsage: EndpointSymbolUsage.REQUIRED,
    firestorePath: `${FirestoreCollection.SYMBOL_DATA}/{symbol}/${FirestoreCollection.EARNINGS}/av-${FirestoreCollection.EARNINGS}`,
    documentationUrl: 'https://www.alphavantage.co/documentation/#earnings',
    parameters: {
      symbol: {
        type: 'string',
        required: true,
        description: 'The name of the equity of your choice. For example: symbol=IBM',
      },
    },
  },

  // ETF profile & holdings
  [AlphaVantageEndpoint.ETF_PROFILE]: {
    id: AlphaVantageEndpoint.ETF_PROFILE,
    name: 'ETF Profile & Holdings',
    provider: ApiProvider.ALPHA_VANTAGE,
    category: AvEndpointCategory.FUNDAMENTAL_DATA,
    apiEndpoint: '/query',
    method: HttpMethod.GET,
    description: 'Key ETF metrics (net assets, expense ratio, turnover) and full ETF holdings/constituents.',
    ttl: 30 * 24 * 60 * 60, // 30 days
    symbolUsage: EndpointSymbolUsage.REQUIRED,
    firestorePath: `${FirestoreCollection.SYMBOL_DATA}/{symbol}/${FirestoreCollection.ETF_PROFILE_HOLDINGS}/av-${FirestoreCollection.ETF_PROFILE_HOLDINGS}`,
    documentationUrl: 'https://www.alphavantage.co/documentation/',
    parameters: {
      symbol: {
        type: 'string',
        required: true,
        description: 'The symbol of the ETF of your choice. For example: symbol=QQQ',
      },
    },
  },

  // Earnings estimates
  [AlphaVantageEndpoint.EARNINGS_ESTIMATES]: {
    id: AlphaVantageEndpoint.EARNINGS_ESTIMATES,
    name: 'Earnings Estimates',
    provider: ApiProvider.ALPHA_VANTAGE,
    category: AvEndpointCategory.FUNDAMENTAL_DATA,
    apiEndpoint: '/query',
    method: HttpMethod.GET,
    description: 'Annual and quarterly EPS and revenue estimates, with analyst count and revision history.',
    ttl: 7 * 24 * 60 * 60, // 7 days
    symbolUsage: EndpointSymbolUsage.REQUIRED,
    firestorePath: `${FirestoreCollection.SYMBOL_DATA}/{symbol}/${FirestoreCollection.EARNINGS_ESTIMATES}/av-${FirestoreCollection.EARNINGS_ESTIMATES}`,
    documentationUrl: 'https://www.alphavantage.co/documentation/',
    parameters: {
      symbol: {
        type: 'string',
        required: true,
        description: 'The name of the equity of your choice. For example: symbol=IBM',
      },
    },
  },
  
  [AlphaVantageEndpoint.INCOME_STATEMENT]: {
    id: AlphaVantageEndpoint.INCOME_STATEMENT,
    name: 'Income Statement',
    provider: ApiProvider.ALPHA_VANTAGE,
    category: AvEndpointCategory.FUNDAMENTAL_DATA,
    apiEndpoint: '/query',
    method: HttpMethod.GET,
    description: 'Returns the annual and quarterly income statements for the company of interest.',
    ttl: 7 * 24 * 60 * 60, // 1 week
    symbolUsage: EndpointSymbolUsage.REQUIRED,
    firestorePath: `${FirestoreCollection.SYMBOL_DATA}/{symbol}/${FirestoreCollection.INCOME_STATEMENT}/av-${FirestoreCollection.INCOME_STATEMENT}`,
    documentationUrl: 'https://www.alphavantage.co/documentation/#income-statement',
    parameters: {
      symbol: {
        type: 'string',
        required: true,
        description: 'The name of the equity of your choice. For example: symbol=IBM',
      },
    },
  },
  
  [AlphaVantageEndpoint.BALANCE_SHEET]: {
    id: AlphaVantageEndpoint.BALANCE_SHEET,
    name: 'Balance Sheet',
    provider: ApiProvider.ALPHA_VANTAGE,
    category: AvEndpointCategory.FUNDAMENTAL_DATA,
    apiEndpoint: '/query',
    method: HttpMethod.GET,
    description: 'Returns the annual and quarterly balance sheets for the company of interest.',
    ttl: 7 * 24 * 60 * 60, // 1 week
    symbolUsage: EndpointSymbolUsage.REQUIRED,
    firestorePath: `${FirestoreCollection.SYMBOL_DATA}/{symbol}/${FirestoreCollection.BALANCE_SHEET}/av-${FirestoreCollection.BALANCE_SHEET}`,
    documentationUrl: 'https://www.alphavantage.co/documentation/#balance-sheet',
    parameters: {
      symbol: {
        type: 'string',
        required: true,
        description: 'The name of the equity of your choice. For example: symbol=IBM',
      },
    },
  },
  
  [AlphaVantageEndpoint.CASH_FLOW]: {
    id: AlphaVantageEndpoint.CASH_FLOW,
    name: 'Cash Flow',
    provider: ApiProvider.ALPHA_VANTAGE,
    category: AvEndpointCategory.FUNDAMENTAL_DATA,
    apiEndpoint: '/query',
    method: HttpMethod.GET,
    description: 'Returns the annual and quarterly cash flow for the company of interest.',
    ttl: 7 * 24 * 60 * 60, // 1 week
    symbolUsage: EndpointSymbolUsage.REQUIRED,
    firestorePath: `${FirestoreCollection.SYMBOL_DATA}/{symbol}/${FirestoreCollection.CASH_FLOW}/av-${FirestoreCollection.CASH_FLOW}`,
    documentationUrl: 'https://www.alphavantage.co/documentation/#cash-flow',
    parameters: {
      symbol: {
        type: 'string',
        required: true,
        description: 'The name of the equity of your choice. For example: symbol=IBM',
      },
    },
  },
  
  [AlphaVantageEndpoint.LISTING_DELISTING_STATUS]: {
    id: AlphaVantageEndpoint.LISTING_DELISTING_STATUS,
    name: 'Listing Status',
    provider: ApiProvider.ALPHA_VANTAGE,
    category: AvEndpointCategory.FUNDAMENTAL_DATA,
    apiEndpoint: '/query',
    method: HttpMethod.GET,
    description: 'Returns a list of active or delisted US stocks and ETFs, either as of the latest trading day or at a specific time in history.',
    ttl: 7 * 24 * 60 * 60, // 1 week
    symbolUsage: EndpointSymbolUsage.REQUIRED,
    firestorePath: `${FirestoreCollection.SYMBOL_DATA}/{symbol}/${FirestoreCollection.LISTING_DELISTING_STATUS}/av-${FirestoreCollection.LISTING_DELISTING_STATUS}`,
    documentationUrl: 'https://www.alphavantage.co/documentation/#listing-status',
    parameters: {
      symbol: {
        type: 'string',
        required: true,
        description: 'The name of the equity of your choice. For example: symbol=IBM',
      },
    },
  },
  
  [AlphaVantageEndpoint.EARNINGS_CALENDAR]: {
    id: AlphaVantageEndpoint.EARNINGS_CALENDAR,
    name: 'Earnings Calendar',
    provider: ApiProvider.ALPHA_VANTAGE,
    category: AvEndpointCategory.FUNDAMENTAL_DATA,
    apiEndpoint: '/query',
    method: HttpMethod.GET,
    description: 'Returns the earnings calendar for stocks that report earnings within the next 3 months.',
    ttl: 24 * 60 * 60, // 1 day
    symbolUsage: EndpointSymbolUsage.OPTIONAL,
    firestorePath: `${FirestoreCollection.SYMBOL_DATA}/{symbol}/${FirestoreCollection.EARNINGS_CALENDAR}/av-${FirestoreCollection.EARNINGS_CALENDAR}`,
    documentationUrl: 'https://www.alphavantage.co/documentation/#earnings-calendar',
    parameters: {
      symbol: {
        type: 'string',
        required: true,
        description: 'The name of the equity of your choice. For example: symbol=IBM',
      },
    },
  },
  
  [AlphaVantageEndpoint.IPO_CALENDAR]: {
    id: AlphaVantageEndpoint.IPO_CALENDAR,
    name: 'IPO Calendar',
    provider: ApiProvider.ALPHA_VANTAGE,
    category: AvEndpointCategory.FUNDAMENTAL_DATA,
    apiEndpoint: '/query',
    method: HttpMethod.GET,
    description: 'Returns a list of IPOs expected in the next 3-4 months.',
    ttl: 24 * 60 * 60, // 1 day
    symbolUsage: EndpointSymbolUsage.NOT_SUPPORTED,
    firestorePath: `${FirestoreCollection.MARKET_DATA}/av-${FirestoreCollection.IPO_CALENDAR}`,
    documentationUrl: 'https://www.alphavantage.co/documentation/#ipo-calendar',
    parameters: {
      symbol: {
        type: 'string',
        required: true,
        description: 'The name of the equity of your choice. For example: symbol=IBM',
      },
    },
  },
  
//   // Search symbols
  [AlphaVantageEndpoint.SYMBOL_SEARCH]: {
    id: AlphaVantageEndpoint.SYMBOL_SEARCH,
    name: 'Symbol Search',
    provider: ApiProvider.ALPHA_VANTAGE,
    category: AvEndpointCategory.SEARCH,
    apiEndpoint: '/query',
    method: HttpMethod.GET,
    description: 'Search for symbols and companies based on keywords',
    ttl: 30 * 24 * 60 * 60, // 30 days in seconds
    symbolUsage: EndpointSymbolUsage.NOT_SUPPORTED,
    firestorePath: `${FirestoreCollection.TRACKED_SYMBOLS}`,
    documentationUrl: 'https://www.alphavantage.co/documentation/#symbolsearch',
    parameters: {
      keywords: {
        type: 'string',
        required: true,
        description: 'A text string of your choice. For example: keywords=microsoft.',
      },
    },
  },
  
  // Economic Indicators (don't require a symbol)
  [AlphaVantageEndpoint.REAL_GDP]: {
    id: AlphaVantageEndpoint.REAL_GDP,
    name: 'Real GDP',
    provider: ApiProvider.ALPHA_VANTAGE,
    category: AvEndpointCategory.ECONOMIC_INDICATORS,
    apiEndpoint: '/query',
    method: HttpMethod.GET,
    description: 'Returns the annual and quarterly Real GDP of the United States.',
    ttl: 24 * 60 * 60, // 1 day
    symbolUsage: EndpointSymbolUsage.NOT_SUPPORTED,
    firestorePath: `${FirestoreCollection.ECONOMIC_INDICATORS}/${FirestoreCollection.REAL_GDP}/av-${FirestoreCollection.REAL_GDP}`,
    documentationUrl: 'https://www.alphavantage.co/documentation/#gdp',
    parameters: {},
  },
  
  [AlphaVantageEndpoint.TREASURY_YIELD]: {
    id: AlphaVantageEndpoint.TREASURY_YIELD,
    name: 'Treasury Yield',
    provider: ApiProvider.ALPHA_VANTAGE,
    category: AvEndpointCategory.ECONOMIC_INDICATORS,
    apiEndpoint: '/query',
    method: HttpMethod.GET,
    description: 'Returns the daily, weekly, and monthly US treasury yield of a given maturity timeline (e.g., 5 year, 10 year, 30 year, etc.)',
    ttl: 24 * 60 * 60, // 1 day
    symbolUsage: EndpointSymbolUsage.NOT_SUPPORTED,
    firestorePath: `${FirestoreCollection.ECONOMIC_INDICATORS}/${FirestoreCollection.TREASURY_YIELD}/av-${FirestoreCollection.TREASURY_YIELD}`,
    documentationUrl: 'https://www.alphavantage.co/documentation/#treasury-yield',
    parameters: {},
  },
  
  [AlphaVantageEndpoint.FEDERAL_FUNDS_RATE]: {
    id: AlphaVantageEndpoint.FEDERAL_FUNDS_RATE,
    name: 'Federal Funds Rate',
    provider: ApiProvider.ALPHA_VANTAGE,
    category: AvEndpointCategory.ECONOMIC_INDICATORS,
    apiEndpoint: '/query',
    method: HttpMethod.GET,
    description: 'Returns the daily, weekly, and monthly federal funds rate (interest rate) of the United States.',
    ttl: 24 * 60 * 60, // 1 day
    symbolUsage: EndpointSymbolUsage.NOT_SUPPORTED,
    firestorePath: `${FirestoreCollection.ECONOMIC_INDICATORS}/${FirestoreCollection.FEDERAL_FUNDS_RATE}/av-${FirestoreCollection.FEDERAL_FUNDS_RATE}`,
    documentationUrl: 'https://www.alphavantage.co/documentation/#federal-funds-rate',
    parameters: {},
  },
  
  [AlphaVantageEndpoint.CPI]: {
    id: AlphaVantageEndpoint.CPI,
    name: 'Consumer Price Index (CPI)',
    provider: ApiProvider.ALPHA_VANTAGE,
    category: AvEndpointCategory.ECONOMIC_INDICATORS,
    apiEndpoint: '/query',
    method: HttpMethod.GET,
    description: 'Returns the monthly and semiannual consumer price index (CPI) of the United States.',
    ttl: 24 * 60 * 60, // 1 day
    symbolUsage: EndpointSymbolUsage.NOT_SUPPORTED,
    firestorePath: `${FirestoreCollection.ECONOMIC_INDICATORS}/${FirestoreCollection.CPI}/av-${FirestoreCollection.CPI}`,
    documentationUrl: 'https://www.alphavantage.co/documentation/#cpi',
    parameters: {},
  },
  
  [AlphaVantageEndpoint.INFLATION]: {
    id: AlphaVantageEndpoint.INFLATION,
    name: 'Inflation',
    provider: ApiProvider.ALPHA_VANTAGE,
    category: AvEndpointCategory.ECONOMIC_INDICATORS,
    apiEndpoint: '/query',
    method: HttpMethod.GET,
    description: 'Returns the annual inflation rates (consumer prices) of the United States.',
    ttl: 24 * 60 * 60, // 1 day
    symbolUsage: EndpointSymbolUsage.NOT_SUPPORTED,
    firestorePath: `${FirestoreCollection.ECONOMIC_INDICATORS}/${FirestoreCollection.INFLATION}/av-${FirestoreCollection.INFLATION}`,
    documentationUrl: 'https://www.alphavantage.co/documentation/#inflation',
    parameters: {},
  },
  
  [AlphaVantageEndpoint.RETAIL_SALES]: {
    id: AlphaVantageEndpoint.RETAIL_SALES,
    name: 'Retail Sales',
    provider: ApiProvider.ALPHA_VANTAGE,
    category: AvEndpointCategory.ECONOMIC_INDICATORS,
    apiEndpoint: '/query',
    method: HttpMethod.GET,
    description: 'Returns the monthly advance and monthly retail trade report for the United States.',
    ttl: 24 * 60 * 60, // 1 day
    symbolUsage: EndpointSymbolUsage.NOT_SUPPORTED,
    firestorePath: `${FirestoreCollection.ECONOMIC_INDICATORS}/${FirestoreCollection.RETAIL_SALES}/av-${FirestoreCollection.RETAIL_SALES}`,
    documentationUrl: 'https://www.alphavantage.co/documentation/#retail-sales',
    parameters: {},
  },
  
  [AlphaVantageEndpoint.DURABLE_GOODS_ORDERS]: {
    id: AlphaVantageEndpoint.DURABLE_GOODS_ORDERS,
    name: 'Durable Goods',
    provider: ApiProvider.ALPHA_VANTAGE,
    category: AvEndpointCategory.ECONOMIC_INDICATORS,
    apiEndpoint: '/query',
    method: HttpMethod.GET,
    description: 'Returns the monthly advance report on durable goods orders in the United States.',
    ttl: 24 * 60 * 60, // 1 day
    symbolUsage: EndpointSymbolUsage.NOT_SUPPORTED,
    firestorePath: `${FirestoreCollection.ECONOMIC_INDICATORS}/${FirestoreCollection.DURABLE_GOODS_ORDERS}/av-${FirestoreCollection.DURABLE_GOODS_ORDERS}`,
    documentationUrl: 'https://www.alphavantage.co/documentation/#durable-goods',
    parameters: {},
  },
  
  [AlphaVantageEndpoint.UNEMPLOYMENT_RATE]: {
    id: AlphaVantageEndpoint.UNEMPLOYMENT_RATE,
    name: 'Unemployment Rate',
    provider: ApiProvider.ALPHA_VANTAGE,
    category: AvEndpointCategory.ECONOMIC_INDICATORS,
    apiEndpoint: '/query',
    method: HttpMethod.GET,
    description: 'Returns the monthly unemployment data of the United States.',
    ttl: 24 * 60 * 60, // 1 day
    symbolUsage: EndpointSymbolUsage.NOT_SUPPORTED,
    firestorePath: `${FirestoreCollection.ECONOMIC_INDICATORS}/${FirestoreCollection.UNEMPLOYMENT_RATE}/av-${FirestoreCollection.UNEMPLOYMENT_RATE}`,
    documentationUrl: 'https://www.alphavantage.co/documentation/#unemployment',
    parameters: {},
  },
  
  [AlphaVantageEndpoint.NONFARM_PAYROLL]: {
    id: AlphaVantageEndpoint.NONFARM_PAYROLL,
    name: 'Nonfarm Payroll',
    provider: ApiProvider.ALPHA_VANTAGE,
    category: AvEndpointCategory.ECONOMIC_INDICATORS,
    apiEndpoint: '/query',
    method: HttpMethod.GET,
    description: 'Returns the monthly US All Employees: Total Nonfarm Payrolls (NFP) report.',
    ttl: 24 * 60 * 60, // 1 day
    symbolUsage: EndpointSymbolUsage.NOT_SUPPORTED,
    firestorePath: `${FirestoreCollection.ECONOMIC_INDICATORS}/${FirestoreCollection.NONFARM_PAYROLL}/av-${FirestoreCollection.NONFARM_PAYROLL}`,
    documentationUrl: 'https://www.alphavantage.co/documentation/#nonfarm-payroll',
    parameters: {},
  },
  
  // Options Data
  [AlphaVantageEndpoint.HISTORICAL_OPTIONS]: {
    id: AlphaVantageEndpoint.HISTORICAL_OPTIONS,
    name: 'Historical Options',
    provider: ApiProvider.ALPHA_VANTAGE,
    category: AvEndpointCategory.OPTIONS_DATA,
    apiEndpoint: '/query',
    method: HttpMethod.GET,
    description: 'Returns the full historical options chain for a specific symbol on a specific date, including Greeks and IV',
    ttl: 24 * 60 * 60, // 1 day
    symbolUsage: EndpointSymbolUsage.REQUIRED,
    firestorePath: `${FirestoreCollection.SYMBOL_DATA}/{symbol}/${FirestoreCollection.OPTIONS}/av-${FirestoreCollection.HISTORICAL_OPTIONS}-{dateSuffix}`,
    documentationUrl: 'https://www.alphavantage.co/documentation/#historical-options',
    parameters: {
      symbol: {
        type: 'string',
        required: true,
        description: 'The name of the equity of your choice. For example: symbol=IBM',
      },
      date: {
        type: 'string',
        required: false,
        description: 'Date in YYYY-MM-DD format. If not provided, returns data for the previous trading session',
        format: 'date',
      },
      datatype: {
        type: 'string',
        required: false,
        description: 'The format of the output. Default is json.',
        default: 'json',
        enum: ['json', 'csv']
      },
    },
  },
};

export const AV_TIME_SERIES_ENDPOINT_CONFIGS: Partial<Record<AlphaVantageEndpoint, TimeSeriesEndpointConfig>> = {
  [AlphaVantageEndpoint.TIME_SERIES_DAILY]: {
    id: AlphaVantageEndpoint.TIME_SERIES_DAILY,
    name: 'Daily Time Series',
    provider: ApiProvider.ALPHA_VANTAGE,
    category: AvEndpointCategory.TIME_SERIES,
    apiEndpoint: '/query',
    method: HttpMethod.GET,
    description: 'Daily open, high, low, close, and volume for a symbol.',
    ttl: 60 * 5, // 5 minutes
    symbolUsage: EndpointSymbolUsage.REQUIRED,
    firestorePath: `${FirestoreCollection.SYMBOL_DATA}/{symbol}/${FirestoreCollection.DAILY}/av-${FirestoreCollection.DAILY}`,
    documentationUrl: 'https://www.alphavantage.co/documentation/#daily',
    parameters: {
      symbol: { type: 'string', required: true, description: 'Symbol' },
      outputsize: {
        type: 'string',
        required: false,
        description: 'By default, outputsize=compact. Strings compact and full are accepted.',
        default: OutputSize.COMPACT
      }
    },
    interval: TimeSeriesInterval.DAILY,
    displayOrder: 1
  },
  [AlphaVantageEndpoint.TIME_SERIES_WEEKLY]: {
    id: AlphaVantageEndpoint.TIME_SERIES_WEEKLY,
    name: 'Weekly Time Series',
    provider: ApiProvider.ALPHA_VANTAGE,
    category: AvEndpointCategory.TIME_SERIES,
    apiEndpoint: '/query',
    method: HttpMethod.GET,
    description: 'Weekly open, high, low, close, and volume for a symbol.',
    ttl: 60 * 60, // 1 hour
    symbolUsage: EndpointSymbolUsage.REQUIRED,
    firestorePath: `${FirestoreCollection.SYMBOL_DATA}/{symbol}/${FirestoreCollection.WEEKLY}/av-${FirestoreCollection.WEEKLY}`,
    documentationUrl: 'https://www.alphavantage.co/documentation/#weekly',
    parameters: {
      symbol: { type: 'string', required: true, description: 'Symbol' },
      outputsize: {
        type: 'string',
        required: false,
        description: 'By default, outputsize=compact. Strings compact and full are accepted.',
        default: OutputSize.COMPACT
      }
    },
    interval: TimeSeriesInterval.WEEKLY,
    displayOrder: 2
  },
  [AlphaVantageEndpoint.TIME_SERIES_MONTHLY]: {
    id: AlphaVantageEndpoint.TIME_SERIES_MONTHLY,
    name: 'Monthly Time Series',
    provider: ApiProvider.ALPHA_VANTAGE,
    category: AvEndpointCategory.TIME_SERIES,
    apiEndpoint: '/query',
    method: HttpMethod.GET,
    description: 'Monthly open, high, low, close, and volume for a symbol.',
    ttl: 60 * 60, // 1 hour
    symbolUsage: EndpointSymbolUsage.REQUIRED,
    firestorePath: `${FirestoreCollection.SYMBOL_DATA}/{symbol}/${FirestoreCollection.MONTHLY}/av-${FirestoreCollection.MONTHLY}`,
    documentationUrl: 'https://www.alphavantage.co/documentation/#monthly',
    parameters: {
      symbol: { type: 'string', required: true, description: 'Symbol' },
      outputsize: {
        type: 'string',
        required: false,
        description: 'By default, outputsize=compact. Strings compact and full are accepted.',
        default: OutputSize.COMPACT
      }
    },
    interval: TimeSeriesInterval.MONTHLY,
    displayOrder: 3
  },
  [AlphaVantageEndpoint.TIME_SERIES_DAILY_ADJUSTED]: {
    id: AlphaVantageEndpoint.TIME_SERIES_DAILY_ADJUSTED,
    name: 'Daily Adjusted Time Series',
    provider: ApiProvider.ALPHA_VANTAGE,
    category: AvEndpointCategory.TIME_SERIES,
    apiEndpoint: '/query',
    method: HttpMethod.GET,
    description: 'Daily adjusted open, high, low, close, and volume for a symbol.',
    ttl: 60 * 60, // 1 hour
    symbolUsage: EndpointSymbolUsage.REQUIRED,
    firestorePath: `${FirestoreCollection.SYMBOL_DATA}/{symbol}/${FirestoreCollection.DAILY_ADJUSTED}/av-${FirestoreCollection.DAILY_ADJUSTED}`,
    documentationUrl: 'https://www.alphavantage.co/documentation/#dailyadj',
    parameters: {
      symbol: { type: 'string', required: true, description: 'Symbol' },
      outputsize: {
        type: 'string',
        required: false,
        description: 'By default, outputsize=compact. Strings compact and full are accepted.',
        default: OutputSize.COMPACT
      }
    },
    interval: TimeSeriesInterval.DAILY,
    displayOrder: 1
  },
  [AlphaVantageEndpoint.TIME_SERIES_WEEKLY_ADJUSTED]: {
    id: AlphaVantageEndpoint.TIME_SERIES_WEEKLY_ADJUSTED,
    name: 'Weekly Adjusted Time Series',
    provider: ApiProvider.ALPHA_VANTAGE,
    category: AvEndpointCategory.TIME_SERIES,
    apiEndpoint: '/query',
    method: HttpMethod.GET,
    description: 'Weekly adjusted open, high, low, close, and volume for a symbol.',
    ttl: 60 * 60, // 1 hour
    symbolUsage: EndpointSymbolUsage.REQUIRED,
    firestorePath: `${FirestoreCollection.SYMBOL_DATA}/{symbol}/${FirestoreCollection.WEEKLY_ADJUSTED}/av-${FirestoreCollection.WEEKLY_ADJUSTED}`,
    documentationUrl: 'https://www.alphavantage.co/documentation/#weeklyadj',
    parameters: {
      symbol: { type: 'string', required: true, description: 'Symbol' },
      outputsize: {
        type: 'string',
        required: false,
        description: 'By default, outputsize=compact. Strings compact and full are accepted.',
        default: OutputSize.COMPACT
      }
    },
    interval: TimeSeriesInterval.WEEKLY,
    displayOrder: 2 
  },
  [AlphaVantageEndpoint.TIME_SERIES_MONTHLY_ADJUSTED]: {
    id: AlphaVantageEndpoint.TIME_SERIES_MONTHLY_ADJUSTED,
    name: 'Monthly Adjusted Time Series',
    provider: ApiProvider.ALPHA_VANTAGE,
    category: AvEndpointCategory.TIME_SERIES,
    apiEndpoint: '/query',
    method: HttpMethod.GET,
    description: 'Monthly adjusted open, high, low, close, and volume for a symbol.',
    ttl: 60 * 60, // 1 hour
    symbolUsage: EndpointSymbolUsage.REQUIRED,
    firestorePath: `${FirestoreCollection.SYMBOL_DATA}/{symbol}/${FirestoreCollection.MONTHLY_ADJUSTED}/av-${FirestoreCollection.MONTHLY_ADJUSTED}`,
    documentationUrl: 'https://www.alphavantage.co/documentation/#monthlyadj',
    parameters: {
      symbol: { type: 'string', required: true, description: 'Symbol' },
      outputsize: {
        type: 'string',
        required: false,
        description: 'By default, outputsize=compact. Strings compact and full are accepted.',
        default: OutputSize.COMPACT
      }
    },
    interval: TimeSeriesInterval.MONTHLY,
    displayOrder: 3
  },
  [AlphaVantageEndpoint.TIME_SERIES_INTRADAY]: {
    id: AlphaVantageEndpoint.TIME_SERIES_INTRADAY,
    name: 'Intraday Time Series',
    provider: ApiProvider.ALPHA_VANTAGE,
    category: AvEndpointCategory.TIME_SERIES,
    apiEndpoint: '/query',
    method: HttpMethod.GET,
    description: 'Intraday open, high, low, close, and volume for a symbol.',
    ttl: 60, // 60s cache window
    symbolUsage: EndpointSymbolUsage.REQUIRED,
    documentationUrl: 'https://www.alphavantage.co/documentation/#intraday',
    parameters: {
      symbol: { type: 'string', required: true, description: 'Symbol' },
      interval: { type: 'string', required: true, description: 'Interval', enum: ['1min'] },
      outputsize: { type: 'string', required: false, description: 'Response size (compact or full)', enum: ['compact', 'full'], default: OutputSize.COMPACT },
      datatype: { type: 'string', required: false, description: 'Data type for the response', enum: ['json', 'csv'], default: 'json' },
    },
    interval: TimeSeriesInterval.INTRADAY,
    displayOrder: 0,
  },
};

export function isTimeSeriesConfig(config: EndpointConfig): config is TimeSeriesEndpointConfig {
  return (config as TimeSeriesEndpointConfig).interval !== undefined;
}

/** Build a Map of endpointId -> displayOrder for time series endpoints. */
export function getTimeSeriesPriorityIndex(): Map<AlphaVantageEndpoint, number> {
    const index = new Map<AlphaVantageEndpoint, number>();
    for (const [key, cfg] of Object.entries(AV_TIME_SERIES_ENDPOINT_CONFIGS)) {
      const id = key as AlphaVantageEndpoint;
      const c = cfg as TimeSeriesEndpointConfig | undefined;
      if (!c || c.displayOrder == null) continue;
      index.set(id, c.displayOrder);
    }
    return index;
  }

/**
 * Resolve the configured TTL (in seconds) for a given Alpha Vantage endpoint id.
 * Checks time-series configs first, then general endpoint configs. Falls back to 0 when unknown.
 */
export function getEndpointTtlSecondsById(endpointId: string): number {
  const tsCfg: any = (AV_TIME_SERIES_ENDPOINT_CONFIGS as any)[endpointId as any];
  if (tsCfg?.ttl != null) return Number(tsCfg.ttl) || 0;
  const cfg: any = (AV_ENDPOINT_CONFIGS as any)[endpointId as any];
  if (cfg?.ttl != null) return Number(cfg.ttl) || 0;
  return 0;
}