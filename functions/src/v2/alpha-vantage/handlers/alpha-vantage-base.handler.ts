import axios, { AxiosInstance, AxiosRequestConfig } from 'axios';
import { ApiProvider, ApiResponse, ApiError, DATA_PROVIDERS, EndpointConfig } from '@shared/core';
import { saveAvData } from '../firestore/av-firestore-helper';
import { AlphaVantageEndpoint } from '@shared/alpha-vantage';
import { AvEndpointCategory } from '@shared/alpha-vantage';
import { createLogger, hr } from '../../utils/utils';

const log = createLogger('av.handler.base'); // Abbrev: aVB.H (JSON)

function getAlphaVantageApiKey(): string {
  if (process.env.FUNCTIONS_EMULATOR === 'true' && process.env.LOCAL_EMULATOR_ALPHAVANTAGE_API_KEY) {
    return process.env.LOCAL_EMULATOR_ALPHAVANTAGE_API_KEY;
  }
  if (process.env.ALPHAVANTAGE_API_KEY) {
    return process.env.ALPHAVANTAGE_API_KEY;
  }
  throw new Error('Alpha Vantage API key not configured');
}

export abstract class AlphaVantageBaseHandler<T = any> {
  protected readonly config: EndpointConfig;
  protected readonly apiClient: AxiosInstance;
  protected readonly requestId: string;
  protected readonly baseParams: any;
  protected readonly isTimeSeriesBlocked: boolean;

  constructor(config: EndpointConfig) {
    this.config = config;
    this.requestId = Math.random().toString(36).substring(2, 10);

    this.isTimeSeriesBlocked = config.category === AvEndpointCategory.TIME_SERIES;
    
    this.baseParams = {
      apikey: getAlphaVantageApiKey(),
      function: this.config.id,
      datatype: DATA_PROVIDERS[ApiProvider.ALPHA_VANTAGE].responseType
    };

    this.apiClient = axios.create({
      baseURL: DATA_PROVIDERS[ApiProvider.ALPHA_VANTAGE].baseUrl,
      timeout: DATA_PROVIDERS[ApiProvider.ALPHA_VANTAGE].defaultTimeoutMs
    });

    log.debug('ctor', { endpointId: this.config.id, baseURL: this.apiClient.defaults.baseURL, params: this.maskParamsForLog(this.baseParams) });
  }

  /**
   * Mask sensitive parameters before logging.
   */
  private maskParamsForLog(params: any): any {
    try {
      if (!params) return params;
      const clone = Array.isArray(params) ? [...params] : { ...params };
      if (clone && typeof clone === 'object') {
        if ('apikey' in clone) clone.apikey = '***';
      }
      return clone;
    } catch {
      return params;
    }
  }

  /**
   * A simplified version of fetch that just makes the API call and returns the raw response
   * without any additional processing, transformation, or Firestore saving.
   * @param params Request parameters
   * @returns The raw API response data
   */
  protected async fetchSimple<T>(params: any = {}): Promise<T> {
    const requestId = Math.random().toString(36).substring(2, 10);
    hr('aVB.H', `fetchSimple start ${this.config.id} [${requestId}]`);
    log.info('fetch.simple.start', { endpointId: this.config.id, requestId, params: this.maskParamsForLog(params) });

    try {
      // Prepare and make API request
      const requestParams = this.prepareRequestParams(params);
      const config: AxiosRequestConfig = { params: requestParams };

      const safeParams = { ...config.params } as Record<string, any>;
      if ('apikey' in safeParams) safeParams.apikey = '***';
      const fullUrlSafe = `${this.apiClient.defaults.baseURL}?${Object.keys(safeParams)
        .map(key => `${key}=${safeParams[key]}`)
        .join('&')}`;
      hr('aVB.H', `fetchSimple url [${requestId}] ${fullUrlSafe}`);
      log.debug('fetch.simple.request', { endpointId: this.config.id, requestId, url: fullUrlSafe });
      const response = await this.apiClient.get('', config);

      hr('aVB.H', `fetchSimple ok [${requestId}]`);
      log.info('fetch.simple.success', { endpointId: this.config.id, requestId });
      return response.data;

    } catch (error) {
      hr('aVB.H', `fetchSimple error [${requestId}] ${(error as any)?.message || error}`);
      log.error('fetch.simple.error', { endpointId: this.config.id, requestId, error: String((error as any)?.message || error) });
      throw error;
    }
  }

