import { AlphaVantageBaseHandler } from './alpha-vantage-base.handler';
import { 
  AlphaVantageEndpoint, 
} from '../../common/common-av';
import { ApiResponse } from '../../common/types';
import { AV_ENDPOINT_CONFIGS } from '../config/av-endpoint-configs';
import { isAxiosError } from 'axios';
import { AlphaVantageSymbolSearchResponse, SvtAvSymbolMatch } from '../../common/common-av';

/**
 * Handler for Alpha Vantage SYMBOL_SEARCH endpoint
 * 
 * This handler is responsible for searching for symbols and companies based on keywords
 * using Alpha Vantage's SYMBOL_SEARCH endpoint.
 * 
 * API Documentation: https://www.alphavantage.co/documentation/#symbolsearch
 */
export class AvSymbolSearchHandler extends AlphaVantageBaseHandler<SvtAvSymbolMatch[]> {
  // Initialize Firestore db instance

  constructor() {
    // Get the configuration from the endpoint configs
    const config = AV_ENDPOINT_CONFIGS[AlphaVantageEndpoint.SYMBOL_SEARCH];
    if (!config) {
      throw new Error(`Configuration not found for endpoint: ${AlphaVantageEndpoint.SYMBOL_SEARCH}`);
    }
    
    super(config);
  }

  /**
   * Fetches symbol search results from Alpha Vantage and transforms them to SvtAvSymbolMatch[]
   * @param params Object containing search parameters
   * @param params.keywords The search keywords (e.g., 'microsoft')
   * @returns Promise with the transformed search results
   */
  public async fetch(params: { 
    keywords: string;
  }): Promise<ApiResponse<SvtAvSymbolMatch[]>> {
    if (!params?.keywords) {
      throw new Error('aSS.H f Keywords parameter is required for symbol search');
    }

    try {
      // Call the parent class's fetch method with the correct parameters
      const response = await super.fetch({
        keywords: params.keywords
      }) as unknown as ApiResponse<{data: SvtAvSymbolMatch[], metadata: any}>;

      console.log('aSS.H fetch response: ', response)

     
      
      return response.data;
    } catch (error) {
      if (isAxiosError(error)) {
        throw new Error(`aSS.H fetch Symbol search failed: ${error.message}`);
      }
      throw error;
    }
  }

  /**
   * Transforms AlphaVantageSymbolSearchResponse to SvtAvSymbolMatch[]
   * @param response AlphaVantageSymbolSearchResponse
   * @returns Transformed array of symbol matches
   */
  protected transformResponse(response: AlphaVantageSymbolSearchResponse): SvtAvSymbolMatch[] {
    if (!Array.isArray(response.bestMatches)) {
      console.warn('aSS.H tR Expected array but got:', response);
      return [];
    }

    const result: SvtAvSymbolMatch[] = [];
    
    for (const match of response.bestMatches) {
      if (!match) continue;
      
      try {
        result.push({
          symbol: match['1. symbol'] || '',
          name: match['2. name'] || '',
          type: match['3. type'] || '',
          region: match['4. region'] || '',
          marketOpen: match['5. marketOpen'] || '',
          marketClose: match['6. marketClose'] || '',
          timezone: match['7. timezone'] || '',
          currency: match['8. currency'] || '',
          matchScore: match['9. matchScore'] || ''
        });
      } catch (error) {
        console.error('aSS.H tR Error processing match:', error, 'Match data:', match);
        // Continue with the next match even if one fails
      }
    }
    
    return result;
  }
}
