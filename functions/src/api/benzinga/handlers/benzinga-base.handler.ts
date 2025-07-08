import axios, { AxiosInstance, AxiosRequestConfig, AxiosError } from 'axios';
import { EndpointConfig, ApiResponse, ApiError } from '../../common/types';

export abstract class BenzingaBaseHandler<T = any> {
  protected readonly config: EndpointConfig;
  protected readonly apiClient: AxiosInstance;
  protected readonly requestId: string;

  constructor(config: EndpointConfig) {
    this.config = config;
    this.requestId = Math.random().toString(36).substring(2, 10);
    
    // Verify API key is present
    const apiKey = process.env.BENZINGA_API_KEY;
    if (!apiKey) {
      throw new Error('Benzinga API key is not configured');
    }
    
    this.apiClient = axios.create({
      baseURL: 'https://api.benzinga.com/api/v2',
      headers: {
        'Accept': 'application/json',
        'X-BZ-API-KEY': apiKey
      },
      timeout: 15000 // 15 seconds
    });

    // Add request interceptor for logging
    this.apiClient.interceptors.request.use(
      (config) => {
        console.log(`bB.H ctor [${this.requestId}] [HANDLER] Sending request to Benzinga:`, {
          url: config.url,
          params: config.params,
          method: config.method
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
        console.log(`bB.H ctor [${this.requestId}] [HANDLER] Received response from Benzinga:`, {
          status: response.status,
          statusText: response.statusText,
          data: response.data ? '[...data]' : 'No data'
        });
        return response;
      },
      (error: AxiosError) => {
        console.error(`bB.H ctor [${this.requestId}] [HANDLER] Response error:`, {
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

  async fetch(params: Record<string, any> = {}): Promise<ApiResponse<T>> {
    const startTime = Date.now();
    
    try {
      console.log(`bB.H fetch [${this.requestId}] [HANDLER] Starting fetch for endpoint: ${this.config.id}`, {
        params
      });
      
      this.validateParams(params);
      const requestParams = this.prepareRequestParams(params);
      
      const config: AxiosRequestConfig = {
        method: this.config.method || 'GET',
        url: this.config.path || '',
        params: requestParams
      };

      console.log(`bB.H fetch [${this.requestId}] [HANDLER] Sending request to Benzinga API`, {
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

      console.log(`bB.H fetch [${this.requestId}] [HANDLER] Request completed successfully in ${Date.now() - startTime}ms`);
      return result;
      
    } catch (error) {
      console.error(`bB.H fetch [${this.requestId}] [HANDLER] Error in fetch:`, {
        error: error instanceof Error ? error.message : 'Unknown error',
        stack: error instanceof Error ? error.stack : undefined,
        endpoint: this.config.id,
        params
      });
      throw this.handleError(error);
    }
  }

  protected abstract transformResponse(data: any): T;
  protected abstract validateParams(params: Record<string, any>): void;
  protected abstract prepareRequestParams(params: Record<string, any>): Record<string, any>;
  
  protected handleError(error: unknown): ApiError {
    console.error(`bB.H handleError [${this.requestId}] [HANDLER] Handling error:`, {
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
