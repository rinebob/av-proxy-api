import { AlphaVantageBaseHandler } from './alpha-vantage-base.handler';
import { ApiResponse } from '@shared/core';
import { validateAlphaVantageApiResponse } from '../utils/av-response-utils';

/**
 * Interface for the company overview data structure returned by Alpha Vantage
 * @see https://www.alphavantage.co/documentation/#company-overview
 */
interface CompanyOverviewData {
  Symbol: string;
  AssetType: string;
  Name: string;
  Description: string;
  CIK: string;
  Exchange: string;
  Currency: string;
  Country: string;
  Sector: string;
  Industry: string;
  Address: string;
  FiscalYearEnd: string;
  LatestQuarter: string;
  MarketCapitalization: string;
  EBITDA: string;
  PERatio: string;
  PEGRatio: string;
  BookValue: string;
  DividendPerShare: string;
  DividendYield: string;
  EPS: string;
  RevenuePerShareTTM: string;
  ProfitMargin: string;
  OperatingMarginTTM: string;
  ReturnOnAssetsTTM: string;
  ReturnOnEquityTTM: string;
  RevenueTTM: string;
  GrossProfitTTM: string;
  DilutedEPSTTM: string;
  QuarterlyEarningsGrowthYOY: string;
  QuarterlyRevenueGrowthYOY: string;
  AnalystTargetPrice: string;
  TrailingPE: string;
  ForwardPE: string;
  PriceToSalesRatioTTM: string;
  PriceToBookRatio: string;
  EVToRevenue: string;
  EVToEBITDA: string;
  Beta: string;
  '52WeekHigh': string;
  '52WeekLow': string;
  '50DayMovingAverage': string;
  '200DayMovingAverage': string;
  SharesOutstanding: string;
  DividendDate: string;
  ExDividendDate: string;
}

/**
 * Handler for the Alpha Vantage Company Overview endpoint
 * @see https://www.alphavantage.co/documentation/#company-overview
 */
export class AvCompanyOverviewHandler extends AlphaVantageBaseHandler<CompanyOverviewData> {
  /**
   * Fetches company overview data from Alpha Vantage
   * @param params Request parameters (symbol is required)
   * @returns Processed company overview data
   */
  public async fetch(params: Record<string, any>): Promise<ApiResponse<CompanyOverviewData>> {
    console.log('========== START AvCompanyOverviewHandler.fetch ====================');
    const startTime = Date.now();
    console.log(`aCO.H f [${this.requestId}] [COMPANY-OVERVIEW] Starting fetch for symbol: ${params.symbol}`);
    
    try {
      // Validate required parameters
      if (!params.symbol) {
        const error = new Error('Symbol parameter is required');
        console.error(`aCO.H f [${this.requestId}] [COMPANY-OVERVIEW] Validation error:`, error.message);
        throw error;
      }

      console.log(`aCO.H f [${this.requestId}] [COMPANY-OVERVIEW] Fetching company overview data`);
      
      // Call the parent fetch method to make the actual API request
      const response = await super.fetch({
        symbol: params.symbol,
        datatype: 'json'
      });

      console.log(`aCO.H f [${this.requestId}] [COMPANY-OVERVIEW] Successfully fetched company overview in ${Date.now() - startTime}ms`, {
        symbol: params.symbol,
        dataPoints: response.data ? Object.keys(response.data).length : 0
      });

      console.log('========== END AvCompanyOverviewHandler.fetch ====================');

      return response;
    } catch (error) {
      console.error(`aCO.H f [${this.requestId}] [COMPANY-OVERVIEW] Error in fetch:`, {
        error: error instanceof Error ? error.message : 'Unknown error',
        stack: error instanceof Error ? error.stack : undefined,
        symbol: params.symbol,
        processingTimeMs: Date.now() - startTime
      });
      throw error;
    }
  }

