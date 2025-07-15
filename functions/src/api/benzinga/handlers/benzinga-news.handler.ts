import { BenzingaNewsRequestConfig } from '../../../common/common-benz';
import { BenzingaBaseHandler } from './benzinga-base.handler';
import { BENZINGA_NEWS_API_BASE_URL } from '../../../common/common-benz';

const fetchNewsByIdArticle = false;

/**
 * Handler for SvtBzNewsRequest.BZ_NEWS Handles parameter formatting and response transformation for /news.
 */
export class BenzingaNewsHandler extends BenzingaBaseHandler<any> {
  constructor(config: BenzingaNewsRequestConfig) {
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
    // Use pageSize from params, or default to 100 if not provided
    if (preparedParams.pageSize === undefined) preparedParams.pageSize = 100;
    
    // Set channels from params (should be a single string)
    if (typeof params.channels === 'string') {
      preparedParams.channels = params.channels;
    }
    
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
    // If newsId is provided, fetch a single news item
    if (fetchNewsByIdArticle) { // Temporarily disabled news_by_id request
      const newsId = params.newsId;
      const apiParams = { ...params };
      // Remove both possible id/newsId keys from params to avoid query param pollution
      delete apiParams.newsId;
      delete apiParams.id;
      // Inject path param for {newsId}
      if (this.config.apiEndpoint && this.config.apiEndpoint.includes('{newsId}')) {
        this.config.apiEndpoint = this.config.apiEndpoint.replace('{newsId}', encodeURIComponent(newsId));
      }
      // Only send params specified in endpoint config for SvtBzNewsRequest.BZ_NEWS_BY_ID
      const benzingaConfig = this.config as BenzingaNewsRequestConfig;
      const allowedParams = benzingaConfig.parameterKeys || [];
      const filteredParams: Record<string, any> = {};
      for (const key of allowedParams) {
        if (apiParams[key] !== undefined) filteredParams[key] = apiParams[key];
      }
      try {
        // Use fetchRaw to avoid prepareRequestParams for by-id
        if (typeof (this as any).fetchRaw === 'function') {
          const apiResp = await (this as any).fetchRaw(filteredParams);
          if (apiResp && apiResp.data && Array.isArray(apiResp.data) && apiResp.data.length > 0) {
            return { data: apiResp.data[0], source: 'benzinga', id: newsId };
          } else if (apiResp && apiResp.data && apiResp.data.id) {
            // In case Benzinga returns a single object
            return { data: apiResp.data, source: 'benzinga', id: newsId };
          }
          return { error: 'Not Found', message: `News item ${newsId} not found in Benzinga or Firestore` };
        } else {
          const apiResp = await this.fetch(filteredParams);
          if (apiResp && apiResp.data && Array.isArray(apiResp.data) && apiResp.data.length > 0) {
            return { data: apiResp.data[0], source: 'benzinga', id: newsId };
          } else if (apiResp && apiResp.data && apiResp.data.id) {
            // In case Benzinga returns a single object
            return { data: apiResp.data, source: 'benzinga', id: newsId };
          }
          return { error: 'Not Found', message: `News item ${newsId} not found in Benzinga or Firestore` };
        }
      } catch (err) {
        return { error: 'Not Found', message: `News item ${newsId} not found in Benzinga or Firestore`, details: err };
      }
    }
    // Default: fetch news list
    return this.fetch(params);
  }
}

