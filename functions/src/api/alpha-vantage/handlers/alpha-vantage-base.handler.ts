import axios from 'axios';
import type { AxiosInstance, AxiosRequestConfig } from 'axios';
import { EndpointConfig, ApiResponse, ApiError } from '../../common/types';

export abstract class AlphaVantageBaseHandler<T = any> {
  protected readonly config: EndpointConfig;
  protected readonly apiClient: AxiosInstance;
  
  constructor(config: EndpointConfig) {
    this.config = config;
    
    this.apiClient = axios.create({
      baseURL: 'https://www.alphavantage.co/query',
      params: {
        apikey: process.env.ALPHAVANTAGE_API_KEY,
        function: this.config.id,
        datatype: 'json' // Ensure JSON response
      },
      timeout: 15000 // 15 seconds
    });
  }

  public async fetch(params: Record<string, any> = {}): Promise<ApiResponse<T>> {
    try {
      this.validateParams(params);
      const requestParams = this.prepareRequestParams(params);
      
      const config: AxiosRequestConfig = {
        params: requestParams
      };

      const response = await this.apiClient.get('', config);
      
      return {
        data: this.transformResponse(response.data),
        metadata: {
          timestamp: new Date(),
          endpoint: this.config.id,
          symbol: params.symbol,
          ttl: this.config.ttl
        }
      };
    } catch (error) {
      throw this.handleError(error);
    }
  }

  protected abstract transformResponse(data: any): T;

  protected validateParams(params: Record<string, any>): void {
    for (const [paramName, paramConfig] of Object.entries(this.config.parameters)) {
      const paramValue = params[paramName];
      
      if (paramConfig.required && paramValue === undefined) {
        if (paramConfig.default !== undefined) {
          params[paramName] = paramConfig.default;
        } else {
          throw new Error(`Missing required parameter: ${paramName}`);
        }
      }
      
      if (paramValue !== undefined && paramConfig.enum && !paramConfig.enum.includes(paramValue)) {
        throw new Error(`Invalid value for parameter ${paramName}. Must be one of: ${paramConfig.enum.join(', ')}`);
      }
    }
  }

  protected prepareRequestParams(params: Record<string, any>): Record<string, any> {
    // Filter out undefined parameters
    return Object.fromEntries(
      Object.entries(params).filter(([_, value]) => value !== undefined)
    );
  }

  protected isAxiosError(error: unknown): error is { isAxiosError: boolean; response?: any; message: string } {
    return typeof error === 'object' && error !== null && 'isAxiosError' in error;
  }

  protected handleError(error: unknown): ApiError {
    if (this.isAxiosError(error)) {
      const status = error.response?.status || 500;
      const message = error.response?.data?.['Error Message'] || error.message;
      
      return {
        name: 'AlphaVantageApiError',
        message: `API request failed: ${message}`,
        code: `AV_${status}`,
        status,
        details: error.response?.data
      } as const;
    }
    
    const errorObj = error as Error;
    if (errorObj?.message) {
      return {
        name: 'AlphaVantageError',
        message: errorObj.message,
        code: 'AV_UNKNOWN',
        status: 500
      };
    }
    
    return {
      name: 'AlphaVantageError',
      message: 'Unknown error occurred',
      code: 'AV_UNKNOWN',
      status: 500
    };
  }
}
