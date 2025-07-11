import axios, { AxiosInstance, AxiosRequestConfig, AxiosError } from 'axios';
import { EndpointConfig, ApiResponse, ApiError } from '../../common/types';

export abstract class BenzingaBaseHandler<T = any> {
  protected readonly config: EndpointConfig;
  protected readonly apiClient: AxiosInstance;
  protected readonly apiKey: string;
  protected readonly requestId: string;

  constructor(config: EndpointConfig) {
    this.config = config;
    this.requestId = Math.random().toString(36).substring(2, 10);
    
    // Verify API key is present
    if (process.env.FUNCTIONS_EMULATOR === 'true') {
      this.apiKey = process.env.LOCAL_EMULATOR_BENZINGA_CALENDAR_API_KEY || '';
    } else {
      this.apiKey = process.env.BENZINGA_CALENDAR_API_KEY || '';
    }
    if (!this.apiKey) {
      throw new Error('Benzinga API key is not configured');
    }

    this.apiClient = axios.create({
      baseURL: 'https://api.benzinga.com/api/v2.1',
      headers: {
        'Accept': 'application/json'
      },
      timeout: 15000, // 15 seconds
      paramsSerializer: (params) => {
        const searchParams = new URLSearchParams();
        for (const key of Object.keys(params)) {
          if (key === 'parameters') {
            for (const nestedKey of Object.keys(params[key])) {
              searchParams.append(`parameters[${nestedKey}]`, params[key][nestedKey]);
            }
          } else {
            searchParams.append(key, params[key]);
          }
        }
        console.log('bBH ctor searchParams: ', searchParams);
        return searchParams.toString();
      }
    });

    // Add request interceptor for logging
    this.apiClient.interceptors.request.use(
      (config) => {
        console.log(`bB.H ctor [${this.requestId}] Sending request to: ${config.url}`, {
          method: config.method?.toUpperCase(),
          params: config.params,
          headers: config.headers
        });
        return config;
      },
      (error) => {
        console.error(`bB.H ctor [${this.requestId}] [HANDLER] Request error:`, error.message);
        return Promise.reject(error);
      }
    );

    // Add response interceptor for logging
    this.apiClient.interceptors.response.use(
      (response) => {
        console.log(`bB.H ctor [${this.requestId}] Received response from Benzinga:`, {
          status: response.status,
          statusText: response.statusText,
          data: response.data ? '[...data]' : 'No data'
        });
        return response;
      },
      (error: AxiosError) => {
        console.error(`bB.H ctor [${this.requestId}] Response error:`, {
          message: error.message,
          code: error.code,
          status: error.response?.status,
          statusText: error.response?.statusText,
          data: error.response?.data
        });
        return Promise.reject(error);
      }
    );
  }

  /**
   * Handles an incoming API request
   * @param params The request parameters
   * @param requestId The unique request ID for logging
   * @returns A promise that resolves with the API response
   */
  public async handleRequest(params: Record<string, any>, requestId: string): Promise<T> {
    try {
      // Validate the request parameters
      this.validateParams(params);
      
      // Process the request
      return await this.processRequest(params);
    } catch (error) {
      console.error(`bB.H handleRequest [${requestId}] Error processing request:`, error);
      throw this.normalizeError(error);
    }
  }

  async fetch(params: Record<string, any> = {}): Promise<ApiResponse<T>> {
    const startTime = Date.now();
    
    try {
      console.log(`bB.H fetch [${this.requestId}] Starting fetch for endpoint: ${this.config.id}`, {
        params
      });
      
      this.validateParams(params);
      const preparedParams = this.prepareRequestParams(params);

      // Separate top-level params from nested params as per Benzinga API spec.
      const topLevelParams: Record<string, any> = {};
      // Initialize nestedParams with any 'parameters' object already in the query.
      const nestedParams: Record<string, any> = preparedParams.parameters || {};

      for (const key in preparedParams) {
        if (key === 'page' || key === 'pagesize') {
          topLevelParams[key] = preparedParams[key];
        } else if (key !== 'type' && key !== 'parameters') {
          // Add other params to nestedParams, avoiding duplication.
          nestedParams[key] = preparedParams[key];
        }
      }

      const finalParams = { ...topLevelParams, token: this.apiKey, parameters: nestedParams };
      
      const config: AxiosRequestConfig = {
        method: this.config.method || 'GET',
        url: this.config.apiEndpoint || '',
        params: finalParams
      };

      console.log(`bB.H fetch [${this.requestId}] Sending request to Benzinga API`, {
        method: config.method,
        url: config.url,
        params: config.params
      });

      const response = await this.apiClient.request(config);
      
      const result: ApiResponse<T> = {
        data: this.transformResponse(response.data),
        metadata: {
          timestamp: new Date(),
          endpoint: this.config.id,
          symbol: params.symbol,
          ttl: this.config.ttl,
          requestId: this.requestId,
          processingTimeMs: Date.now() - startTime
        }
      };

      console.log(`bB.H fetch [${this.requestId}] Request completed successfully in ${Date.now() - startTime}ms`);
      return result;
      
    } catch (error) {
      console.error(`bB.H fetch [${this.requestId}] Error in fetch:`, {
        error: error instanceof Error ? error.message : 'Unknown error',
        stack: error instanceof Error ? error.stack : undefined,
        endpoint: this.config.id,
        params
      });
      throw this.normalizeError(error);
    }
  }

  protected abstract transformResponse(data: any): T;
  protected abstract validateParams(params: Record<string, any>): void;
  protected abstract prepareRequestParams(params: Record<string, any>): Record<string, any>;

  /**
   * Validates the request parameters
   * @param params The request parameters to validate
   * @throws {Error} If validation fails
   */
  protected abstract processRequest(params: Record<string, any>): Promise<T>;

  /**
   * Normalizes errors into a consistent format
   * @param error The error to normalize
   * @returns A normalized ApiError object
   */
  protected normalizeError(error: unknown): ApiError {
    if (axios.isAxiosError(error)) {
      const status = error.response?.status || 500;
      const message = error.response?.data?.message || error.message;
      
      return {
        name: 'BenzingaApiError',
        message: `API Error: ${message}`,
        code: error.code || 'BENZINGA_API_ERROR',
        status,
        details: error.response?.data
      };
    }

    if (error instanceof Error) {
      return {
        name: error.name,
        message: error.message,
        code: 'INTERNAL_ERROR',
        status: 500,
        stack: error.stack
      };
    }

    return {
      name: 'UnknownError',
      message: 'An unknown error occurred',
      code: 'UNKNOWN_ERROR',
      status: 500
    };
  }

  protected handleError(error: unknown): ApiError {
    console.error(`[${this.requestId}] Handling error:`, {
      error: error instanceof Error ? error.message : 'Unknown error',
      stack: error instanceof Error ? error.stack : undefined
    });

    if (axios.isAxiosError(error)) {
      const errorObj = new Error(error.message) as ApiError;
      errorObj.name = 'BenzingaApiError';
      errorObj.code = error.code || 'BENZINGA_API_ERROR';
      errorObj.status = error.response?.status || 500;
      errorObj.details = error.response?.data;
      return errorObj;
    }

    const errorObj = new Error(
      error instanceof Error ? error.message : 'An unknown error occurred'
    ) as ApiError;
    errorObj.name = 'BenzingaError';
    errorObj.code = 'INTERNAL_ERROR';
    errorObj.status = 500;
    return errorObj;
  }
}
