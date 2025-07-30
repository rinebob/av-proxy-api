import { AlphaVantageStandardHandlerBase } from './alpha-vantage-standard-base.handler';
import { validateAlphaVantageApiResponse } from '../utils/av-response-utils';

/**
 * Handler for Alpha Vantage GLOBAL_QUOTE endpoint.
 * Implements transformResponse for quote normalization.
 */
export class AvGlobalQuoteHandler extends AlphaVantageStandardHandlerBase<any> {
  protected transformResponse(data: any): any {
    validateAlphaVantageApiResponse(data);
    const quote = data['Global Quote'];
    if (!quote) {
      throw new Error('Invalid response format: Missing Global Quote');
    }
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
}
