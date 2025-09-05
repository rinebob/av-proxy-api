import { AlphaVantageTimeSeriesHandlerBase, StorageBar } from './alpha-vantage-timeseries-base.handler';
import { validateAlphaVantageApiResponse } from '../utils/av-response-utils';

interface AvWeeklyMeta {
  information?: string;
  symbol?: string;
  lastRefreshed?: string;
  outputSize?: string;
  timeZone?: string;
}

interface AvWeeklyEntry {
  open: number;
  high: number;
  low: number;
  close: number;
  adjustedClose?: number;
  volume: number;
  dividendAmount?: number;
}

export interface AvWeeklyNormalizedResponse {
  meta: AvWeeklyMeta;
  timeSeriesWeekly: Record<string, AvWeeklyEntry>;
}

/**
 * Handler for Alpha Vantage TIME_SERIES_WEEKLY and TIME_SERIES_WEEKLY_ADJUSTED.
 */
export class AvWeeklyTimeSeriesHandler extends AlphaVantageTimeSeriesHandlerBase<AvWeeklyNormalizedResponse> {
  protected transformResponse(raw: any): AvWeeklyNormalizedResponse {
    validateAlphaVantageApiResponse(raw);
    const metaRaw = raw['Meta Data'] || {};
    const tsAdjusted = raw['Weekly Adjusted Time Series'];
    const tsRaw = raw['Weekly Time Series'];
    const ts = tsAdjusted || tsRaw;
    if (!ts) {
      throw new Error('Invalid response format: Missing Weekly Time Series');
    }

    const meta: AvWeeklyMeta = {
      information: metaRaw['1. Information'] ?? metaRaw['Information'],
      symbol: metaRaw['2. Symbol'] ?? metaRaw['Symbol'],
      lastRefreshed: metaRaw['3. Last Refreshed'] ?? metaRaw['Last Refreshed'],
      outputSize: metaRaw['4. Output Size'] ?? metaRaw['Output Size'],
      timeZone: metaRaw['5. Time Zone'] ?? metaRaw['Time Zone'],
    };

    const timeSeriesWeekly: Record<string, AvWeeklyEntry> = {};
    for (const [date, values] of Object.entries<any>(ts)) {
      const adjustedClose = values['5. adjusted close'];
      const dividendAmount = values['7. dividend amount'];
      timeSeriesWeekly[date] = {
        open: parseFloat(values['1. open']),
        high: parseFloat(values['2. high']),
        low: parseFloat(values['3. low']),
        close: parseFloat(values['4. close']),
        ...(adjustedClose !== undefined ? { adjustedClose: parseFloat(adjustedClose) } : {}),
        volume: parseInt(values['6. volume'] ?? values['5. volume'], 10),
        ...(dividendAmount !== undefined ? { dividendAmount: parseFloat(dividendAmount) } : {}),
      };
    }

    return { meta, timeSeriesWeekly };
  }

  protected getBarsForStorage(transformed: AvWeeklyNormalizedResponse): StorageBar[] | null {
    if (!transformed?.timeSeriesWeekly) return null;
    const bars: StorageBar[] = Object.entries(transformed.timeSeriesWeekly).map(([date, v]) => ({
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
