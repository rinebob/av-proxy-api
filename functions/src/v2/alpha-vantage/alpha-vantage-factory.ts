import { AlphaVantageEndpoint } from '../common/common-av';
import { EndpointConfig } from '../common/types';
import { AlphaVantageBaseHandler } from './handlers/alpha-vantage-base.handler';
import { AvDailyTimeSeriesHandler } from './handlers/av-daily-time-series.handler';
import { AvGlobalQuoteHandler } from './handlers/av-global-quote.handler';
import { AvCompanyOverviewHandler } from './handlers/av-company-overview.handler';
import { AV_ENDPOINT_CONFIGS } from './config/av-endpoint-configs';

type EndpointConfigMap = {
  [K in AlphaVantageEndpoint]?: EndpointConfig;
};

// Use the imported endpoint configurations
const ENDPOINT_CONFIGS: EndpointConfigMap = AV_ENDPOINT_CONFIGS;

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
