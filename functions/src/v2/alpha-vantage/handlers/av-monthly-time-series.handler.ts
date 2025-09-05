import { AlphaVantageTimeSeriesHandlerBase, StorageBar } from './alpha-vantage-timeseries-base.handler';
import { validateAlphaVantageApiResponse } from '../utils/av-response-utils';

interface AvMonthlyMeta {
  information?: string;
  symbol?: string;
  lastRefreshed?: string;
  outputSize?: string;
  timeZone?: string;
}

interface AvMonthlyEntry {
  open: number;
  high: number;
  low: number;
  close: number;
  adjustedClose?: number;
  volume: number;
  dividendAmount?: number;
}

export interface AvMonthlyNormalizedResponse {
  meta: AvMonthlyMeta;
  timeSeriesMonthly: Record<string, AvMonthlyEntry>;
}

/**
 * Handler for Alpha Vantage TIME_SERIES_MONTHLY and TIME_SERIES_MONTHLY_ADJUSTED.
 */
export class AvMonthlyTimeSeriesHandler extends AlphaVantageTimeSeriesHandlerBase<AvMonthlyNormalizedResponse> {
  protected transformResponse(raw: any): AvMonthlyNormalizedResponse {
    validateAlphaVantageApiResponse(raw);
    const metaRaw = raw['Meta Data'] || {};
    const tsAdjusted = raw['Monthly Adjusted Time Series'];
    const tsRaw = raw['Monthly Time Series'];
    const ts = tsAdjusted || tsRaw;
    if (!ts) {
      throw new Error('Invalid response format: Missing Monthly Time Series');
    }

    const meta: AvMonthlyMeta = {
      information: metaRaw['1. Information'] ?? metaRaw['Information'],
      symbol: metaRaw['2. Symbol'] ?? metaRaw['Symbol'],
      lastRefreshed: metaRaw['3. Last Refreshed'] ?? metaRaw['Last Refreshed'],
      outputSize: metaRaw['4. Output Size'] ?? metaRaw['Output Size'],
      timeZone: metaRaw['5. Time Zone'] ?? metaRaw['Time Zone'],
    };

    const timeSeriesMonthly: Record<string, AvMonthlyEntry> = {};
    for (const [date, values] of Object.entries<any>(ts)) {
      const adjustedClose = values['5. adjusted close'];
      const dividendAmount = values['7. dividend amount'];
      timeSeriesMonthly[date] = {
        open: parseFloat(values['1. open']),
        high: parseFloat(values['2. high']),
        low: parseFloat(values['3. low']),
        close: parseFloat(values['4. close']),
        ...(adjustedClose !== undefined ? { adjustedClose: parseFloat(adjustedClose) } : {}),
        volume: parseInt(values['6. volume'] ?? values['5. volume'], 10),
        ...(dividendAmount !== undefined ? { dividendAmount: parseFloat(dividendAmount) } : {}),
      };
    }

    return { meta, timeSeriesMonthly };
  }

  protected getBarsForStorage(transformed: AvMonthlyNormalizedResponse): StorageBar[] | null {
    if (!transformed?.timeSeriesMonthly) return null;
    const bars: StorageBar[] = Object.entries(transformed.timeSeriesMonthly).map(([date, v]) => ({
      date,
      open: Number(v.open),
      high: Number(v.high),
      low: Number(v.low),
      close: Number(v.adjustedClose ?? v.close),
      volume: Number(v.volume),
    }));
    return bars.length ? bars : null;
  }
}
