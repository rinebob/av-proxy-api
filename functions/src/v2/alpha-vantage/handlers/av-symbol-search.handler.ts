import { AlphaVantageBaseHandler } from './alpha-vantage-base.handler';
import { 
  AlphaVantageEndpoint, 
  AlphaVantageSymbolSearchResponse, 
  AlphaVantageSymbolMatch, 
  SymbolData
} from '../../common/common-av';
import { ApiResponse } from '../../common/types';
import { FirestoreCollection } from '../../common/firestore-collections';
import { AV_ENDPOINT_CONFIGS } from '../config/av-endpoint-configs';
import { db } from '../../../firebase-admin-init';
import { isAxiosError } from 'axios';

/**
 * Handler for Alpha Vantage SYMBOL_SEARCH endpoint
 * 
 * This handler is responsible for searching for symbols and companies based on keywords
 * using Alpha Vantage's SYMBOL_SEARCH endpoint.
 * 
 * API Documentation: https://www.alphavantage.co/documentation/#symbolsearch
 */
export class AvSymbolSearchHandler extends AlphaVantageBaseHandler<AlphaVantageSymbolSearchResponse> {
  // Initialize Firestore db instance
  private readonly db: FirebaseFirestore.Firestore;

  constructor() {
    // Get the configuration from the endpoint configs
    const config = AV_ENDPOINT_CONFIGS[AlphaVantageEndpoint.SYMBOL_SEARCH];
    if (!config) {
      throw new Error(`Configuration not found for endpoint: ${AlphaVantageEndpoint.SYMBOL_SEARCH}`);
    }
    
    super(config);
    this.db = db;
  }

  /**
   * Fetches symbol search results from Alpha Vantage
   * @param params Object containing search parameters
   * @param params.keywords The search keywords (e.g., 'microsoft')
   * @returns Promise with the search results
   */
  public async fetch(params: { 
    keywords: string;
  }): Promise<ApiResponse<AlphaVantageSymbolSearchResponse>> {
    if (!params?.keywords) {
      throw new Error('aSS.H f Keywords parameter is required for symbol search');
    }

    const startTime = Date.now();
    const requestParams = {
      function: this.config.id,
      keywords: params.keywords.trim(),
      datatype: 'json'
    };

    console.log(`aSS.H f [${this.requestId}] === Starting fetch ===`);
    console.log(`aSS.H f [${this.requestId}] Search keywords: ${params.keywords}`);
    console.log(`aSS.H f [${this.requestId}] Request params:`, JSON.stringify(requestParams, null, 2));
    
    try {
      // Make the API request
      console.log(`aSS.H f [${this.requestId}] Sending request to Alpha Vantage API`);
      const response = await this.apiClient.get<AlphaVantageSymbolSearchResponse>('', { 
        params: requestParams
      });

      console.log(`aSS.H f [${this.requestId}] Received API response, status: ${response.status}`);
      console.log(`aSS.H f [${this.requestId}] Response headers:`, response.headers);
      console.log(`aSS.H f [${this.requestId}] Response data type:`, typeof response.data);
      
      if (response.data) {
        console.log(`aSS.H f [${this.requestId}] Response data keys:`, Object.keys(response.data));
        if ('Note' in response.data) {
          console.warn(`aSS.H f [${this.requestId}] API Rate Limit Note:`, response.data.Note);
        }
      }
      
      // Transform the response to match our expected format
      console.log(`aSS.H f [${this.requestId}] Transforming response data`);
      const transformedData = this.transformResponse(response.data);
      console.log(`aSS.H f [${this.requestId}] Transformed data type:`, typeof transformedData);
      console.log(`aSS.H f [${this.requestId}] Transformed data keys:`, Object.keys(transformedData));
      
      // Only save to Firestore if we have matches
      if (transformedData.bestMatches?.length > 0) {
        console.log(`aSS.H f [${this.requestId}] Found ${transformedData.bestMatches.length} matches, saving to Firestore`);
        await this.saveToFirestore(transformedData, params.keywords);
      } else {
        console.log(`aSS.H f [${this.requestId}] No matches found, skipping Firestore save`);
      }

      const result = {
        data: transformedData,
        metadata: {
          symbol: transformedData.bestMatches[0]?.['1. symbol'] || 'N/A',
          endpoint: this.config.id,
          timestamp: new Date(),
          requestId: this.requestId,
          ttl: this.config.ttl,
          processingTimeMs: Date.now() - startTime
        }
      };

      console.log(`aSS.H f [${this.requestId}] === Fetch completed in ${result.metadata.processingTimeMs}ms ===`);
      return result;
    } catch (error) {
      console.error(`aSS.H f [${this.requestId}] Error in AvSymbolSearchHandler:`, error);
      if (isAxiosError(error)) {
        console.error(`aSS.H f [${this.requestId}] Error response status:`, error.response?.status);
        console.error(`aSS.H f [${this.requestId}] Error response data:`, error.response?.data);
      }
      throw error;
    }
  }

