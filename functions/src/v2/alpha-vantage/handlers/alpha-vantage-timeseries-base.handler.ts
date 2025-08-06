import { AlphaVantageBaseHandler } from './alpha-vantage-base.handler';
import { saveAvTimeSeriesData } from '../firestore/av-firestore-helper';
import { ApiResponse } from '@shared/core';
import { AlphaVantageEndpoint, TimeSeriesEndpointConfig, TimeSeriesInterval } from '@shared/alpha-vantage';

/**
 * Abstract base handler for Alpha Vantage time series endpoints.
 * Handles parameter validation, request preparation, fetch orchestration,
 * Firestore write (normalized schema), and error handling for time series endpoints.
 */
export abstract class AlphaVantageTimeSeriesHandlerBase<T extends any[] = any[]> extends AlphaVantageBaseHandler<T> {
  protected readonly config: TimeSeriesEndpointConfig;

  constructor(config: TimeSeriesEndpointConfig) {
    super(config);
    this.config = config;
  }

  protected validateParams(params: Record<string, any>): void {
    // Validate required params for time series endpoints (e.g. symbol, outputsize)
    if (!params.symbol) {
      throw new Error('Missing required parameter: symbol');
    }
    // Optionally validate outputsize, interval, etc.
  }

  protected prepareRequestParams(params: any): any {
    // Add outputsize, interval, apikey, and any other required params
    return { ...params, ...this.baseParams };
  }

  /**
   * Fetches time series data, transforms, saves to Firestore, and returns ApiResponse.
   */
  public async fetch(params: any = {}): Promise<ApiResponse<T>> {
    super.logRequest(params, 'AVTimeSeriesHandlerBase.fetch');
    const startTime = Date.now();
    const endpoint = this.config.id;
    this.validateParams(params);
    const requestParams = this.prepareRequestParams(params);
    try {
      const response = await this.apiClient.get('', { params: requestParams });
      const responseData = response.data;
      const transformedData = this.transformResponse(responseData);
      // Save to Firestore using normalized schema
      const symbol = params.symbol;
      if (symbol && Object.values(AlphaVantageEndpoint).includes(endpoint as AlphaVantageEndpoint)) {
        await saveAvTimeSeriesData(
          transformedData,
          symbol,
          endpoint as AlphaVantageEndpoint,
          this.config.interval as TimeSeriesInterval,
          true // Check whether manual firestore write is enabled (for manual data refresh)
        );
      }
      return this.createSuccessResponse(transformedData, this.config.ttl, startTime);
    } catch (error) {
      throw super.normalizeError(error);
    }
  }

  protected abstract transformResponse(data: any): T;
}