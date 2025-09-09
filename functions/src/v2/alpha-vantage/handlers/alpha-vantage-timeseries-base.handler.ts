import { AlphaVantageBaseHandler } from './alpha-vantage-base.handler';
import { saveAvTimeSeriesData } from '../firestore/av-firestore-helper';
import { ApiResponse } from '@shared/core';
import { AlphaVantageEndpoint, TimeSeriesEndpointConfig, TimeSeriesInterval } from '@shared/alpha-vantage';

/**
 * Compact bar shape persisted to Firestore for time-series.
 */
export interface StorageBar {
  date: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  // Optional fields preserved when available (adjusted endpoints / global quote)
  adjustedClose?: number;
  dividendAmount?: number;
  splitCoefficient?: number;
  previousClose?: number;
  change?: number;
  // Numeric percent, e.g., 1.23 for 1.23%
  changePercent?: number;
  // Optional intraday snapshot fields (captured pre-close for REL-STR use cases)
  intradayPrice?: number;        // intraday mark price
  intradayObservedAt?: number;   // epoch ms when the intraday price was observed
  intradayTime?: string;         // human-readable HH:mm (derived from intradayObservedAt)
}

/**
 * Abstract base handler for Alpha Vantage time series endpoints.
 * Handles parameter validation, request preparation, fetch orchestration,
 * Firestore write (normalized schema), and error handling for time series endpoints.
 */
export abstract class AlphaVantageTimeSeriesHandlerBase<T = any> extends AlphaVantageBaseHandler<T> {
  protected readonly config: TimeSeriesEndpointConfig;

  constructor(config: TimeSeriesEndpointConfig) {
    super(config);
    this.config = config;
  }

  protected validateParams(params: Record<string, any>): void {
    if (!params.symbol) {
      throw new Error('Missing required parameter: symbol');
    }
  }

  protected prepareRequestParams(params: any): any {
    return { ...params, ...this.baseParams };
  }

  /**
   * Subclasses must provide the storage bars extracted from the transformed payload.
   * Return null/empty array if there are no bars to persist for this endpoint.
   */
  protected abstract getBarsForStorage(transformed: T): StorageBar[] | null;

  /**
   * Transform raw provider payload into the type returned to clients.
   */
  protected abstract transformResponse(data: any): T;

  /**
   * Fetches time series data, transforms, optionally saves bars to Firestore, and returns ApiResponse.
   * Respects manual Firestore write toggle when params.__checkWriteToggle !== false (default true).
   */
  public async fetch(params: any = {}): Promise<ApiResponse<T>> {
    super.logRequest(params, 'AVTimeSeriesHandlerBase.fetch');
    const startTime = Date.now();
    const endpoint = this.config.id;
    this.validateParams(params);

    // Strip internal params before sending to AV
    const { __checkWriteToggle, ...publicParams } = params || {};
    const requestParams = this.prepareRequestParams(publicParams);

    try {
      const response = await this.apiClient.get('', { params: requestParams });
      const responseData = response.data;
      const transformedData = this.transformResponse(responseData);

      // Persist bars if provided by subclass
      const symbol: string | undefined = params.symbol;
      const bars = this.getBarsForStorage(transformedData);

      // Default: check write toggle (UI/gateway). Backend callers should pass __checkWriteToggle: false
      const checkWriteToggle: boolean = __checkWriteToggle !== false;

      if (
        symbol &&
        bars &&
        bars.length > 0 &&
        Object.values(AlphaVantageEndpoint).includes(endpoint as AlphaVantageEndpoint)
      ) {
        await saveAvTimeSeriesData(
          bars,
          symbol,
          endpoint as AlphaVantageEndpoint,
          this.config.interval as TimeSeriesInterval,
          checkWriteToggle
        );
      }

      return this.createSuccessResponse(transformedData, this.config.ttl, startTime);
    } catch (error) {
      throw super.normalizeError(error);
    }
  }
}