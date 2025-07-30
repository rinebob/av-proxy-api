import { AlphaVantageEndpoint } from '../common/common-av';
import { EndpointConfig, TimeSeriesEndpointConfig } from '../common/types';
import { AvDailyTimeSeriesHandler } from './handlers/av-daily-time-series.handler';
import { AvGlobalQuoteHandler } from './handlers/av-global-quote.handler';
import { AvCompanyOverviewHandler } from './handlers/av-company-overview.handler';
import { AvBulkQuoteHandler } from './handlers/av-bulk-quote.handler';
import { AvSymbolSearchHandler } from './handlers/av-symbol-search.handler';
import { AV_ENDPOINT_CONFIGS } from './request-configs/av-endpoint-configs';

type HandlerConstructor = new (config: EndpointConfig | TimeSeriesEndpointConfig) => any;

const HANDLER_MAP: Record<string, HandlerConstructor> = {
  [AlphaVantageEndpoint.TIME_SERIES_DAILY]: AvDailyTimeSeriesHandler as unknown as HandlerConstructor,
  [AlphaVantageEndpoint.GLOBAL_QUOTE]: AvGlobalQuoteHandler,
  [AlphaVantageEndpoint.OVERVIEW]: AvCompanyOverviewHandler,
  [AlphaVantageEndpoint.REALTIME_BULK_QUOTES]: AvBulkQuoteHandler,
  [AlphaVantageEndpoint.SYMBOL_SEARCH]: AvSymbolSearchHandler,
};

export class AlphaVantageHandlerFactory {
  /**
   * Creates a handler instance for the specified endpoint
   * @param endpointId The endpoint ID to create a handler for
   * @returns An instance of the appropriate handler
   */
  static createHandler<T = any>(
    endpointId: AlphaVantageEndpoint,
  ): any {
    const requestId = `factory-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
    console.log(`aVF cH [${requestId}] [FACTORY] Creating handler for endpoint: ${endpointId}`);
    
    try {
      const config = AV_ENDPOINT_CONFIGS[endpointId];
      if (!config) {
        throw new Error(`No configuration found for endpoint: ${endpointId}`);
      }
      console.log(`aVF cH [${requestId}] [FACTORY] Retrieved config for endpoint: ${endpointId}`, {
        name: config.name,
        category: config.category,
        ttl: config.ttl
      });
      
      const Handler = HANDLER_MAP[endpointId];
      if (!Handler) {
        throw new Error(`No handler registered for endpoint: ${endpointId}`);
      }
      console.log(`aVF cH [${requestId}] [FACTORY] Found handler for endpoint: ${endpointId}`, {
        handlerName: Handler.name
      });
      
      const handler = new Handler(config) as T;
      
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
    const config = AV_ENDPOINT_CONFIGS[endpointId];
    if (!config) {
      const error = new Error(`No configuration found for endpoint: ${endpointId}`);
      console.error(`aVF gEC [FACTORY] Configuration error: ${error.message}`, {
        availableEndpoints: Object.keys(AV_ENDPOINT_CONFIGS).join(', ')
      });
      throw error;
    }
    return Object.freeze({ ...config });
  }

  /**
   * Gets all endpoint configurations
   * @returns A frozen copy of all endpoint configurations
   */
  static getAllEndpointConfigs(): Readonly<Partial<Record<string, EndpointConfig>>> {
    console.log(`aVF gEC [FACTORY] Retrieving all endpoint configurations`);
    const configs = { ...AV_ENDPOINT_CONFIGS };
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
        typeof value === 'string' && value in AV_ENDPOINT_CONFIGS
    );
    console.log(`aVF gAE [FACTORY] Found ${endpoints.length} available endpoints`, {
      endpoints: endpoints.join(', ')
    });
    return endpoints;
  }
}
