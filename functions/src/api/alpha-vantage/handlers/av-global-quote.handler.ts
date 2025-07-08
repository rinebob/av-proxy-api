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
    const quote = data['Global Quote'];
    
    if (!quote) {
      throw new Error('Invalid response format: Missing Global Quote');
    }

    // Extract and transform the quote data
    return {
      symbol: quote['01. symbol'],
      open: parseFloat(quote['02. open']),
      high: parseFloat(quote['03. high']),
      low: parseFloat(quote['04. low']),
      price: parseFloat(quote['05. price']),
      volume: parseInt(quote['06. volume'], 10),
      latestTradingDay: quote['07. latest trading day'],
      previousClose: parseFloat(quote['08. previous close']),
      change: parseFloat(quote['09. change']),
      changePercent: quote['10. change percent']
    };
  }

  protected prepareRequestParams(params: Record<string, any>): Record<string, any> {
    // Call the parent's prepareRequestParams first
    const baseParams = super.prepareRequestParams(params);
    
    // Add any additional parameters specific to this endpoint
    return {
      ...baseParams,
      datatype: 'json' // Force JSON response
    };
  }
}