  /**
   * Transforms the API response to match our expected format
   */
  protected transformResponse(data: any): AlphaVantageSymbolSearchResponse {
    console.log(`aSS.H tR [${this.requestId}] Transforming response. data: `, data);
    // If the response is wrapped in a data property, unwrap it
    if (data && typeof data === 'object' && 'data' in data) {
      console.log(`aSS.H tR [${this.requestId}] Unwrapping response from data property`);
      data = data.data;
    }

    // If the response already has the expected format, return it as is
    if (data.bestMatches && Array.isArray(data.bestMatches)) {
      console.log(`aSS.H tR [${this.requestId}] Found bestMatches array with ${data.bestMatches.length} items`);
      return data as AlphaVantageSymbolSearchResponse;
    }

    // Transform the response if needed
    const bestMatches: AlphaVantageSymbolMatch[] = [];
    
    if (data && typeof data === 'object') {
      // Handle different possible response formats
      const matches = data.bestMatches || data.matches || [];
      console.log(`aSS.H tR [${this.requestId}] Processing ${matches.length} matches`);
      
      for (const match of matches) {
        if (match['1. symbol'] || match.symbol) {
          bestMatches.push({
            '1. symbol': match['1. symbol'] || match.symbol,
            '2. name': match['2. name'] || match.name || '',
            '3. type': match['3. type'] || match.type || '',
            '4. region': match['4. region'] || match.region || '',
            '5. marketOpen': match['5. marketOpen'] || match.marketOpen || '',
            '6. marketClose': match['6. marketClose'] || match.marketClose || '',
            '7. timezone': match['7. timezone'] || match.timezone || '',
            '8. currency': match['8. currency'] || match.currency || '',
            '9. matchScore': match['9. matchScore'] || match.matchScore || ''
          });
        }
      }
    }

    console.log(`aSS.H tR [${this.requestId}] Returning ${bestMatches.length} matches`);
    return { bestMatches };
  }

  /**
   * Saves the search results to Firestore, prioritizing US-based symbols with the highest match score
   */
  private async saveToFirestore(
    data: AlphaVantageSymbolSearchResponse,
    keywords: string
  ): Promise<void> {
    if (!data.bestMatches?.length) {
      console.log(`aSS.H sTF [${this.requestId}] No bestMatches to process`);
      return;
    }

    try {
      console.log(`aSS.H sTF [${this.requestId}] Searching for best US match among ${data.bestMatches.length} matches`);
      
      // Log all matches for debugging
      data.bestMatches.forEach((match, index) => {
        console.log(`aSS.H sTF [${this.requestId}] Match ${index + 1}: ${match['1. symbol']} (${match['4. region']}) - Score: ${match['9. matchScore']}`);
      });
      
      // Find the best US-based match with the highest score
      let bestMatch = data.bestMatches.reduce<AlphaVantageSymbolMatch | null>((best, current) => {
        const currentScore = parseFloat(current['9. matchScore'] || '0');
        const bestScore = best ? parseFloat(best['9. matchScore'] || '0') : -1;
        
        // Only consider US-based symbols
        const isUS = current['4. region']?.toLowerCase().includes('united states');
        
        if (isUS && (!best || currentScore > bestScore)) {
          console.log(`aSS.H sTF [${this.requestId}] New best US match: ${current['1. symbol']} with score ${currentScore}`);
          return current;
        }
        return best;
      }, null);

      // If no US match found, use the highest scoring match
      if (!bestMatch) {
        console.log(`aSS.H sTF [${this.requestId}] No US matches found, falling back to highest score`);
        bestMatch = data.bestMatches.reduce((best, current) => {
          const currentScore = parseFloat(current['9. matchScore'] || '0');
          const bestScore = best ? parseFloat(best['9. matchScore'] || '0') : -1;
          if (currentScore > bestScore) {
            console.log(`aSS.H sTF [${this.requestId}] New best match: ${current['1. symbol']} with score ${currentScore}`);
            return current;
          }
          return best;
        }, null as AlphaVantageSymbolMatch | null);
      }

      if (!bestMatch) {
        console.log(`aSS.H sTF [${this.requestId}] No valid matches found to save`);
        return;
      }

      const now = new Date();
      
      const symbolData: SymbolData = {
        symbol: bestMatch['1. symbol'],
        name: bestMatch['2. name'],
        type: bestMatch['3. type'],
        region: bestMatch['4. region'],
        marketOpen: bestMatch['5. marketOpen'],
        marketClose: bestMatch['6. marketClose'],
        timezone: bestMatch['7. timezone'],
        currency: bestMatch['8. currency'],
        matchScore: bestMatch['9. matchScore'],
        isActive: true,
        refreshEnabled: false,
        createdAt: now,
        lastUpdated: now
      };

      console.log(`aSS.H sTF [${this.requestId}] Preparing to save symbol data:`, JSON.stringify(symbolData, null, 2));
      
      const docRef = this.db.collection(FirestoreCollection.TRACKED_SYMBOLS).doc(symbolData.symbol);
      
      console.log(`aSS.H sTF [${this.requestId}] Saving to Firestore at path: ${FirestoreCollection.TRACKED_SYMBOLS}/${symbolData.symbol}`);
      
      await docRef.set(symbolData, { merge: true });
      
      console.log(`aSS.H sTF [${this.requestId}] Successfully saved symbol data for ${symbolData.symbol} (${symbolData.region}) with score ${symbolData.matchScore}`);
    } catch (error) {
      console.error(`aSS.H sTF [${this.requestId}] Error saving symbol data to Firestore:`, error);
      // Don't throw the error to avoid failing the entire request
    }
  }
}
