import axios, { AxiosInstance } from 'axios';

import {
  AlphaVantageEndpoint,
  AvHistoricalOptionsResponse,
  SvtOptionsAnalysis,
} from '@shared/alpha-vantage';
import { API_CONSTANTS, ApiProvider, DATA_PROVIDERS } from '@shared/core';

import {
  analyzeOptions,
  normalizeAvOptionContract,
  toAlphaVantageUpstreamError,
  validateAlphaVantageApiResponse,
} from '../../alpha-vantage/utils';
import { getAlphaVantageApiKey } from '../../utils/utils';
import type { AvThrottle } from './av-throttle.service';

export interface HistoricalOptionsRetrievalResult {
  response: AvHistoricalOptionsResponse;
  analysis: SvtOptionsAnalysis;
}

export interface HistoricalOptionsRetrievalDependencies {
  axiosInstance: AxiosInstance;
  throttle: AvThrottle;
  apiKey: string;
  baseUrl: string;
}

/**
 * Pure retrieval seam for Alpha Vantage HISTORICAL_OPTIONS.
 *
 * This service owns provider request construction, response validation,
 * normalization, typed provider error conversion, and analysis. It performs
 * no Firestore or GCS I/O.
 */
export class HistoricalOptionsRetrievalService {
  constructor(private readonly deps: HistoricalOptionsRetrievalDependencies) {}

  /**
   * Fetches the historical options chain for a symbol and optional date.
   *
   * @throws {AlphaVantageUpstreamError} For rate limits, timeouts, and provider failures.
   */
  async fetch(params: {
    symbol: string;
    date?: string;
  }): Promise<HistoricalOptionsRetrievalResult> {
    const symbol = params.symbol?.trim().toUpperCase();
    if (!symbol) {
      throw new Error('Symbol is required');
    }

    await this.deps.throttle.wait();

    const requestParams = this.buildRequestParams(symbol, params.date);

    try {
      const response = await this.deps.axiosInstance.get('', {
        params: requestParams,
        timeout: DATA_PROVIDERS[ApiProvider.ALPHA_VANTAGE].defaultTimeoutMs,
      });

      validateAlphaVantageApiResponse(response.data);
      const transformedData = this.transformResponse(response.data);
      const analysis = analyzeOptions(transformedData.data);

      return { response: transformedData, analysis };
    } catch (error) {
      throw toAlphaVantageUpstreamError(error);
    }
  }

  private buildRequestParams(symbol: string, date?: string): Record<string, string> {
    const params: Record<string, string> = {
      function: 'HISTORICAL_OPTIONS',
      symbol,
      datatype: API_CONSTANTS.ALPHA_VANTAGE.RESPONSE_TYPE,
      apikey: this.deps.apiKey,
    };
    if (date) {
      params.date = date;
    }
    return params;
  }

  private transformResponse(data: unknown): AvHistoricalOptionsResponse {
    const response = data as Record<string, unknown>;

    if (!response || !Array.isArray(response.data)) {
      throw new Error('Invalid API response: missing or invalid data array');
    }

    return {
      endpoint:
        typeof response.endpoint === 'string' && response.endpoint.trim()
          ? response.endpoint
          : AlphaVantageEndpoint.HISTORICAL_OPTIONS,
      message:
        typeof response.message === 'string' && response.message.trim()
          ? response.message
          : 'success',
      data: (response.data as unknown[]).map((contract) => normalizeAvOptionContract(contract)),
    };
  }
}

/**
 * Factory for the retrieval service using runtime configuration.
 */
export function createHistoricalOptionsRetrievalService(): HistoricalOptionsRetrievalService {
  const provider = DATA_PROVIDERS[ApiProvider.ALPHA_VANTAGE];
  return new HistoricalOptionsRetrievalService({
    axiosInstance: axios.create({
      baseURL: provider.baseUrl,
      timeout: provider.defaultTimeoutMs,
    }),
    throttle: createNoOpThrottle(), // shared throttle lives in the worker/task queue
    apiKey: getAlphaVantageApiKey(),
    baseUrl: provider.baseUrl,
  });
}

function createNoOpThrottle(): AvThrottle {
  return {
    async wait(): Promise<void> {
      // no-op; callers inject a real throttle when needed
    },
  };
}
