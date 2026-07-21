// Type-only imports
import type { ApiResponse } from '@shared/core';
import type { AvHistoricalOptionsResponse, AvOptionContract } from '@shared/alpha-vantage';

// Value imports
import { API_CONSTANTS } from '@shared/core';
import { FirestoreCollection } from '@shared/firestore';
import { AlphaVantageBaseHandler } from './alpha-vantage-base.handler';
import { AlphaVantageEndpoint, AvOptionType } from '@shared/alpha-vantage';
import {
  analyzeOptions,
  toAlphaVantageUpstreamError,
  validateAlphaVantageApiResponse,
} from '../utils';
import { saveAvHistoricalOptions } from '../firestore/av-options-firestore-helper';

/**
 * Handler for the Alpha Vantage Historical Options endpoint
 * @see https://www.alphavantage.co/documentation/#historical-options
 */
export class AvHistoricalOptionsHandler extends AlphaVantageBaseHandler<AvHistoricalOptionsResponse> {
  protected readonly endpoint = AlphaVantageEndpoint.HISTORICAL_OPTIONS;
  
  /**
   * Fetches historical options data from Alpha Vantage
   * @param params Request parameters (symbol is required, date is optional)
   * @returns Processed historical options data wrapped in ApiResponse
   */
  public async fetch(params: Record<string, any>): Promise<ApiResponse<AvHistoricalOptionsResponse>> {
    console.log('========== START AvHistoricalOptionsHandler.fetch ====================');
    const startTime = Date.now();
    const { symbol, date } = params;
    
    console.log(`aHO.H f [${this.requestId}] [HISTORICAL-OPTIONS] Starting fetch`, {
      symbol,
      date: date || 'latest',
      params: JSON.stringify(params)
    });
    
    try {
      // Validate required parameters
      if (!symbol) {
        const error = new Error('Symbol parameter is required');
        console.error(`aHO.H f [${this.requestId}] [HISTORICAL-OPTIONS] Validation error:`, error.message);
        throw error;
      }

      // Prepare request parameters
      const requestParams = this.prepareRequestParams({
        symbol,
        date,
        datatype: API_CONSTANTS.ALPHA_VANTAGE.RESPONSE_TYPE
      });

      console.log(`aHO.H f [${this.requestId}] [HISTORICAL-OPTIONS] Fetching historical options data`);
      
      // Use fetchSimple to get raw data and handle transformation locally
      const rawData = await this.fetchSimple(requestParams);
      const transformedData = this.transformResponse(rawData);

      // Analyze the options data
      if (transformedData.data?.length > 0) {
        try {
          const analysis = analyzeOptions(transformedData.data);
          
          // Get the expiration date from the first contract or use the provided date
          const expiration = transformedData.data[0]?.expiration || date || new Date().toISOString().split('T')[0];
          
          // Save to Firestore (don't block the response waiting for this to complete)
          saveAvHistoricalOptions(symbol, expiration, transformedData, analysis, this.endpoint)
            .catch(error => {
              console.error(`[${this.requestId}] [HISTORICAL-OPTIONS] Error saving to Firestore:`, error);
            });
            
        } catch (analysisError) {
          console.error(`[${this.requestId}] [HISTORICAL-OPTIONS] Error analyzing options data:`, analysisError);
          // Don't fail the request if analysis fails
        }
      }

      console.log(`aHO.H f [${this.requestId}] [HISTORICAL-OPTIONS] Successfully fetched historical options in ${Date.now() - startTime}ms`, {
        symbol,
        date: date || 'latest',
        numContracts: transformedData.data?.length || 0,
      });

      console.log('========== END AvHistoricalOptionsHandler.fetch ====================');

      return this.createSuccessResponse(transformedData, this.config.ttl, startTime);
      
    } catch (error) {
      console.error(`aHO.H f [${this.requestId}] [HISTORICAL-OPTIONS] Error in fetch:`, {
        error: error instanceof Error ? error.message : 'Unknown error',
        stack: error instanceof Error ? error.stack : undefined,
        symbol: params.symbol,
        date: params.date,
        processingTimeMs: Date.now() - startTime
      });
      throw error;
    }
  }

  public async fetchWithoutPersistence(params: {
    symbol: string;
    date?: string;
  }): Promise<AvHistoricalOptionsResponse> {
    try {
      const rawData = await this.fetchSimple({
        symbol: params.symbol,
        date: params.date,
        datatype: API_CONSTANTS.ALPHA_VANTAGE.RESPONSE_TYPE,
      });
      return this.transformResponse(rawData);
    } catch (error) {
      throw toAlphaVantageUpstreamError(error);
    }
  }

