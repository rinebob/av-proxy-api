// Handler for AV SYMBOL_SEARCH endpoint
import { getAlphaVantageApiKey, fetchStockData } from '../../utils/utils';
import { AlphaVantageEndpoint, AlphaVantageSymbolSearchResponse } from '../../common/common-av';
import { TrackedSymbol } from '../../common/common-dm';
import { Timestamp } from 'firebase-admin/firestore';

/**
 * Handler for Alpha Vantage SYMBOL_SEARCH endpoint
 * 
 * This handler is responsible for searching for symbols and companies based on keywords
 * using Alpha Vantage's SYMBOL_SEARCH endpoint and integrating with the symbol management system.
 */
export class AvSymbolSearchHandler {
   /**
   * Fetches and transforms data for AV SYMBOL_SEARCH
   * @param keywords Search keywords (e.g., 'microsoft')
   * @param clientId Optional client ID for tracking symbol usage
   * @returns Object containing matches array and optional metadata
   */
  async fetchAndTransform(
    keywords: string,
    clientId?: string
  ): Promise<{
    matches: TrackedSymbol[];
    information?: string;
    note?: string;
    errorMessage?: string;
    avRawResponse?: AlphaVantageSymbolSearchResponse | null;
  }> {
    // Defensive: Keywords required
    if (!keywords || typeof keywords !== 'string' || keywords.trim().length === 0) {
      return { 
        matches: [],
        errorMessage: 'aSS fAT Keywords parameter is required for symbol search',
        avRawResponse: null
      };
    }

    try {
      const apiKey = getAlphaVantageApiKey();
      const apiParams = {
        function: AlphaVantageEndpoint.SYMBOL_SEARCH,
        keywords: keywords.trim()
      };

      // Fetch data from Alpha Vantage
      const apiResponse = await fetchStockData(apiParams, apiKey) as AlphaVantageSymbolSearchResponse;
      
      // Transform the response to TrackedSymbol format
      const result = this.transformResponse(apiResponse);
      console.log(`aSS fAT result: ${JSON.stringify(result)}`);

      // Attach the raw AV response for traceability
      return { ...result, avRawResponse: apiResponse };
    } catch (error: any) {
      console.error('aSS fAT Error in AvSymbolSearchHandler:', error);
      return {
        matches: [],
        errorMessage: error?.message || 'Failed to fetch symbol search results',
        avRawResponse: error?.apiResponse || null
      };
    }
  }

  /**
   * Transforms the raw Alpha Vantage response to TrackedSymbol[]
   */
  private transformResponse(
    response: AlphaVantageSymbolSearchResponse
  ): {
    matches: TrackedSymbol[];
    information?: string;
    note?: string;
    errorMessage?: string;
    avRawResponse?: AlphaVantageSymbolSearchResponse;
  } {
    // If there are no matches, return empty array
    if (!response.bestMatches || response.bestMatches.length === 0) {
      return { matches: [], avRawResponse: response };
    }

    const now = Timestamp.now();
    
    // Transform matches to TrackedSymbol format
    const matches: TrackedSymbol[] = (response.bestMatches || []).map(match => ({
      symbol: match['1. symbol'],
      name: match['2. name'],
      type: match['3. type'] || 'Equity', // Default to 'Equity' if not specified
      region: match['4. region'] || '',
      marketOpen: match['5. marketOpen'] || '09:30',
      marketClose: match['6. marketClose'] || '16:00',
      timezone: match['7. timezone'] || 'UTC-05:00',
      currency: match['8. currency'] || 'USD',
      matchScore: match['9. matchScore'] || '1.0',
      isActive: true,
      lastUpdated: now,
      createdAt: now
    }));

    return { matches, avRawResponse: response };
  }
}
