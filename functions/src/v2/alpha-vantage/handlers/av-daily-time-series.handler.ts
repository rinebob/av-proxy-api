import { AlphaVantageTimeSeriesHandlerBase } from './alpha-vantage-timeseries-base.handler';
import { validateAlphaVantageApiResponse } from '../utils/av-response-utils';

/**
 * Handler for Alpha Vantage TIME_SERIES_DAILY endpoint.
 * Implements transformResponse for daily time series normalization.
 */
export class AvDailyTimeSeriesHandler extends AlphaVantageTimeSeriesHandlerBase<any> {
  protected transformResponse(data: any): any {
    validateAlphaVantageApiResponse(data);
    const timeSeries = data['Time Series (Daily)'];
    if (!timeSeries) {
      throw new Error('Invalid response format: Missing Time Series (Daily)');
    }
    return Object.entries(timeSeries).map(([date, values]: [string, any]) => ({
      date,
      open: parseFloat(values['1. open']),
      high: parseFloat(values['2. high']),
      low: parseFloat(values['3. low']),
      close: parseFloat(values['4. close']),
      volume: parseInt(values['5. volume'], 10)
    }));
  }
}
