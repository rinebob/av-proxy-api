import axios, { AxiosInstance, AxiosRequestConfig } from 'axios';
import { EndpointConfig, ApiResponse, ApiError } from '../../common/types';
import { saveAvData } from '../av-firestore-helper';
import { API_CONSTANTS } from '../../../common/api-constants';
import { AlphaVantageEndpoint } from '../../../common/common-av';

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
  
  constructor(config: EndpointConfig) {
    console.log('==============================');
    console.log(' --- AlphaVantageBaseHandler ---');
    
    this.config = config;
    this.requestId = Math.random().toString(36).substring(2, 10);
    
    this.baseParams = {
      apikey: getAlphaVantageApiKey(),
      function: this.config.id,
      datatype: API_CONSTANTS.ALPHA_VANTAGE.RESPONSE_TYPE
    };
    
    this.apiClient = axios.create({
      baseURL: API_CONSTANTS.ALPHA_VANTAGE.BASE_URL,
      timeout: API_CONSTANTS.ALPHA_VANTAGE.DEFAULT_TIMEOUT_MS
    });
   
    console.log('aVB.H ctor request params:', this.baseParams);
    console.log('aVB.H ctor base URL:', this.apiClient.defaults.baseURL);
  }

  public async fetch(params: any = {}): Promise<ApiResponse<T>> {
    
    console.log('----------------------------------------');
    console.log(' --- START AlphaVantageBaseHandler.fetch ---');
    const startTime = Date.now();
    const endpoint = this.config.id;
    
    console.log(`aVB.H fetch [${this.requestId}] Starting fetch for ${endpoint}`, { params });
    
    try {
      // 1. Validate parameters
      console.log(`aVB.H fetch [${this.requestId}] Validating parameters`);
      this.validateParams(params);
      
      // 2. Prepare and make API request
      console.log(`aVB.H fetch [${this.requestId}] Fetching from API. params: ${JSON.stringify(params)}`);
      const requestParams = this.prepareRequestParams(params);
      const config: AxiosRequestConfig = { params: requestParams };
      
      const fullUrl = `${this.apiClient.defaults.baseURL}?${Object.keys(config.params).map(key => `${key}=${config.params[key]}`).join('&')}`;
      console.log(`aVB.H fetch [${this.requestId}] Fetching from API. URL: ${fullUrl}`);

      const response = await this.apiClient.get('', config);
      console.log(`aVB.H fetch [${this.requestId}] Raw API response`, { data: response.data });

      // 3. Transform the response
      const responseData = response.data;
      let logData = { ...responseData };
      
      // If the response has a time series, take only the first 5 entries
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
      
      console.log(`aVB.H fetch [${this.requestId}] Transforming response data. response: ${
        JSON.stringify(logData, null, 2)
      }`);
      const transformedData = this.transformResponse(responseData);
      
      // 4. Save to Firestore if we have a symbol
      const symbol = params.symbol;
      if (symbol) {
        if (this.config.ttl === undefined) {
          throw new Error(`No TTL configured for endpoint: ${endpoint}`);
        }
        
        try {
          console.log(`aVB.H fetch [${this.requestId}] Saving data to Firestore. transformedData: ${
            JSON.stringify(Array.isArray(transformedData) 
              ? [...transformedData].slice(0, 5) 
              : transformedData, 
            null, 2)
          }`);
          // Ensure we're working with an AlphaVantageEndpoint before saving
          if (Object.values(AlphaVantageEndpoint).includes(endpoint as AlphaVantageEndpoint)) {
            await saveAvData(
              transformedData,
              symbol,
              endpoint as AlphaVantageEndpoint,
              {
                firestorePath: this.config.firestorePath,
                ttlSeconds: this.config.ttl
              }
            );
          } else {
            console.warn(`aVB.H fetch [${this.requestId}] Skipping Firestore save for non-AlphaVantage endpoint:`, endpoint);
          }
        } catch (firestoreError) {
          console.error(`aVB.H fetch [${this.requestId}] Failed to save to Firestore:`, firestoreError);
          // Don't fail the request if Firestore save fails
        }
      }

      console.log(' --- END AlphaVantageBaseHandler.fetch ---');
      console.log('----------------------------------------');
      
      // 5. Return the response
      return this.createSuccessResponse(transformedData, this.config.ttl, startTime);
      
    } catch (error) {
      console.error(`aVB.H fetch [${this.requestId}] Error in fetch:`, {
        error: error instanceof Error ? error.message : 'Unknown error',
        stack: error instanceof Error ? error.stack : undefined,
        processingTimeMs: Date.now() - startTime
      });
      throw this.handleError(error);
    }
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
    console.log(`aVB.H validateParams [${this.requestId}] Validating parameters:`, params);
    
    for (const [paramName, paramConfig] of Object.entries(this.config.parameters)) {
      const paramValue = params[paramName];
      
      if (paramConfig.required && paramValue === undefined) {
        if (paramConfig.default !== undefined) {
          params[paramName] = paramConfig.default;
        } else {
          const error = new Error(`Missing required parameter: ${paramName}`);
          console.error(`aVB.H validateParams [${this.requestId}] Validation error:`, error.message);
          throw error;
        }
      }
      
      if (paramValue !== undefined && paramConfig.enum && !paramConfig.enum.includes(paramValue)) {
        const error = new Error(`Invalid value for parameter ${paramName}. Must be one of: ${paramConfig.enum.join(', ')}`);
        console.error(`aVB.H validateParams [${this.requestId}] Validation error:`, error.message);
        throw error;
      }
    }
  }

  protected prepareRequestParams(params: any): any {
    const newParams = { ...params, ...this.baseParams };
    console.log(`aVB.H pRP [${this.requestId}] Prepared request params`, { newParams });
    return newParams;
  }

  protected handleError(error: any): ApiError {
    console.error(`aVB.H handleError [${this.requestId}] Handling error:`, {
      message: error.message,
      code: error.code,
      status: error.response?.status,
      data: error.response?.data
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
          console.error(`aVB.H handleError [${this.requestId}] Alpha Vantage daily rate limit exceeded:`, message);
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
