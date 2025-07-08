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
  /**
   * Creates a handler instance for the specified endpoint
   * @param endpointId The endpoint ID to create a handler for
   * @returns An instance of the appropriate handler
   */
  static createHandler<T = any>(
    endpointId: AlphaVantageEndpoint,
  ): AlphaVantageBaseHandler<T> {
    const requestId = `factory-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
    console.log(`aVF cH [${requestId}] [FACTORY] Creating handler for endpoint: ${endpointId}`);
    
    try {
      const config = this.getEndpointConfig(endpointId);
      console.log(`aVF cH [${requestId}] [FACTORY] Retrieved config for endpoint: ${endpointId}`, {
        name: config.name,
        category: config.category,
        ttl: config.ttl
      });
      
      const Handler = this.getHandler(endpointId);
      console.log(`aVF cH [${requestId}] [FACTORY] Found handler for endpoint: ${endpointId}`, {
        handlerName: Handler.name
      });
      
      const handler = new Handler(config) as AlphaVantageBaseHandler<T>;
      
      console.log(`aVF cH [${requestId}] [FACTORY] Successfully created handler for endpoint: ${endpointId}`);
      return handler;
      
    } catch (error) {
      console.error(`aVF cH [${requestId}] [FACTORY] Error creating handler for endpoint ${endpointId}:`, {
        error: error instanceof Error ? error.message : 'Unknown error',
        stack: error instanceof Error ? error.stack : undefined
      });
      throw error;
    }
  }

  /**
   * Gets the configuration for a specific endpoint
   * @param endpointId The endpoint ID to get configuration for
   * @returns A frozen copy of the endpoint configuration
   */
  static getEndpointConfig(endpointId: AlphaVantageEndpoint): Readonly<EndpointConfig> {
    const config = ENDPOINT_CONFIGS[endpointId];
    if (!config) {
      const error = new Error(`No configuration found for endpoint: ${endpointId}`);
      console.error(`aVF gEC [FACTORY] Configuration error: ${error.message}`, {
        availableEndpoints: Object.keys(ENDPOINT_CONFIGS).join(', ')
      });
      throw error;
    }
    return Object.freeze({ ...config });
  }

  /**
   * Gets all endpoint configurations
   * @returns A frozen copy of all endpoint configurations
   */
  static getAllEndpointConfigs(): Readonly<Partial<EndpointConfigMap>> {
    console.log(`aVF gEC [FACTORY] Retrieving all endpoint configurations`);
    const configs = { ...ENDPOINT_CONFIGS };
    console.log(`aVF gEC [FACTORY] Found ${Object.keys(configs).length} endpoint configurations`);
    return Object.freeze(configs);
  }

  /**
   * Gets all available endpoint IDs
   * @returns An array of available endpoint IDs
   */
  static getAvailableEndpoints(): AlphaVantageEndpoint[] {
    console.log(`aVF gAE [FACTORY] Retrieving available endpoints`);
    const endpoints = Object.values(AlphaVantageEndpoint).filter(
      (value): value is AlphaVantageEndpoint => 
        typeof value === 'string' && value in ENDPOINT_CONFIGS
    );
    console.log(`aVF gAE [FACTORY] Found ${endpoints.length} available endpoints`, {
      endpoints: endpoints.join(', ')
    });
    return endpoints;
  }

  /**
   * Gets the handler constructor for a specific endpoint
   * @param endpointId The endpoint ID to get the handler for
   * @returns The handler constructor for the specified endpoint
   * @private
   */
  private static getHandler(endpointId: AlphaVantageEndpoint): HandlerConstructor {
    const Handler = HANDLER_MAP[endpointId as keyof typeof HANDLER_MAP];
    if (!Handler) {
      const error = new Error(`No handler registered for endpoint: ${endpointId}`);
      console.error(`aVF gH [FACTORY] Handler error: ${error.message}`, {
        availableHandlers: Object.keys(HANDLER_MAP).join(', ')
      });
      throw error;
    }
    return Handler;
  }
}