  public async fetch(params: any = {}): Promise<ApiResponse<T>> {
    const startTime = Date.now();
    const endpoint = this.config.id;

    hr('aVB.H', `fetch start ${endpoint} [${this.requestId}]`);
    log.info('fetch.start', { endpointId: endpoint, requestId: this.requestId, params: this.maskParamsForLog(params) });

    try {
      // 1. Validate parameters
      this.validateParams(params);

      // 2. Prepare and make API request
      log.debug('fetch.request', { endpointId: endpoint, requestId: this.requestId, params: this.maskParamsForLog(params) });
      const requestParams = this.prepareRequestParams(params);
      const config: AxiosRequestConfig = { params: requestParams };

      const safeParams2 = { ...config.params } as Record<string, any>;
      if ('apikey' in safeParams2) safeParams2.apikey = '***';
      const fullUrlSafe2 = `${this.apiClient.defaults.baseURL}?${Object.keys(safeParams2).map(key => `${key}=${safeParams2[key]}`).join('&')}`;
      hr('aVB.H', `url [${this.requestId}] ${fullUrlSafe2}`);
      log.info('fetch.request.url', { endpointId: endpoint, requestId: this.requestId, url: fullUrlSafe2 });

      const response = await this.apiClient.get('', config);
      log.debug('fetch.response.raw_sample', { endpointId: endpoint, requestId: this.requestId, hasData: !!response?.data });

      // 3. Transform the response
      const responseData = response.data;
      let logData = { ...responseData };

      // For logging only - If the response has a time series, take only the first 5 entries
      if (responseData && typeof responseData === 'object') {
        const timeSeriesKey = Object.keys(responseData).find(key =>
          key.toLowerCase().includes('time series') ||
          key.toLowerCase().includes('timeseries')
        );

        if (timeSeriesKey && Array.isArray(responseData[timeSeriesKey])) {
          logData[timeSeriesKey] = responseData[timeSeriesKey].slice(0, 5);
        } else if (timeSeriesKey && typeof responseData[timeSeriesKey] === 'object') {
          const timeSeries = responseData[timeSeriesKey];
          const entries = Object.entries(timeSeries);
          logData[timeSeriesKey] = Object.fromEntries(entries.slice(0, 5));
        }
      }

      log.debug('fetch.transform.input_sample', { endpointId: endpoint, requestId: this.requestId });
      const transformedData = this.transformResponse(responseData);

      // 4. Save to Firestore if we have a symbol
      const symbol = params.symbol;
      if (symbol) {
        if (this.config.ttl === undefined) {
          throw new Error(`No TTL configured for endpoint: ${endpoint}`);
        }

        try {
          // If transformed result is empty, skip save to avoid empty documents
          const isEmptyArray = Array.isArray(transformedData) && transformedData.length === 0;
          const isEmptyObject = !Array.isArray(transformedData) && typeof transformedData === 'object' && transformedData !== null && Object.keys(transformedData).length === 0;
          if (isEmptyArray || isEmptyObject) {
            hr('aVB.H', `skip save (empty) ${endpoint} ${symbol} [${this.requestId}]`);
            log.info('firestore.skip_empty', { endpointId: endpoint, requestId: this.requestId, symbol });
          } else {
            hr('aVB.H', `save ✓ ${endpoint} ${symbol} [${this.requestId}]`);
            log.info('firestore.save', { endpointId: endpoint, requestId: this.requestId, symbol });
            // Ensure we're working with an AlphaVantageEndpoint before saving
            if (Object.values(AlphaVantageEndpoint).includes(endpoint as AlphaVantageEndpoint)) {
              await saveAvData(
                transformedData,
                symbol,
                endpoint as AlphaVantageEndpoint,
                this.config
              );
            } else {
              hr('aVB.H', `skip save (non-AV) ${endpoint} [${this.requestId}]`);
              log.warn('firestore.save.skipped_non_av', { endpointId: endpoint, requestId: this.requestId, symbol });
            }
          }
        } catch (firestoreError) {
          hr('aVB.H', `save error [${this.requestId}] ${String((firestoreError as any)?.message || firestoreError)}`);
          log.error('firestore.save.error', { endpointId: endpoint, requestId: this.requestId, symbol, error: String((firestoreError as any)?.message || firestoreError) });
          // Don't fail the request if Firestore save fails
        }
      }

      hr('aVB.H', `fetch ok [${this.requestId}] ${Date.now() - startTime}ms`);
      log.info('fetch.success', { endpointId: endpoint, requestId: this.requestId, durationMs: Date.now() - startTime });

      // 5. Return the response
      return this.createSuccessResponse(transformedData, this.config.ttl, startTime);

    } catch (error) {
      hr('aVB.H', `fetch error [${this.requestId}] ${String((error as any)?.message || error)}`);
      log.error('fetch.error', { endpointId: endpoint, requestId: this.requestId, durationMs: Date.now() - startTime, error: String((error as any)?.message || error) });
      throw this.handleError(error);
    }
  }

