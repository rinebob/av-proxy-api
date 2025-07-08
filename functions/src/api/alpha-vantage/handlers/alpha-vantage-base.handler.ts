import axios, { AxiosInstance, AxiosRequestConfig, AxiosError } from 'axios';
import { EndpointConfig, ApiResponse, ApiError } from '../../common/types';

export abstract class AlphaVantageBaseHandler<T = any> {
  protected readonly config: EndpointConfig;
  protected readonly apiClient: AxiosInstance;
  protected readonly requestId: string;
  
  constructor(config: EndpointConfig) {
    this.config = config;
    this.requestId = Math.random().toString(36).substring(2, 10);
    
    this.apiClient = axios.create({
      baseURL: 'https://www.alphavantage.co/query',
      params: {
        apikey: process.env.ALPHAVANTAGE_API_KEY,
        function: this.config.id,
        datatype: 'json' // Ensure JSON response
      },
      timeout: 15000 // 15 seconds
    });

    // Add request interceptor for logging
    this.apiClient.interceptors.request.use(
      (config) => {
        console.log(`aVB.H ctor [${this.requestId}] [HANDLER] Sending request to Alpha Vantage:`, {
          url: config.url,
          params: config.params,
          method: config.method
        });
        return config;
      },
      (error) => {
        console.error(`aVB.H ctor [${this.requestId}] [HANDLER] Request error:`, error.message);
        return Promise.reject(error);
      }
    );

    // Add response interceptor for logging
    this.apiClient.interceptors.response.use(
      (response) => {
        console.log(`aVB.H ctor [${this.requestId}] [HANDLER] Received response from Alpha Vantage:`, {
          status: response.status,
          statusText: response.statusText,
          data: response.data ? '[...data]' : 'No data'
        });
        return response;
      },
      (error: AxiosError) => {
        console.error(`aVB.H ctor [${this.requestId}] [HANDLER] Response error:`, {
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

  public async fetch(params: Record<string, any> = {}): Promise<ApiResponse<T>> {
    const startTime = Date.now();
    console.log(`aVB.H fetch [${this.requestId}] [HANDLER] Starting fetch for ${this.config.id}`, { params });
    
    try {
      console.log(`aVB.H fetch [${this.requestId}] [HANDLER] Validating parameters`);
      this.validateParams(params);
      
      console.log(`aVB.H fetch [${this.requestId}] [HANDLER] Preparing request parameters`);
      const requestParams = this.prepareRequestParams(params);
      
      const config: AxiosRequestConfig = {
        params: requestParams
      };

      console.log(`aVB.H fetch [${this.requestId}] [HANDLER] Sending API request`);
      const response = await this.apiClient.get('', config);
      
      console.log(`aVB.H fetch [${this.requestId}] [HANDLER] Transforming response data`);
      const transformedData = this.transformResponse(response.data);
      
      const result: ApiResponse<T> = {
        data: transformedData,
        metadata: {
          timestamp: new Date(),
          endpoint: this.config.id,
          symbol: params.symbol,
          ttl: this.config.ttl,
          requestId: this.requestId,
          processingTimeMs: Date.now() - startTime
        }
      };

      console.log(`aVB.H fetch [${this.requestId}] [HANDLER] Request completed successfully in ${Date.now() - startTime}ms`);
      return result;
      
    } catch (error) {
      console.error(`aVB.H fetch [${this.requestId}] [HANDLER] Error in fetch:`, {
        error: error instanceof Error ? error.message : 'Unknown error',
        stack: error instanceof Error ? error.stack : undefined,
        processingTimeMs: Date.now() - startTime
      });
      throw this.handleError(error);
    }
  }

  protected abstract transformResponse(data: any): T;

  protected validateParams(params: Record<string, any>): void {
    console.log(`aVB.H validateParams [${this.requestId}] [HANDLER] Validating parameters:`, params);
    
    for (const [paramName, paramConfig] of Object.entries(this.config.parameters)) {
      const paramValue = params[paramName];
      
      if (paramConfig.required && paramValue === undefined) {
        if (paramConfig.default !== undefined) {
          params[paramName] = paramConfig.default;
        } else {
          const error = new Error(`Missing required parameter: ${paramName}`);
          console.error(`aVB.H validateParams [${this.requestId}] [HANDLER] Validation error:`, error.message);
          throw error;
        }
      }
      
      if (paramValue !== undefined && paramConfig.enum && !paramConfig.enum.includes(paramValue)) {
        const error = new Error(`Invalid value for parameter ${paramName}. Must be one of: ${paramConfig.enum.join(', ')}`);
        console.error(`aVB.H validateParams [${this.requestId}] [HANDLER] Validation error:`, error.message);
        throw error;
      }
    }
  }

  protected prepareRequestParams(params: Record<string, any>): Record<string, any> {
    console.log(`aVB.H prepareRequestParams [${this.requestId}] [HANDLER] Preparing request params`);
    // Filter out undefined parameters
    return Object.fromEntries(
      Object.entries(params).filter(([_, value]) => value !== undefined)
    );
  }

  protected handleError(error: any): ApiError {
    console.error(`aVB.H handleError [${this.requestId}] [HANDLER] Handling error:`, {
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
        message = details['Error Message'] || details['Note'] || message;
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
