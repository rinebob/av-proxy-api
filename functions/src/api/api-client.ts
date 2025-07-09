import { ApiProvider } from './common/enums';
import { BenzingaEndpoint } from '../common/common-benz';
import { AlphaVantageEndpoint } from '../common/common-av';
import { ApiResponse } from './common/types';
import { AlphaVantageHandlerFactory } from './alpha-vantage/alpha-vantage-factory';
import { BenzingaHandlerFactory } from './benzinga/benzinga-factory';

export class ApiClient {
  constructor() {}

  /**
   * Fetch data from Alpha Vantage API
   */
  async fetchAlphaVantage<T = any>(
    endpoint: AlphaVantageEndpoint,
    params: Record<string, any> = {}
  ): Promise<ApiResponse<T>> {
    try {
      const handler = AlphaVantageHandlerFactory.createHandler<T>(endpoint);
      return handler.fetch(params);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      throw new Error(`Alpha Vantage API error (${endpoint}): ${errorMessage}`);
    }
  }

  /**
   * Fetch data from Benzinga API 
   */
  async fetchBenzinga<T = any>(
    endpoint: BenzingaEndpoint,
    params: Record<string, any> = {}
  ): Promise<ApiResponse<T>> {
    try {
      const handler = BenzingaHandlerFactory.createHandler<T>(endpoint);
      return handler.fetch(params);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      throw new Error(`Benzinga API error (${endpoint}): ${errorMessage}`);
    }
  }

  /**
   * Unified fetch method that works with both Alpha Vantage and Benzinga APIs
   */
  async fetch<T = any>(
    provider: ApiProvider,
    endpoint: AlphaVantageEndpoint | BenzingaEndpoint,
    params: Record<string, any> = {}
  ): Promise<ApiResponse<T>> {
    switch (provider) {
      case ApiProvider.ALPHA_VANTAGE:
        return this.fetchAlphaVantage<T>(endpoint as AlphaVantageEndpoint, params);
      case ApiProvider.BENZINGA:
        return this.fetchBenzinga<T>(endpoint as BenzingaEndpoint, params);
      default:
        throw new Error(`Unsupported API provider: ${provider}`);
    }
  }

  /**
   * Get available endpoints for a specific provider
   */
  getAvailableEndpoints(provider: ApiProvider): string[] {
    switch (provider) {
      case ApiProvider.ALPHA_VANTAGE:
        return AlphaVantageHandlerFactory.getAvailableEndpoints() as string[];
      case ApiProvider.BENZINGA:
        return BenzingaHandlerFactory.getAvailableEndpoints();
      default:
        throw new Error(`Unsupported API provider: ${provider}`);
    }
  }

  /**
   * Get endpoint configuration
   */
  getEndpointConfig(provider: ApiProvider, endpoint: AlphaVantageEndpoint | BenzingaEndpoint) {
    switch (provider) {
      case ApiProvider.ALPHA_VANTAGE:
        return AlphaVantageHandlerFactory.getEndpointConfig(endpoint as AlphaVantageEndpoint);
      case ApiProvider.BENZINGA:
        return BenzingaHandlerFactory.getEndpointConfig(endpoint as BenzingaEndpoint);
      default:
        throw new Error(`Unsupported API provider: ${provider}`);
    }
  }

  /**
   * Get all endpoint configurations for a provider
   */
  getAllEndpointConfigs(provider: ApiProvider) {
    switch (provider) {
      case ApiProvider.ALPHA_VANTAGE:
        return AlphaVantageHandlerFactory.getAllEndpointConfigs();
      case ApiProvider.BENZINGA:
        return BenzingaHandlerFactory.getAllEndpointConfigs();
      default:
        throw new Error(`Unsupported API provider: ${provider}`);
    }
  }
}