  /**
   * Guard: Returns true and logs if this is a time series endpoint and logic should be skipped.
   */
  protected ensureNotTimeSeries(): boolean {
    if (this.isTimeSeriesBlocked) {
      hr('aVB.H', `timeseries.blocked (${this.config.id})`);
      log.warn('timeseries.blocked', { endpointId: this.config.id });
      return true;
    }
    return false;
  }

  public someTimeSeriesMethod() {
    if (this.ensureNotTimeSeries()) return;
    // ...existing logic...
  }

  protected abstract transformResponse(data: any): T;

  protected createSuccessResponse(
    data: T,
    ttlSeconds: number,
    startTime: number
  ): ApiResponse<T> {
    const ttl = ttlSeconds;

    const response: ApiResponse<T> = {
      data,
      metadata: {
        timestamp: new Date(),
        endpoint: this.config.id,
        ttl,
        processingTimeMs: Date.now() - startTime,
        requestId: this.requestId
      }
    };

    return response;
  }

  protected validateParams(params: Record<string, any>): void {
    log.debug('validate.params', { endpointId: this.config.id, requestId: this.requestId, params });

    for (const [paramName, paramConfig] of Object.entries(this.config.parameters)) {
      const paramValue = params[paramName];

      if (paramConfig.required && paramValue === undefined) {
        if (paramConfig.default !== undefined) {
          params[paramName] = paramConfig.default;
        } else {
          const error = new Error(`Missing required parameter: ${paramName}`);
          log.error('validate.error', { endpointId: this.config.id, requestId: this.requestId, paramName, error: error.message });
          throw error;
        }
      }

      if (paramValue !== undefined && paramConfig.enum && !paramConfig.enum.includes(paramValue)) {
        const error = new Error(`Invalid value for parameter ${paramName}. Must be one of: ${paramConfig.enum.join(', ')}`);
        log.error('validate.error', { endpointId: this.config.id, requestId: this.requestId, paramName, error: error.message });
        throw error;
      }
    }
  }

  protected prepareRequestParams(params: any): any {
    const newParams = { ...params, ...this.baseParams };
    log.debug('prepare.params', { endpointId: this.config.id, requestId: this.requestId, params: this.maskParamsForLog(newParams) });
    return newParams;
  }

  /**
   * Logs a request with context for traceability.
   * @param params - The request parameters
   * @param caller - String describing who is calling this log (e.g. handler or function name)
   */
  protected logRequest(params: any, caller: string = 'unknown'): void {
    const requestId = (this as any).requestId || 'N/A';
    const endpoint = this.config?.id || 'unknown-endpoint';
    log.info('request', { caller, requestId, endpointId: endpoint, params: this.maskParamsForLog(params), timestamp: new Date().toISOString() });
  }

  protected normalizeError(error: any): Error {
    // Optionally implement error normalization here
    return error instanceof Error ? error : new Error(JSON.stringify(error));
  }

  protected handleError(error: any): ApiError {
    log.error('handle.error', {
      requestId: this.requestId,
      message: error?.message,
      code: error?.code,
      status: error?.response?.status,
      data: error?.response?.data ? '[provider-error-present]' : undefined
    });

    let statusCode = 500;
    let errorCode = 'INTERNAL_ERROR';
    let message = 'An unexpected error occurred';
    let details = undefined;

    if (axios.isAxiosError(error)) {
      // Handle Axios errors
      const axiosError = error as any;
      statusCode = axiosError.response?.status || 500;
      errorCode = axiosError.code || 'API_REQUEST_FAILED';
      message = axiosError.message || 'API request failed';

      if (axiosError.response?.data) {
        details = axiosError.response.data;
        if (details['Information'] && typeof details['Information'] === 'string' && details['Information'].includes('rate limit')) {
          message = 'Oh No!!! dude you exceeded your AV request limit! Doh!!';
          details['Information'] = message;
          hr('aVB.H', `rate limit [${this.requestId}]`);
          log.warn('provider.rate_limit', { requestId: this.requestId });
        } else {
          message = details['Error Message'] || details['Note'] || message;
        }
      }
    } else if (error instanceof Error) {
      // Handle standard errors
      message = error.message;
      errorCode = 'HANDLER_ERROR';
    }

    const apiError: ApiError = {
      name: 'AlphaVantageError',
      message: message,
      code: errorCode,
      status: statusCode,
      details: details
    };

    return apiError;
  }
}
