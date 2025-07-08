import { 
  ApiProvider,
  EndpointCategory,
  HttpMethod 
} from '../common/enums';
import { AlphaVantageEndpoint } from '../../common/common-av';
import { EndpointConfig } from '../common/types';
import { AlphaVantageBaseHandler } from './handlers/alpha-vantage-base.handler';
import { AvDailyTimeSeriesHandler } from './handlers/av-daily-time-series.handler';
import { AvGlobalQuoteHandler } from './handlers/av-global-quote.handler';
import { AvCompanyOverviewHandler } from './handlers/av-company-overview.handler';

type EndpointConfigMap = {
  [K in AlphaVantageEndpoint]: EndpointConfig;
};

// Base configurations for specific endpoints
const ENDPOINT_CONFIGS: Partial<Record<AlphaVantageEndpoint, EndpointConfig>> = {
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
    parameters: {
      symbol: {
        type: 'string',
        required: true,
        description: 'The stock symbol to query',
      },
      outputsize: {
        type: 'string',
        required: false,
        enum: ['compact', 'full'],
        default: 'compact',
        description: 'The size of the time series to return',
      },
      datatype: {
        type: 'string',
        required: false,
        description: 'Output format',
        default: 'json',
        enum: ['json', 'csv']
      }
    },
    firestorePath: 'market_data/{symbol}/data_points/time_series_daily',
    documentationUrl: 'https://www.alphavantage.co/documentation/#daily'
  },
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
    parameters: {
      symbol: {
        type: 'string',
        required: true,
        description: 'The stock symbol to query',
      },
      datatype: {
        type: 'string',
        required: false,
        description: 'Output format',
        default: 'json',
        enum: ['json', 'csv']
      }
    },
    firestorePath: 'market_data/{symbol}/data_points/global_quote',
    documentationUrl: 'https://www.alphavantage.co/documentation/#latestprice'
  },
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
    parameters: {
      symbol: {
        type: 'string',
        required: true,
        description: 'The stock symbol to query',
      },
      datatype: {
        type: 'string',
        required: false,
        description: 'Output format',
        default: 'json',
        enum: ['json', 'csv']
      }
    },
    firestorePath: 'market_data/{symbol}/fundamentals/overview',
    documentationUrl: 'https://www.alphavantage.co/documentation/#company-overview'
  }
} as const;

// Define a type for the handler constructor
type HandlerConstructor = new (config: EndpointConfig) => AlphaVantageBaseHandler;

// Create a mapped type that only requires handlers for endpoints that exist in ENDPOINT_CONFIGS
type HandlerMap = {
  [K in AlphaVantageEndpoint]?: HandlerConstructor;
};

const HANDLER_MAP: HandlerMap = {
  [AlphaVantageEndpoint.TIME_SERIES_DAILY]: AvDailyTimeSeriesHandler,
  [AlphaVantageEndpoint.GLOBAL_QUOTE]: AvGlobalQuoteHandler,
  [AlphaVantageEndpoint.OVERVIEW]: AvCompanyOverviewHandler,
} as const;

export class AlphaVantageHandlerFactory {
  static createHandler<T = any>(
    endpointId: AlphaVantageEndpoint,
  ): AlphaVantageBaseHandler<T> {
    const config = this.getEndpointConfig(endpointId);
    const Handler = this.getHandler(endpointId);
    
    return new Handler(config) as AlphaVantageBaseHandler<T>;
  }

  static getEndpointConfig(endpointId: AlphaVantageEndpoint): Readonly<EndpointConfig> {
    const config = ENDPOINT_CONFIGS[endpointId];
    if (!config) {
      throw new Error(`No configuration found for endpoint: ${endpointId}`);
    }
    return Object.freeze({ ...config });
  }

  static getAllEndpointConfigs(): Readonly<Partial<EndpointConfigMap>> {
    return Object.freeze({ ...ENDPOINT_CONFIGS });
  }

  static getAvailableEndpoints(): AlphaVantageEndpoint[] {
    return Object.values(AlphaVantageEndpoint).filter(
      (value): value is AlphaVantageEndpoint => 
        typeof value === 'string' && value in ENDPOINT_CONFIGS
    );
  }

  private static getHandler(endpointId: AlphaVantageEndpoint): HandlerConstructor {
    const Handler = HANDLER_MAP[endpointId as keyof typeof HANDLER_MAP];
    if (!Handler) {
      throw new Error(`No handler registered for endpoint: ${endpointId}`);
    }
    return Handler;
  }
}