  /**
   * Transforms the Alpha Vantage API response into a more usable format
   * @param data Raw API response data
   * @returns Transformed historical options data
   */
  protected transformResponse(data: any): AvHistoricalOptionsResponse {
    console.log(`aHO.H tR [${this.requestId}] [HISTORICAL-OPTIONS] Starting response transformation`);
    
    try {
      validateAlphaVantageApiResponse(data);
      
      if (!data.data || !Array.isArray(data.data)) {
        throw new Error('Invalid API response: missing or invalid data array');
      }

      const result: AvHistoricalOptionsResponse = {
        endpoint: data.endpoint || '',
        message: data.message || '',
        data: data.data.map((contract: any) => this.normalizeAvOptionContract(contract))
      };

      console.log(`aHO.H tR [${this.requestId}] [HISTORICAL-OPTIONS] Successfully transformed response`, {
        numContracts: result.data.length,
        firstContractSymbol: result.data[0]?.symbol || 'none'
      });

      return result;
      
    } catch (error) {
      console.error(`aHO.H tR [${this.requestId}] [HISTORICAL-OPTIONS] Error transforming response:`, {
        error: error instanceof Error ? error.message : 'Unknown error',
        stack: error instanceof Error ? error.stack : undefined,
        dataSample: data ? JSON.stringify(data).substring(0, 200) + '...' : 'No data'
      });
      throw error;
    }
  }
  
  /**
   * Normalizes option contract data to ensure consistent structure
   * @throws {Error} If the contract is null, undefined, or missing required fields
   */
  private normalizeAvOptionContract(contract: any): AvOptionContract {
    if (!contract) {
      throw new Error('Contract data is required');
    }

    const normalized: AvOptionContract = {
      contractID: typeof contract.contractID === 'string' ? contract.contractID : undefined,
      symbol: typeof contract.symbol === 'string' ? contract.symbol : undefined,
      expiration: typeof contract.expiration === 'string' ? contract.expiration : undefined,
      strike: this.normalizeNumber(contract.strike),
      type: contract.type === AvOptionType.CALL || contract.type === AvOptionType.PUT
        ? contract.type
        : undefined,
      last: this.normalizeNumber(contract.last),
      mark: this.normalizeNumber(contract.mark),
      bid: this.normalizeNumber(contract.bid),
      bid_size: this.normalizeNumber(contract.bid_size),
      ask: this.normalizeNumber(contract.ask),
      ask_size: this.normalizeNumber(contract.ask_size),
      volume: this.normalizeNumber(contract.volume),
      open_interest: this.normalizeNumber(contract.open_interest),
      date: typeof contract.date === 'string' ? contract.date : undefined,
      implied_volatility: this.normalizeNumber(contract.implied_volatility),
      delta: this.normalizeNumber(contract.delta),
      gamma: this.normalizeNumber(contract.gamma),
      theta: this.normalizeNumber(contract.theta),
      vega: this.normalizeNumber(contract.vega),
      rho: this.normalizeNumber(contract.rho)
    };

    return normalized;
  }
  
  /**
   * Normalizes numeric values to string representation
   */
  private normalizeNumber(value: unknown): string | undefined {
    if (value === null || value === undefined) {
      return undefined;
    }

    if (typeof value === 'string' && !value.trim()) {
      return undefined;
    }

    const numberValue = Number(value);
    return Number.isFinite(numberValue) ? String(value) : undefined;
  }
  
  /**
   * Get the Firestore document path for the given parameters
   * @param params Request parameters
   */
  protected getFirestorePath(params: Record<string, any>): string {
    const { symbol, date } = params;
    const dateSuffix = date ? `-${date}` : '';
    return `${FirestoreCollection.SYMBOL_DATA}/${symbol}/${FirestoreCollection.OPTIONS}/av-${FirestoreCollection.HISTORICAL_OPTIONS}${dateSuffix}`;
  }
  
  /**
   * Prepares the request parameters before sending to the API
   * @param params Original request parameters
   */
  protected prepareRequestParams(params: Record<string, any>): Record<string, any> {
    console.log(`aHO.H pRP [${this.requestId}] [HISTORICAL-OPTIONS] Preparing request params:`, params);
    
    // Call the parent's prepareRequestParams first
    const baseParams = super.prepareRequestParams(params);
    
    // Add any additional parameters specific to this endpoint
    const requestParams = {
      ...baseParams,
      datatype: API_CONSTANTS.ALPHA_VANTAGE.RESPONSE_TYPE // Force JSON response
    };

    console.log(`aHO.H pRP [${this.requestId}] [HISTORICAL-OPTIONS] Final request params:`, requestParams);
    return requestParams;
  }
}
