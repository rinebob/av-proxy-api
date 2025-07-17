import { 
  HttpMethod 
} from '../../common/enums';
import { AlphaVantageEndpoint, OutputSize } from '../../common/common-av';
import { EndpointSymbolUsage } from '../../common/common-fn';
import { EndpointConfig } from '../../common/types';
import { FirestoreCollection } from '../../common/firestore-collections';
import { AvEndpointCategory } from '../../common/common-av';
import { ApiProvider } from '../../common/data-providers';

/**
 * Base configurations for Alpha Vantage API endpoints
 * Using Partial<Record<>> to make all endpoints optional for incremental implementation
 */
export const AV_ENDPOINT_CONFIGS: Partial<Record<AlphaVantageEndpoint, EndpointConfig>> = {
  // Time Series Data
  [AlphaVantageEndpoint.TIME_SERIES_DAILY]: {
    id: AlphaVantageEndpoint.TIME_SERIES_DAILY,
    name: 'Daily Time Series',
    provider: ApiProvider.ALPHA_VANTAGE,
    category: AvEndpointCategory.TIME_SERIES,
    apiEndpoint: '/query',
    method: HttpMethod.GET,
    description: 'Returns daily time series (date, daily open, daily high, daily low, daily close, daily volume) of the global equity specified.',
    ttl: 24 * 60 * 60, // 24 hours
    requiresSymbol: true,
    symbolUsage: EndpointSymbolUsage.REQUIRED,
    firestorePath: `${FirestoreCollection.TIME_SERIES}/{symbol}/${FirestoreCollection.DAILY}/av-${FirestoreCollection.DAILY}`,
    documentationUrl: 'https://www.alphavantage.co/documentation/#daily',
    parameters: {
      symbol: {
        type: 'string',
        required: true,
        description: 'The name of the equity of your choice. For example: symbol=IBM',
      },
      outputsize: {
        type: 'string',
        required: false,
        description: 'By default, outputsize=compact. Strings compact and full are accepted with the following specifications: compact returns only the latest 100 data points in the daily time series; full returns the full-length daily time series.',
        default: OutputSize.COMPACT,
      },
    },
  },
  
  [AlphaVantageEndpoint.TIME_SERIES_INTRADAY]: {
    id: AlphaVantageEndpoint.TIME_SERIES_INTRADAY,
    name: 'Intraday Time Series',
    provider: ApiProvider.ALPHA_VANTAGE,
    category: AvEndpointCategory.TIME_SERIES,
    apiEndpoint: '/query',
    method: HttpMethod.GET,
    description: 'Returns intraday time series (timestamp, open, high, low, close, volume) of the equity specified.',
    ttl: 5 * 60, // 5 minutes
    requiresSymbol: true,
    symbolUsage: EndpointSymbolUsage.REQUIRED,
    firestorePath: `${FirestoreCollection.TIME_SERIES}/{symbol}/${FirestoreCollection.INTRADAY}/av-${FirestoreCollection.INTRADAY}`,
    documentationUrl: 'https://www.alphavantage.co/documentation/#intraday',
    parameters: {
      symbol: {
        type: 'string',
        required: true,
        description: 'The name of the equity of your choice. For example: symbol=IBM',
      },
      interval: {
        type: 'string',
        required: true,
        description: 'Time interval between two consecutive data points in the time series.',
        enum: ['1min', '5min', '15min', '30min', '60min'],
      },
      outputsize: {
        type: 'string',
        required: false,
        description: 'By default, outputsize=compact. Strings compact and full are accepted.',
        default: OutputSize.COMPACT,
      },
    },
  },
  
  [AlphaVantageEndpoint.TIME_SERIES_DAILY_ADJUSTED]: {
    id: AlphaVantageEndpoint.TIME_SERIES_DAILY_ADJUSTED,
    name: 'Daily Adjusted Time Series',
    provider: ApiProvider.ALPHA_VANTAGE,
    category: AvEndpointCategory.TIME_SERIES,
    apiEndpoint: '/query',
    method: HttpMethod.GET,
    description: 'Returns daily time series (date, daily open, daily high, daily low, daily close, daily volume, daily adjusted close, and split/dividend events) of the global equity specified.',
    ttl: 24 * 60 * 60, // 24 hours
    requiresSymbol: true,
    symbolUsage: EndpointSymbolUsage.REQUIRED,
    firestorePath: `${FirestoreCollection.TIME_SERIES}/{symbol}/${FirestoreCollection.DAILY_ADJUSTED}/av-${FirestoreCollection.DAILY_ADJUSTED}`,
    documentationUrl: 'https://www.alphavantage.co/documentation/#dailyadj',
    parameters: {
      symbol: {
        type: 'string',
        required: true,
        description: 'The name of the equity of your choice. For example: symbol=IBM',
      },
      outputsize: {
        type: 'string',
        required: false,
        description: 'By default, outputsize=compact. Strings compact and full are accepted.',
        default: OutputSize.COMPACT,
      },
    },
  },
  
  [AlphaVantageEndpoint.TIME_SERIES_WEEKLY]: {
    id: AlphaVantageEndpoint.TIME_SERIES_WEEKLY,
    name: 'Weekly Time Series',
    provider: ApiProvider.ALPHA_VANTAGE,
    category: AvEndpointCategory.TIME_SERIES,
    apiEndpoint: '/query',
    method: HttpMethod.GET,
    description: 'Returns weekly time series (last trading day of each week, weekly open, weekly high, weekly low, weekly close, weekly volume) of the global equity specified.',
    ttl: 7 * 24 * 60 * 60, // 1 week
    requiresSymbol: true,
    symbolUsage: EndpointSymbolUsage.REQUIRED,
    firestorePath: `${FirestoreCollection.TIME_SERIES}/{symbol}/${FirestoreCollection.WEEKLY}/av-${FirestoreCollection.WEEKLY}`,
    documentationUrl: 'https://www.alphavantage.co/documentation/#weekly',
    parameters: {
      symbol: {
        type: 'string',
        required: true,
        description: 'The name of the equity of your choice. For example: symbol=IBM',
      },
    },
  },
  
  [AlphaVantageEndpoint.TIME_SERIES_WEEKLY_ADJUSTED]: {
    id: AlphaVantageEndpoint.TIME_SERIES_WEEKLY_ADJUSTED,
    name: 'Weekly Adjusted Time Series',
    provider: ApiProvider.ALPHA_VANTAGE,
    category: AvEndpointCategory.TIME_SERIES,
    apiEndpoint: '/query',
    method: HttpMethod.GET,
    description: 'Returns weekly adjusted time series (last trading day of each week, weekly open, weekly high, weekly low, weekly close, weekly adjusted close, weekly volume, weekly dividend) of the equity specified.',
    ttl: 7 * 24 * 60 * 60, // 1 week
    requiresSymbol: true,
    symbolUsage: EndpointSymbolUsage.REQUIRED,
    firestorePath: `${FirestoreCollection.TIME_SERIES}/{symbol}/${FirestoreCollection.WEEKLY_ADJUSTED}/av-${FirestoreCollection.WEEKLY_ADJUSTED}`,
    documentationUrl: 'https://www.alphavantage.co/documentation/#weeklyadj',
    parameters: {
      symbol: {
        type: 'string',
        required: true,
        description: 'The name of the equity of your choice. For example: symbol=IBM',
      },
    },
  },
  
  [AlphaVantageEndpoint.TIME_SERIES_MONTHLY]: {
    id: AlphaVantageEndpoint.TIME_SERIES_MONTHLY,
    name: 'Monthly Time Series',
    provider: ApiProvider.ALPHA_VANTAGE,
    category: AvEndpointCategory.TIME_SERIES,
    apiEndpoint: '/query',
    method: HttpMethod.GET,
    description: 'Returns monthly time series (last trading day of each month, monthly open, monthly high, monthly low, monthly close, monthly volume) of the global equity specified.',
    ttl: 30 * 24 * 60 * 60, // 30 days
    requiresSymbol: true,
    symbolUsage: EndpointSymbolUsage.REQUIRED,
    firestorePath: `${FirestoreCollection.TIME_SERIES}/{symbol}/${FirestoreCollection.MONTHLY}/av-${FirestoreCollection.MONTHLY}`,
    documentationUrl: 'https://www.alphavantage.co/documentation/#monthly',
    parameters: {
      symbol: {
        type: 'string',
        required: true,
        description: 'The name of the equity of your choice. For example: symbol=IBM',
      },
    },
  },
  
  [AlphaVantageEndpoint.TIME_SERIES_MONTHLY_ADJUSTED]: {
    id: AlphaVantageEndpoint.TIME_SERIES_MONTHLY_ADJUSTED,
    name: 'Monthly Adjusted Time Series',
    provider: ApiProvider.ALPHA_VANTAGE,
    category: AvEndpointCategory.TIME_SERIES,
    apiEndpoint: '/query',
    method: HttpMethod.GET,
    description: 'Returns monthly adjusted time series (last trading day of each month, monthly open, monthly high, monthly low, monthly close, monthly adjusted close, monthly volume, monthly dividend) of the equity specified.',
    ttl: 30 * 24 * 60 * 60, // 30 days
    requiresSymbol: true,
    symbolUsage: EndpointSymbolUsage.REQUIRED,
    firestorePath: `${FirestoreCollection.TIME_SERIES}/{symbol}/${FirestoreCollection.MONTHLY_ADJUSTED}/av-${FirestoreCollection.MONTHLY_ADJUSTED}`,
    documentationUrl: 'https://www.alphavantage.co/documentation/#monthlyadj',
    parameters: {
      symbol: {
        type: 'string',
        required: true,
        description: 'The name of the equity of your choice. For example: symbol=IBM',
      },
    },
  },
  
  // Quote Endpoint
  [AlphaVantageEndpoint.GLOBAL_QUOTE]: {
    id: AlphaVantageEndpoint.GLOBAL_QUOTE,
    name: 'Global Quote',
    provider: ApiProvider.ALPHA_VANTAGE,
    category: AvEndpointCategory.TIME_SERIES,
    apiEndpoint: '/query',
    method: HttpMethod.GET,
    description: 'Returns the latest price and volume information for a security of your choice.',
    ttl: 5 * 60, // 5 minutes
    requiresSymbol: true,
    symbolUsage: EndpointSymbolUsage.REQUIRED,
    firestorePath: `${FirestoreCollection.TIME_SERIES}/{symbol}/${FirestoreCollection.DAILY}/av-${FirestoreCollection.DAILY}`,
    documentationUrl: 'https://www.alphavantage.co/documentation/#latestprice',
    parameters: {
      symbol: {
        type: 'string',
        required: true,
        description: 'The name of the equity of your choice. For example: symbol=IBM',
      },
    },
  },
  
  // Fundamental Data
  [AlphaVantageEndpoint.OVERVIEW]: {
    id: AlphaVantageEndpoint.OVERVIEW,
    name: 'Company Overview',
    provider: ApiProvider.ALPHA_VANTAGE,
    category: AvEndpointCategory.FUNDAMENTAL_DATA,
    apiEndpoint: '/query',
    method: HttpMethod.GET,
    description: 'Returns the company information, financial ratios, and other key metrics for the equity specified.',
    ttl: 8 * 60 * 60, // 8 hours
    requiresSymbol: true,
    symbolUsage: EndpointSymbolUsage.REQUIRED,
    firestorePath: `${FirestoreCollection.COMPANY_DATA}/{symbol}/${FirestoreCollection.COMPANY_OVERVIEW}/av-${FirestoreCollection.COMPANY_OVERVIEW}`,
    documentationUrl: 'https://www.alphavantage.co/documentation/#company-overview',
    parameters: {
      symbol: {
        type: 'string',
        required: true,
        description: 'The name of the equity of your choice. For example: symbol=IBM',
      },
    },
  },
  
  [AlphaVantageEndpoint.EARNINGS]: {
    id: AlphaVantageEndpoint.EARNINGS,
    name: 'Earnings',
    provider: ApiProvider.ALPHA_VANTAGE,
    category: AvEndpointCategory.FUNDAMENTAL_DATA,
    apiEndpoint: '/query',
    method: HttpMethod.GET,
    description: 'Returns the annual and quarterly earnings (EPS) for the company of interest.',
    ttl: 7 * 24 * 60 * 60, // 1 week
    requiresSymbol: true,
    symbolUsage: EndpointSymbolUsage.REQUIRED,
    firestorePath: `${FirestoreCollection.COMPANY_DATA}/{symbol}/${FirestoreCollection.EARNINGS}/av-${FirestoreCollection.EARNINGS}`,
    documentationUrl: 'https://www.alphavantage.co/documentation/#earnings',
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
    requiresSymbol: true,
    symbolUsage: EndpointSymbolUsage.REQUIRED,
    firestorePath: `${FirestoreCollection.COMPANY_DATA}/{symbol}/${FirestoreCollection.INCOME_STATEMENT}/av-${FirestoreCollection.INCOME_STATEMENT}`,
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
    requiresSymbol: true,
    symbolUsage: EndpointSymbolUsage.REQUIRED,
    firestorePath: `${FirestoreCollection.COMPANY_DATA}/{symbol}/${FirestoreCollection.BALANCE_SHEET}/av-${FirestoreCollection.BALANCE_SHEET}`,
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
    requiresSymbol: true,
    symbolUsage: EndpointSymbolUsage.REQUIRED,
    firestorePath: `${FirestoreCollection.COMPANY_DATA}/{symbol}/${FirestoreCollection.CASH_FLOW}/av-${FirestoreCollection.CASH_FLOW}`,
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
    requiresSymbol: true,
    symbolUsage: EndpointSymbolUsage.REQUIRED,
    firestorePath: `${FirestoreCollection.COMPANY_DATA}/{symbol}/${FirestoreCollection.LISTING_DELISTING_STATUS}/av-${FirestoreCollection.LISTING_DELISTING_STATUS}`,
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
    requiresSymbol: true,
    symbolUsage: EndpointSymbolUsage.OPTIONAL,
    firestorePath: `${FirestoreCollection.COMPANY_DATA}/{symbol}/${FirestoreCollection.EARNINGS_CALENDAR}/av-${FirestoreCollection.EARNINGS_CALENDAR}`,
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
    requiresSymbol: true,
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
  
  // Symbol Search (doesn't require a symbol)
  [AlphaVantageEndpoint.SYMBOL_SEARCH]: {
    id: AlphaVantageEndpoint.SYMBOL_SEARCH,
    name: 'Symbol Search',
    provider: ApiProvider.ALPHA_VANTAGE,
    category: AvEndpointCategory.TIME_SERIES,
    apiEndpoint: '/query',
    method: HttpMethod.GET,
    description: 'Returns best matching symbols and market information based on keywords of your choice.',
    ttl: 7 * 24 * 60 * 60 * 52 * 100, // 100 years (effectively never expires)
    requiresSymbol: false,
    symbolUsage: EndpointSymbolUsage.NOT_SUPPORTED,
    firestorePath: FirestoreCollection.DO_NOT_IMPLEMENT,
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
    requiresSymbol: false,
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
    requiresSymbol: false,
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
    requiresSymbol: false,
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
    requiresSymbol: false,
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
    requiresSymbol: false,
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
    requiresSymbol: false,
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
    requiresSymbol: false,
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
    requiresSymbol: false,
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
    requiresSymbol: false,
    symbolUsage: EndpointSymbolUsage.NOT_SUPPORTED,
    firestorePath: `${FirestoreCollection.ECONOMIC_INDICATORS}/${FirestoreCollection.NONFARM_PAYROLL}/av-${FirestoreCollection.NONFARM_PAYROLL}`,
    documentationUrl: 'https://www.alphavantage.co/documentation/#nonfarm-payroll',
    parameters: {},
  },
} as const;
