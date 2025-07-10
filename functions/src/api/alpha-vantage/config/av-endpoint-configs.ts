import { 
  ApiProvider,
  EndpointCategory,
  HttpMethod 
} from '../../common/enums';
import { AlphaVantageEndpoint, OutputSize } from '../../../common/common-av';
import { EndpointConfig } from '../../common/types';

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
    category: EndpointCategory.STOCK_TIME_SERIES,
    path: '/query',
    method: HttpMethod.GET,
    description: 'Returns daily time series (date, daily open, daily high, daily low, daily close, daily volume) of the global equity specified.',
    ttl: 24 * 60 * 60, // 24 hours
    requiresSymbol: true,
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
    category: EndpointCategory.STOCK_TIME_SERIES,
    path: '/query',
    method: HttpMethod.GET,
    description: 'Returns intraday time series (timestamp, open, high, low, close, volume) of the equity specified.',
    ttl: 5 * 60, // 5 minutes
    requiresSymbol: true,
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
    category: EndpointCategory.STOCK_TIME_SERIES,
    path: '/query',
    method: HttpMethod.GET,
    description: 'Returns daily time series (date, daily open, daily high, daily low, daily close, daily volume, daily adjusted close, and split/dividend events) of the global equity specified.',
    ttl: 24 * 60 * 60, // 24 hours
    requiresSymbol: true,
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
    category: EndpointCategory.STOCK_TIME_SERIES,
    path: '/query',
    method: HttpMethod.GET,
    description: 'Returns weekly time series (last trading day of each week, weekly open, weekly high, weekly low, weekly close, weekly volume) of the global equity specified.',
    ttl: 7 * 24 * 60 * 60, // 1 week
    requiresSymbol: true,
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
    category: EndpointCategory.STOCK_TIME_SERIES,
    path: '/query',
    method: HttpMethod.GET,
    description: 'Returns weekly adjusted time series (last trading day of each week, weekly open, weekly high, weekly low, weekly close, weekly adjusted close, weekly volume, weekly dividend) of the equity specified.',
    ttl: 7 * 24 * 60 * 60, // 1 week
    requiresSymbol: true,
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
    category: EndpointCategory.STOCK_TIME_SERIES,
    path: '/query',
    method: HttpMethod.GET,
    description: 'Returns monthly time series (last trading day of each month, monthly open, monthly high, monthly low, monthly close, monthly volume) of the global equity specified.',
    ttl: 30 * 24 * 60 * 60, // 30 days
    requiresSymbol: true,
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
    category: EndpointCategory.STOCK_TIME_SERIES,
    path: '/query',
    method: HttpMethod.GET,
    description: 'Returns monthly adjusted time series (last trading day of each month, monthly open, monthly high, monthly low, monthly close, monthly adjusted close, monthly volume, monthly dividend) of the equity specified.',
    ttl: 30 * 24 * 60 * 60, // 30 days
    requiresSymbol: true,
    documentationUrl: 'https://www.alphavantage.co/documentation/#monthlyadj',
    parameters: {
      symbol: {
        type: 'string',
        required: true,
        description: 'The name of the equity of your choice. For example: symbol=IBM',
      },
    },
  },

  // Stock Quotes
  [AlphaVantageEndpoint.GLOBAL_QUOTE]: {
    id: AlphaVantageEndpoint.GLOBAL_QUOTE,
    name: 'Global Quote',
    provider: ApiProvider.ALPHA_VANTAGE,
    category: EndpointCategory.STOCK_TIME_SERIES,
    path: '/query',
    method: HttpMethod.GET,
    description: 'Returns the latest price and volume information for a security of your choice.',
    ttl: 5 * 60, // 5 minutes
    requiresSymbol: true,
    documentationUrl: 'https://www.alphavantage.co/documentation/#latestprice',
    parameters: {
      symbol: {
        type: 'string',
        required: true,
        description: 'The name of the equity of your choice. For example: symbol=IBM',
      },
    },
  },

  // Company Information
  [AlphaVantageEndpoint.OVERVIEW]: {
    id: AlphaVantageEndpoint.OVERVIEW,
    name: 'Company Overview',
    provider: ApiProvider.ALPHA_VANTAGE,
    category: EndpointCategory.FUNDAMENTAL_DATA,
    path: '/query',
    method: HttpMethod.GET,
    description: 'Returns the company information, financial ratios, and other key metrics for the equity specified.',
    ttl: 7 * 24 * 60 * 60, // 1 week
    requiresSymbol: true,
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
    category: EndpointCategory.FUNDAMENTAL_DATA,
    path: '/query',
    method: HttpMethod.GET,
    description: 'Returns the annual and quarterly earnings (EPS) for the company of interest.',
    ttl: 7 * 24 * 60 * 60, // 1 week
    requiresSymbol: true,
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
    category: EndpointCategory.FUNDAMENTAL_DATA,
    path: '/query',
    method: HttpMethod.GET,
    description: 'Returns the annual and quarterly income statements for the company of interest.',
    ttl: 7 * 24 * 60 * 60, // 1 week
    requiresSymbol: true,
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
    category: EndpointCategory.FUNDAMENTAL_DATA,
    path: '/query',
    method: HttpMethod.GET,
    description: 'Returns the annual and quarterly balance sheets for the company of interest.',
    ttl: 7 * 24 * 60 * 60, // 1 week
    requiresSymbol: true,
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
    category: EndpointCategory.FUNDAMENTAL_DATA,
    path: '/query',
    method: HttpMethod.GET,
    description: 'Returns the annual and quarterly cash flow for the company of interest.',
    ttl: 7 * 24 * 60 * 60, // 1 week
    requiresSymbol: true,
    documentationUrl: 'https://www.alphavantage.co/documentation/#cash-flow',
    parameters: {
      symbol: {
        type: 'string',
        required: true,
        description: 'The name of the equity of your choice. For example: symbol=IBM',
      },
    },
  },

  // Search
  [AlphaVantageEndpoint.SYMBOL_SEARCH]: {
    id: AlphaVantageEndpoint.SYMBOL_SEARCH,
    name: 'Symbol Search',
    provider: ApiProvider.ALPHA_VANTAGE,
    category: EndpointCategory.STOCK_TIME_SERIES,
    path: '/query',
    method: HttpMethod.GET,
    description: 'Returns best matching symbols and market information based on keywords of your choice.',
    ttl: 7 * 24 * 60 * 60, // 1 week
    requiresSymbol: false,
    documentationUrl: 'https://www.alphavantage.co/documentation/#symbolsearch',
    parameters: {
      keywords: {
        type: 'string',
        required: true,
        description: 'A text string of your choice. For example: keywords=microsoft.',
      },
    },
  },

  // Note: Technical indicators can be added here as needed
  // Example:
  // [AlphaVantageEndpoint.SMA]: {
  //   id: AlphaVantageEndpoint.SMA,
  //   name: 'Simple Moving Average',
  //   provider: ApiProvider.ALPHA_VANTAGE,
  //   category: EndpointCategory.TECHNICAL_INDICATORS,
  //   path: '/query',
  //   method: HttpMethod.GET,
  //   description: 'Returns the Simple Moving Average (SMA) values.',
  //   ttl: 24 * 60 * 60, // 24 hours
  //   requiresSymbol: true,
  //   documentationUrl: 'https://www.alphavantage.co/documentation/#sma',
  //   parameters: {
  //     symbol: {
  //       type: 'string',
  //       required: true,
  //       description: 'The name of the equity of your choice. For example: symbol=IBM',
  //     },
  //     interval: {
  //       type: 'string',
  //       required: true,
  //       description: 'Time interval between two consecutive data points in the time series.',
  //       enum: ['1min', '5min', '15min', '30min', '60min', 'daily', 'weekly', 'monthly'],
  //     },
  //     time_period: {
  //       type: 'number',
  //       required: true,
  //       description: 'Number of data points used to calculate each moving average value.',
  //       min: 1,
  //       max: 200,
  //     },
  //     series_type: {
  //       type: 'string',
  //       required: true,
  //       description: 'The desired price type in the time series.',
  //       enum: ['open', 'high', 'low', 'close'],
  //     },
  //   },
  // },
} as const;
