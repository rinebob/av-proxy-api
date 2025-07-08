import { AlphaVantageBaseHandler } from './alpha-vantage-base.handler';

export interface DailyTimeSeriesData {
  date: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export class AvDailyTimeSeriesHandler extends AlphaVantageBaseHandler<DailyTimeSeriesData[]> {
  protected transformResponse(data: any): DailyTimeSeriesData[] {
    // The Alpha Vantage API returns the time series in a nested object with dynamic keys
    const timeSeries = data['Time Series (Daily)'];
    
    if (!timeSeries) {
      throw new Error('Invalid response format: Missing Time Series (Daily)');
    }

    // Convert the time series object into an array of data points
    return Object.entries(timeSeries).map(([date, values]: [string, any]) => ({
      date,
      open: parseFloat(values['1. open']),
      high: parseFloat(values['2. high']),
      low: parseFloat(values['3. low']),
      close: parseFloat(values['4. close']),
      volume: parseInt(values['5. volume'], 10)
    }));
  }

  protected prepareRequestParams(params: Record<string, any>): Record<string, any> {
    // Call the parent's prepareRequestParams first
    const baseParams = super.prepareRequestParams(params);
    
    // Add any additional parameters specific to this endpoint
    return {
      ...baseParams,
      outputsize: params.outputsize || 'compact',
      datatype: 'json' // Force JSON response
    };
  }
}
