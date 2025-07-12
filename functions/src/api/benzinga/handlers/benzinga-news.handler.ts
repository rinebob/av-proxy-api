import { BenzingaEndpointConfig } from '../config/bz-endpoint-configs';
import { BenzingaBaseHandler } from './benzinga-base.handler';
import { BENZINGA_NEWS_API_BASE_URL } from '../../../common/common-benz';

/**
 * Handler for Benzinga News endpoint. Handles parameter formatting and response transformation for /news.
 */
export class BenzingaNewsHandler extends BenzingaBaseHandler<any> {
  constructor(config: BenzingaEndpointConfig) {
    super({ ...config, apiEndpoint: BENZINGA_NEWS_API_BASE_URL });
    // Override the apiClient baseURL for news endpoint
    this.apiClient.defaults.baseURL = BENZINGA_NEWS_API_BASE_URL;
  }

  protected validateParams(params: Record<string, any>): void {
    // Optionally validate news-specific params (e.g., tickers, updatedSince, etc.)
  }

  protected prepareRequestParams(params: Record<string, any>): Record<string, any> {
    const preparedParams = { ...params };
    // Set defaults for news endpoint if needed
    if (preparedParams.page === undefined) preparedParams.page = 0;
    if (preparedParams.pageSize === undefined) preparedParams.pageSize = 20;
    // --- Hardcoded WIIM news logic ---
    preparedParams.channels = 'WIIM'; // Benzinga expects uppercase
    preparedParams.pageSize = 20; // Use camelCase as per Benzinga API
    if (params.sinceLastUpdate) {
      preparedParams.updatedSince = params.sinceLastUpdate;
    }
    return preparedParams;
  }

  protected transformResponse(data: any): any {
    // Pass through the raw news data (or adapt structure if needed)
    return data;
  }

  /**
   * Process the request by calling the base handler's fetch method.
   * @param params The request parameters.
   * @returns A promise that resolves with the API response.
   */
  protected async processRequest(params: Record<string, any>): Promise<any> {
    return this.fetch(params);
  }
}

