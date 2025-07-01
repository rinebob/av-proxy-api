// Handler for AV COMPANY_OVERVIEW endpoint
import { getAlphaVantageApiKey, fetchStockData } from '../../utils';
import { AlphaVantageFunction } from '../../common/common-av';

export class AvCompanyOverviewHandler {
  /**
   * Fetches and transforms data for AV COMPANY_OVERVIEW
   * @param symbol Stock symbol
   * @returns Placeholder result
   */
  /**
   * Fetches and returns the Alpha Vantage COMPANY_OVERVIEW data for a symbol.
   * Does not save to Firestore; returns the raw AV response or error structure.
   */
  async fetchAndTransform(symbol: string): Promise<any> {
    // Defensive: Symbol required
    if (!symbol || typeof symbol !== 'string') {
      return { error: 'Bad Request', message: 'Symbol is required' };
    }
    try {
      // Dynamic import avoids circular deps in some setups

      const apiKey = getAlphaVantageApiKey();
      const apiParams = {
        function: AlphaVantageFunction.COMPANY_OVERVIEW,
        symbol: symbol
      };
      const apiResponse = await fetchStockData(apiParams, apiKey);
      // Pass through the raw response (including error/note/info fields)
      return apiResponse;
    } catch (error: any) {
      // Return a consistent error structure
      return {
        error: 'Alpha Vantage fetch error',
        message: error?.message || 'Unknown error',
        code: error?.code || undefined
      };
    }
  }
}
