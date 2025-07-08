import { AlphaVantageBaseHandler } from './alpha-vantage-base.handler';
import { ApiResponse } from '../../common/types';

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
    try {
      // Validate required parameters
      if (!params.symbol) {
        throw new Error('Symbol parameter is required');
      }

      // Call the parent fetch method to make the actual API request
      const response = await super.fetch({
        symbol: params.symbol,
        datatype: 'json'
      });

      return response;
    } catch (error) {
      console.error('Error in AvCompanyOverviewHandler:', error);
      throw error;
    }
  }

  /**
   * Transforms the Alpha Vantage API response into a more usable format
   * @param data Raw API response data
   * @returns Transformed company overview data
   */
  protected transformResponse(data: any): CompanyOverviewData {
    // If the API returns an error message in the response
    if (data['Error Message']) {
      throw new Error(data['Error Message']);
    }

    // If no data is returned
    if (!data || Object.keys(data).length === 0) {
      throw new Error('No data returned from Alpha Vantage API');
    }

    // The Alpha Vantage API returns the data directly as an object
    // We'll clean it up and ensure all fields are properly typed
    const result: Partial<CompanyOverviewData> = {};
    
    // Map the response fields to our interface
    // This ensures we only include the fields we expect and handle any missing ones
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

    // Map each field from the API response to our result object
    (Object.entries(fieldMappings) as [keyof CompanyOverviewData, string | string[]][]).forEach(([key, apiKey]) => {
      if (Array.isArray(apiKey)) {
        // Handle multiple possible field names (not needed here but kept for future use)
        for (const k of apiKey) {
          if (data[k] !== undefined) {
            result[key] = data[k];
            break;
          }
        }
      } else if (data[apiKey] !== undefined) {
        // Handle single field name
        result[key] = data[apiKey];
      }
    });

    // Ensure we have at least some data
    if (Object.keys(result).length === 0) {
      throw new Error('No valid data found in API response');
    }

    return result as CompanyOverviewData;
  }
}
