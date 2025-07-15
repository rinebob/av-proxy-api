import axios, { AxiosInstance, AxiosError } from 'axios';

import { ApiResponse, ApiError } from '../../common/types';
import { BenzingaRequestConfig, BENZINGA_API_BASE_URL } from '../../../common/common-benz';

export abstract class BenzingaBaseHandler<T = any> {
  protected readonly config: BenzingaRequestConfig;
  protected readonly apiClient: AxiosInstance;
  protected readonly apiKey: string;
  protected readonly requestId: string;

  /**
   * Validates the request parameters
   * @param params The request parameters to validate
   * @throws {Error} If validation fails
   */
  protected abstract validateParams(params: Record<string, any>): void;

  /**
   * Prepares the final request parameters
   * @param params The request parameters to prepare
   * @returns The prepared parameters
   */
  protected abstract prepareRequestParams(params: Record<string, any>): Record<string, any>;

  /**
   * Transforms the API response data
   * @param data The raw API response data
   * @returns The transformed response
   */
  protected abstract transformResponse(data: any): T;

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
        name: 'BenzingaError',
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

  /**
   * Handles errors with proper logging
   * @param error The error to handle
   * @returns A normalized ApiError object
   */
  protected handleError(error: unknown): ApiError {
    const apiError = this.normalizeError(error);
    console.error(`bB.H fetch [${this.requestId}] Error processing request:`, apiError);
    return apiError;
  }

  /**
   * Processes the request with validation and parameter preparation
   * @param params The request parameters
   * @returns A promise that resolves with the processed data
   */
  protected abstract processRequest(params: Record<string, any>): Promise<T>;

  /**
   * Base implementation of processRequest that handles common request processing logic
   * @param params The request parameters
   * @returns A promise that resolves with the processed data
   */
  protected async processRequestBase(params: Record<string, any>): Promise<T> {
    // Validate parameters
    this.validateParams(params);

    // Prepare request parameters
    const finalParams = this.prepareRequestParams(params);

    // Make API request
    const startTime = Date.now();
    const response = await this.apiClient.request({
      method: this.config.method || 'GET',
      url: this.config.apiEndpoint || '',
      params: finalParams
    });

    const duration = Date.now() - startTime;
    
    // Transform and return response
    const result: ApiResponse<T> = {
      data: this.transformResponse(response.data),
      metadata: {
        timestamp: new Date(),
        endpoint: this.config.id,
        symbol: params.symbol,
        ttl: this.config.ttl,
        requestId: this.requestId,
        processingTimeMs: duration
      }
    };

    console.log(`bB.H processRequestBase [${this.requestId}] Request completed successfully in ${duration}ms`);
    return result.data;
  }

  constructor(config: BenzingaRequestConfig) {
    this.config = config;
    this.requestId = Math.random().toString(36).substring(2, 10);

    // Always use the endpoint's configured env var for the API key
    const envVar = config.apiKeyEnv;
    this.apiKey = process.env[envVar] || '';

    if (!this.apiKey) {
      throw new Error(`Benzinga API key (${envVar}) is not configured`);
    }

    this.apiClient = axios.create({
      baseURL: BENZINGA_API_BASE_URL,
      headers: {
        'Accept': 'application/json'
      },
      timeout: 15000, // 15 seconds
      paramsSerializer: (params) => {
        const searchParams = new URLSearchParams();
        for (const key of Object.keys(params)) {
          const value = params[key];
          if (value === undefined || value === null) {
            continue; // Skip undefined or null values
          }

          // Add API key as token parameter
          if (key === 'token') {
            searchParams.append('token', value);
            continue;
          }

          if (key === 'parameters' && typeof value === 'object') {
            for (const nestedKey of Object.keys(value)) {
              const nestedValue = value[nestedKey];
              if (nestedValue !== undefined && nestedValue !== null) {
                searchParams.append(`parameters[${nestedKey}]`, nestedValue);
              }
            }
          } else if (typeof value === 'object' && !Array.isArray(value)) {
            // Handle other top-level objects by flattening them
            for (const nestedKey of Object.keys(value)) {
              const nestedValue = value[nestedKey];
              if (nestedValue !== undefined && nestedValue !== null) {
                searchParams.append(nestedKey, nestedValue);
              }
            }
          } else {
            searchParams.append(key, value);
          }
        }
        console.log('bBH ctor searchParams: ', searchParams);
        return searchParams.toString();
      }
    });

    // Add request interceptor for logging
    this.apiClient.interceptors.request.use(
      (config) => {
        // Remove any existing token parameter from URLSearchParams if present
        if (config.url) {
          const urlParts = config.url.split('?');
          if (urlParts.length > 1) {
            const searchParams = new URLSearchParams(urlParts[1]);
            searchParams.delete('token');
            config.url = `${urlParts[0]}?${searchParams.toString()}`;
          }
        }
        
        // Remove any existing token parameter from config.params
        if (config.params && typeof config.params === 'object') {
          delete config.params.token;
        }
        
        // Add our token parameter
        config.params = {
          ...config.params,
          token: this.apiKey
        };
        
        console.log(`bB.H ctor [${this.requestId}] Sending request to: ${config.url}`, {
          method: config.method?.toUpperCase(),
          params: config.params,
          headers: config.headers
        });
        return config;
      },
      (error: AxiosError) => {
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
    try {
      const startTime = Date.now();
      const data = await this.processRequest(params);
      const processingTimeMs = Date.now() - startTime;
      return {
        data,
        metadata: {
          timestamp: new Date(),
          endpoint: this.config.id,
          symbol: params.symbol,
          ttl: this.config.ttl,
          requestId: this.requestId,
          processingTimeMs: processingTimeMs
        }
      };
    } catch (error) {
      throw this.handleError(error);
    }
  }
}
