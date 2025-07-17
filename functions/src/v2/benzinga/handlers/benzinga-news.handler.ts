import { BenzingaNewsRequestConfig } from '../../../common/common-benz';
import { BenzingaBaseHandler } from './benzinga-base.handler';
import { BENZINGA_NEWS_API_BASE_URL } from '../../../common/common-benz';
import { BenzingaNewsParameter } from '../../../common/common-benz';

const fetchNewsByIdArticle = false;

/**
 * Type definitions for news parameters
 */
interface NewsParams {
  [BenzingaNewsParameter.PAGE]?: number;
  [BenzingaNewsParameter.PAGE_SIZE]?: number;
  [BenzingaNewsParameter.UPDATED_SINCE]?: number;
  [BenzingaNewsParameter.PUBLISHED_SINCE]?: number;
  [BenzingaNewsParameter.CHANNELS]?: string;
  [BenzingaNewsParameter.DATE]?: string;
  [BenzingaNewsParameter.DATE_FROM]?: string;
  [BenzingaNewsParameter.DATE_TO]?: string;
  [BenzingaNewsParameter.SORT]?: string;
  [BenzingaNewsParameter.DISPLAY_OUTPUT]?: string;
  [BenzingaNewsParameter.TICKERS]?: string;
  [BenzingaNewsParameter.TOPICS]?: string;
  [BenzingaNewsParameter.AUTHORS]?: string;
  [BenzingaNewsParameter.CONTENT_TYPES]?: string;
}

/**
 * Handler for SvtBzNewsRequest.BZ_NEWS Handles parameter formatting and response transformation for /news.
 */
export class BenzingaNewsHandler extends BenzingaBaseHandler<any> {
  constructor(config: BenzingaNewsRequestConfig) {
    super({ ...config, apiEndpoint: BENZINGA_NEWS_API_BASE_URL });
    // Override the apiClient baseURL for news endpoint
    this.apiClient.defaults.baseURL = BENZINGA_NEWS_API_BASE_URL;
    
    // Override paramsSerializer for news endpoint
    this.apiClient.defaults.paramsSerializer = (params: Record<string, any>) => {
      const searchParams = new URLSearchParams();
      
      for (const key of Object.keys(params)) {
        const value = params[key];
        if (value === undefined || value === null) {
          continue; // Skip undefined or null values
        }

        // Handle token parameter
        if (key === 'token') {
          searchParams.append('token', value);
          continue;
        }

        // Handle arrays by joining with commas (e.g., tickers, channels)
        if (Array.isArray(value)) {
          searchParams.append(key, value.join(','));
        } 
        // Handle objects by flattening them (no parameters[] prefix)
        else if (typeof value === 'object') {
          for (const nestedKey of Object.keys(value)) {
            const nestedValue = value[nestedKey];
            if (nestedValue !== undefined && nestedValue !== null) {
              searchParams.append(nestedKey, nestedValue);
            }
          }
        } 
        // Handle simple values
        else {
          searchParams.append(key, value);
        }
      }
      
      return searchParams.toString();
    };
  }

  protected validateParams(params: Record<string, any>): void {
    // Validate required parameters
    
    // Validate date formats if present
    if (params[BenzingaNewsParameter.DATE] && 
        !/^\d{4}-\d{2}-\d{2}$/.test(params[BenzingaNewsParameter.DATE])) {
      throw new Error('Invalid date format. Expected YYYY-MM-DD');
    }

    if (params[BenzingaNewsParameter.DATE_FROM] && 
        !/^\d{4}-\d{2}-\d{2}$/.test(params[BenzingaNewsParameter.DATE_FROM])) {
      throw new Error('Invalid date_from format. Expected YYYY-MM-DD');
    }

    if (params[BenzingaNewsParameter.DATE_TO] && 
        !/^\d{4}-\d{2}-\d{2}$/.test(params[BenzingaNewsParameter.DATE_TO])) {
      throw new Error('Invalid date_to format. Expected YYYY-MM-DD');
    }

    // Validate numeric parameters
    const numericParams = [BenzingaNewsParameter.PAGE, 
                         BenzingaNewsParameter.PAGE_SIZE, 
                         BenzingaNewsParameter.UPDATED_SINCE,
                         BenzingaNewsParameter.PUBLISHED_SINCE];

    for (const param of numericParams) {
      if (params[param] !== undefined && typeof params[param] !== 'number') {
        throw new Error(`${param} must be a number`);
      }
    }

    // Validate page size range
    if (params[BenzingaNewsParameter.PAGE_SIZE] && 
        (params[BenzingaNewsParameter.PAGE_SIZE] < 1 || params[BenzingaNewsParameter.PAGE_SIZE] > 100)) {
      throw new Error('pageSize must be between 1 and 100');
    }
  }

  protected prepareRequestParams(params: NewsParams): NewsParams {
    // Set defaults for news endpoint
    const preparedParams: NewsParams = {
      [BenzingaNewsParameter.PAGE]: params[BenzingaNewsParameter.PAGE] ?? 0,
      [BenzingaNewsParameter.PAGE_SIZE]: params[BenzingaNewsParameter.PAGE_SIZE] ?? 100,
      ...params // Include any other params passed in
    };

    // Remove updatedSince parameter since it causes 401 errors
    delete preparedParams[BenzingaNewsParameter.UPDATED_SINCE];

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
    // Default: fetch news list using base implementation
    return this.processRequestBase(params);
  }
}
