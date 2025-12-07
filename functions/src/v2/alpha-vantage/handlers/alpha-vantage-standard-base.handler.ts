import { AlphaVantageBaseHandler } from './alpha-vantage-base.handler';
import { saveAvData } from '../firestore/av-firestore-helper';
import { AlphaVantageEndpoint } from '@shared/alpha-vantage';
import { ApiResponse } from '@shared/core';

/**
 * Abstract base handler for Alpha Vantage standard (non–time series) endpoints.
 * Handles parameter validation, request preparation, fetch orchestration,
 * Firestore write (standard schema), and error handling for standard endpoints.
 */
export abstract class AlphaVantageStandardHandlerBase<T = any> extends AlphaVantageBaseHandler<T> {
  protected validateParams(params: Record<string, any>): void {
    // Validate required params for standard endpoints (e.g. symbol, etc. if needed)
    // Optionally override in concrete handler if endpoint-specific
  }

  protected prepareRequestParams(params: any): any {
    // Add apikey and any other required params
    return { ...params, ...this.baseParams };
  }

  /**
   * Fetches standard endpoint data, transforms, saves to Firestore, and returns ApiResponse.
   */
  public async fetch(params: any = {}): Promise<ApiResponse<T>> {
    super.logRequest(params, 'AVStandardHandlerBase.fetch');
    const startTime = Date.now();
    const endpoint = this.config.id;
    this.validateParams(params);
    const requestParams = this.prepareRequestParams(params);
    try {
      const response = await this.apiClient.get('', { params: requestParams });
      const responseData = response.data;
      const transformedData = this.transformResponse(responseData);
      // Save to Firestore using standard schema
      const symbol = params.symbol;
      // Never save GLOBAL_QUOTE to Firestore (transient-only endpoint)
      if (
        symbol &&
        Object.values(AlphaVantageEndpoint).includes(endpoint as AlphaVantageEndpoint) &&
        endpoint !== AlphaVantageEndpoint.GLOBAL_QUOTE
      ) {
        await saveAvData(
          transformedData,
          symbol,
          endpoint as AlphaVantageEndpoint,
          this.config
        );
      } else if (endpoint === AlphaVantageEndpoint.GLOBAL_QUOTE) {
        console.log('[AvGlobalQuoteHandler] Skipping Firestore save for GLOBAL_QUOTE. Logging and returning data only.');
        console.log('[AvGlobalQuoteHandler] GLOBAL_QUOTE data:', transformedData);
      }
      return this.createSuccessResponse(transformedData, this.config.ttl, startTime);
    } catch (error) {
      throw super.normalizeError(error);
    }
  }

  protected abstract transformResponse(data: any): T;
}
