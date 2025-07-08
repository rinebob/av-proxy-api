import { AlphaVantageBaseHandler } from './alpha-vantage-base.handler';

export interface GlobalQuoteData {
  symbol: string;
  open: number;
  high: number;
  low: number;
  price: number;
  volume: number;
  latestTradingDay: string;
  previousClose: number;
  change: number;
  changePercent: string;
}

export class AvGlobalQuoteHandler extends AlphaVantageBaseHandler<GlobalQuoteData> {
  protected transformResponse(data: any): GlobalQuoteData {
    if (!data) {
      console.error(`aVB.H transformResponse [${this.requestId}] [GLOBAL-QUOTE] No data received in response`);
      throw new Error('No data received from Alpha Vantage API');
    }

    console.log(`aVB.H transformResponse [${this.requestId}] [GLOBAL-QUOTE] Starting response transformation`);
    
    const quote = data['Global Quote'];
    
    if (!quote) {
      const errorMsg = 'Invalid response format: Missing Global Quote';
      console.error(`aVB.H transformResponse [${this.requestId}] [GLOBAL-QUOTE] ${errorMsg}`, { 
        availableKeys: Object.keys(data),
        dataSample: JSON.stringify(data).substring(0, 200) + '...' 
      });
      throw new Error(errorMsg);
    }

    console.log(`aVB.H transformResponse [${this.requestId}] [GLOBAL-QUOTE] Processing quote for symbol: ${quote['01. symbol']}`);
    
    try {
      // Extract and transform the quote data
      const result = {
        symbol: quote['01. symbol'],
        open: parseFloat(quote['02. open']),
        high: parseFloat(quote['03. high']),
        low: parseFloat(quote['04. low']),
        price: parseFloat(quote['05. price']),
        volume: parseInt(quote['06. volume'], 10),
        latestTradingDay: quote['07. latest trading day'],
        previousClose: parseFloat(quote['08. previous close']),
        change: parseFloat(quote['09. change']),
        changePercent: quote['10. change percent'].replace('%', '')
      };

      console.log(`aVB.H transformResponse [${this.requestId}] [GLOBAL-QUOTE] Successfully transformed quote data`, {
        symbol: result.symbol,
        price: result.price,
        change: result.change,
        changePercent: result.changePercent
      });

      return result;
      
    } catch (error) {
      console.error(`aVB.H transformResponse [${this.requestId}] [GLOBAL-QUOTE] Error transforming response:`, {
        error: error instanceof Error ? error.message : 'Unknown error',
        stack: error instanceof Error ? error.stack : undefined,
        quoteData: JSON.stringify(quote).substring(0, 200) + '...'
      });
      throw new Error(`Failed to process global quote: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  protected prepareRequestParams(params: Record<string, any>): Record<string, any> {
    console.log(`aVB.H prepareRequestParams [${this.requestId}] [GLOBAL-QUOTE] Preparing request params:`, params);
    
    // Call the parent's prepareRequestParams first
    const baseParams = super.prepareRequestParams(params);
    
    // Add any additional parameters specific to this endpoint
    const requestParams = {
      ...baseParams,
      datatype: 'json' // Force JSON response
    };

    console.log(`aVB.H prepareRequestParams [${this.requestId}] [GLOBAL-QUOTE] Final request params:`, requestParams);
    return requestParams;
  }
}
