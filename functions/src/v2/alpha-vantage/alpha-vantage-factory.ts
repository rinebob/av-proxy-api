import {  AV_ENDPOINT_CONFIGS, AV_TIME_SERIES_ENDPOINT_CONFIGS, AlphaVantageEndpoint, TimeSeriesEndpointConfig } from '@shared/alpha-vantage';
import type { EndpointConfig } from '@shared/core';
import { AvDailyTimeSeriesHandler } from './handlers/av-daily-time-series.handler';
import { AvGlobalQuoteHandler } from './handlers/av-global-quote.handler';
import { AvCompanyOverviewHandler } from './handlers/av-company-overview.handler';
import { AvBulkQuoteHandler } from './handlers/av-bulk-quote.handler';
import { AvSymbolSearchHandler } from './handlers/av-symbol-search.handler';

type HandlerConstructor = new (config: EndpointConfig | TimeSeriesEndpointConfig) => any;

const HANDLER_MAP: Record<string, HandlerConstructor> = {
  [AlphaVantageEndpoint.TIME_SERIES_DAILY]: AvDailyTimeSeriesHandler as unknown as HandlerConstructor,
  [AlphaVantageEndpoint.GLOBAL_QUOTE]: AvGlobalQuoteHandler,
  [AlphaVantageEndpoint.OVERVIEW]: AvCompanyOverviewHandler,
  [AlphaVantageEndpoint.REALTIME_BULK_QUOTES]: AvBulkQuoteHandler,
  [AlphaVantageEndpoint.SYMBOL_SEARCH]: AvSymbolSearchHandler,
};

function isTimeSeriesEndpoint(endpoint: AlphaVantageEndpoint): boolean {
  return Object.prototype.hasOwnProperty.call(AV_TIME_SERIES_ENDPOINT_CONFIGS, endpoint);
}

export class AlphaVantageHandlerFactory {
  /**
   * Gets the configuration for a specific endpoint
   * @param endpointId The endpoint ID to get configuration for
   * @returns A frozen copy of the endpoint configuration
   */
  static getEndpointConfig(endpointId: AlphaVantageEndpoint): Readonly<EndpointConfig | TimeSeriesEndpointConfig> {
    let config;
    if (isTimeSeriesEndpoint(endpointId)) {
      config = AV_TIME_SERIES_ENDPOINT_CONFIGS[endpointId];
    } else {
      config = AV_ENDPOINT_CONFIGS[endpointId];
    }
    if (!config) {
      throw new Error(`No configuration found for endpoint: ${endpointId}`);
    }
    return Object.freeze({ ...config });
  }

  /**
   * Creates a handler instance for the specified endpoint
   * @param endpointId The endpoint ID to create a handler for
   * @returns An instance of the appropriate handler
   */
  static createHandler<T = any>(endpointId: AlphaVantageEndpoint): any {
    const requestId = `factory-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
    console.log(`aVF cH [${requestId}] [FACTORY] Creating handler for endpoint: ${endpointId}`);
    // Diagnostic logging to debug handler map issues
    console.log('HANDLER_MAP keys:', Object.keys(HANDLER_MAP));
    console.log('Requested endpointId:', endpointId, typeof endpointId);
    try {
      const config = AlphaVantageHandlerFactory.getEndpointConfig(endpointId);
      const Handler = HANDLER_MAP[endpointId];
      if (!Handler) {
        throw new Error(`No handler found for endpoint: ${endpointId}`);
      }
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
   * Returns all available Alpha Vantage endpoint IDs (standard + time series)
   */
  static getAllEndpointIds(): string[] {
    // Merge keys from both config objects and dedupe
    return Array.from(new Set([
      ...Object.keys(AV_ENDPOINT_CONFIGS),
      ...Object.keys(AV_TIME_SERIES_ENDPOINT_CONFIGS)
    ]));
  }

  /**
   * Gets all available endpoint IDs
   * @returns An array of available endpoint IDs
   */
  static getAvailableEndpoints(): string[] {
    console.log(`aVF gAE [FACTORY] Retrieving available endpoints`);
    const endpoints = AlphaVantageHandlerFactory.getAllEndpointIds();
    console.log(`aVF gAE [FACTORY] Found ${endpoints.length} available endpoints`, {
      endpoints: endpoints.join(', ')
    });
    return endpoints;
  }
}
