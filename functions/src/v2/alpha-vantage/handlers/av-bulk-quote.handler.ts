import { AlphaVantageBaseHandler } from './alpha-vantage-base.handler';
import { AlphaVantageEndpoint } from '../../common/common-av';
import { validateAlphaVantageApiResponse } from '../utils/av-response-utils';

/**
 * Response format for a single quote in the bulk quotes response
 */
export interface BulkQuoteData {
  symbol: string;
  open: string;
  high: string;
  low: string;
  price: string;
  volume: string;
  latestTradingDay: string;
  previousClose: string;
  change: string;
  changePercent: string;
}

/**
 * Response format for the Alpha Vantage REALTIME_BULK_QUOTES endpoint
 */
export interface AlphaVantageBulkQuotesResponse {
  quotes: BulkQuoteData[];
  information?: string;
  note?: string;
  errorMessage?: string;
}

/**
 * Handler for the Alpha Vantage REALTIME_BULK_QUOTES endpoint
 */
export class AvBulkQuoteHandler extends AlphaVantageBaseHandler<AlphaVantageBulkQuotesResponse> {
  /**
   * Transforms the raw API response into a structured format
   */
  protected transformResponse(data: any): AlphaVantageBulkQuotesResponse {
    validateAlphaVantageApiResponse(data);

    // The bulk quotes endpoint returns an object with symbol keys
    const quotes: BulkQuoteData[] = [];
    
    for (const [symbol, quoteData] of Object.entries(data)) {
      // Skip non-quote data
      if (symbol === 'Meta Data' || symbol === 'Information' || symbol === 'Note') {
        continue;
      }
      
      const quote = quoteData as Record<string, string>;
      quotes.push({
        symbol,
        open: quote['1. open'],
        high: quote['2. high'],
        low: quote['3. low'],
        price: quote['4. price'],
        volume: quote['5. volume'],
        latestTradingDay: quote['7. latest trading day'],
        previousClose: quote['8. previous close'],
        change: quote['9. change'],
        changePercent: quote['10. change percent']
      });
    }

    return { quotes };
  }

  /**
   * Fetches bulk quotes for the given symbols
   * @param symbols Array of stock symbols to fetch quotes for (max 100)
   */
  async getBulkQuotes(symbols: string[]): Promise<AlphaVantageBulkQuotesResponse> {
    if (symbols.length === 0) {
      return { quotes: [] };
    }
    
    if (symbols.length > 100) {
      console.warn(`More than 100 symbols provided (${symbols.length}), only using first 100`);
      symbols = symbols.slice(0, 100);
    }

    const params = {
      function: AlphaVantageEndpoint.REALTIME_BULK_QUOTES,
      symbols: symbols.join(',')
    };

    const response = await this.fetch(params);
    return response.data;
  }
}