  /**
   * Transforms the Alpha Vantage API response into a more usable format
   * @param data Raw API response data
   * @returns Transformed company overview data
   */
  protected transformResponse(data: any): CompanyOverviewData {
    validateAlphaVantageApiResponse(data);
    console.log(`aCO.H tR [${this.requestId}] [COMPANY-OVERVIEW] Starting response transformation. data: ${JSON.stringify(data)}`);
    
    console.log(`aCO.H tR [${this.requestId}] [COMPANY-OVERVIEW] Processing company overview for symbol: ${data.Symbol || 'unknown'}`);

    try {
      // Map the response fields to our interface
      const result: Partial<CompanyOverviewData> = {};
      const fieldMappings: Record<keyof CompanyOverviewData, string | string[]> = {
        Symbol: 'Symbol',
        AssetType: 'AssetType',
        Name: 'Name',
        Description: 'Description',
        CIK: 'CIK',
        Exchange: 'Exchange',
        Currency: 'Currency',
        Country: 'Country',
        Sector: 'Sector',
        Industry: 'Industry',
        Address: 'Address',
        FiscalYearEnd: 'FiscalYearEnd',
        LatestQuarter: 'LatestQuarter',
        MarketCapitalization: 'MarketCapitalization',
        EBITDA: 'EBITDA',
        PERatio: 'PERatio',
        PEGRatio: 'PEGRatio',
        BookValue: 'BookValue',
        DividendPerShare: 'DividendPerShare',
        DividendYield: 'DividendYield',
        EPS: 'EPS',
        RevenuePerShareTTM: 'RevenuePerShareTTM',
        ProfitMargin: 'ProfitMargin',
        OperatingMarginTTM: 'OperatingMarginTTM',
        ReturnOnAssetsTTM: 'ReturnOnAssetsTTM',
        ReturnOnEquityTTM: 'ReturnOnEquityTTM',
        RevenueTTM: 'RevenueTTM',
        GrossProfitTTM: 'GrossProfitTTM',
        DilutedEPSTTM: 'DilutedEPSTTM',
        QuarterlyEarningsGrowthYOY: 'QuarterlyEarningsGrowthYOY',
        QuarterlyRevenueGrowthYOY: 'QuarterlyRevenueGrowthYOY',
        AnalystTargetPrice: 'AnalystTargetPrice',
        TrailingPE: 'TrailingPE',
        ForwardPE: 'ForwardPE',
        PriceToSalesRatioTTM: 'PriceToSalesRatioTTM',
        PriceToBookRatio: 'PriceToBookRatio',
        EVToRevenue: 'EVToRevenue',
        EVToEBITDA: 'EVToEBITDA',
        Beta: 'Beta',
        '52WeekHigh': '52WeekHigh',
        '52WeekLow': '52WeekLow',
        '50DayMovingAverage': '50DayMovingAverage',
        '200DayMovingAverage': '200DayMovingAverage',
        SharesOutstanding: 'SharesOutstanding',
        DividendDate: 'DividendDate',
        ExDividendDate: 'ExDividendDate'
      };

      let mappedFields = 0;
      // Map each field from the API response to our result object
      (Object.entries(fieldMappings) as [keyof CompanyOverviewData, string | string[]][]).forEach(([key, apiKey]) => {
        if (Array.isArray(apiKey)) {
          // Handle multiple possible field names (not needed here but kept for future use)
          for (const k of apiKey) {
            if (data[k] !== undefined) {
              result[key] = data[k];
              mappedFields++;
              break;
            }
          }
        } else if (data[apiKey] !== undefined) {
          // Handle single field name
          result[key] = data[apiKey];
          mappedFields++;
        }
      });

      if (mappedFields === 0) {
        // Provider returned no data; return empty result so caller can skip save
        console.warn(`aCO.H tR [${this.requestId}] [COMPANY-OVERVIEW] Empty response; skipping save.`);
        return {} as CompanyOverviewData;
      }

      console.log(`aCO.H tR [${this.requestId}] [COMPANY-OVERVIEW] Successfully transformed company overview data`, {
        symbol: result.Symbol,
        name: result.Name,
        sector: result.Sector,
        industry: result.Industry,
        mappedFields
      });

      return result as CompanyOverviewData;
      
    } catch (error) {
      console.error(`aCO.H tR [${this.requestId}] [COMPANY-OVERVIEW] Error transforming response:`, {
        error: error instanceof Error ? error.message : 'Unknown error',
        stack: error instanceof Error ? error.stack : undefined,
        dataSample: data ? JSON.stringify(data).substring(0, 200) + '...' : 'No data'
      });
      throw error;
    }
  }
  
  protected prepareRequestParams(params: Record<string, any>): Record<string, any> {
    console.log(`aCO.H pRP [${this.requestId}] [COMPANY-OVERVIEW] Preparing request params:`, params);
    
    // Call the parent's prepareRequestParams first
    const baseParams = super.prepareRequestParams(params);
    
    // Add any additional parameters specific to this endpoint
    const requestParams = {
      ...baseParams,
      datatype: 'json' // Force JSON response
    };

    // Mask apikey before logging final params
    const logParams = { ...requestParams } as any;
    if ('apikey' in logParams) logParams.apikey = '***';
    console.log(`aCO.H pRP [${this.requestId}] [COMPANY-OVERVIEW] Final request params:`, logParams);
    return requestParams;
  }
}
