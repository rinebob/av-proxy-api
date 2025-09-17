import { AlphaVantageTimeSeriesHandlerBase, StorageBar } from './alpha-vantage-timeseries-base.handler';
import { validateAlphaVantageApiResponse } from '../utils/av-response-utils';
import type { AvCommonMeta, AvOhlcEntry, AvTimeSeriesNormalized } from '@shared/alpha-vantage';
import { TimeSeriesInterval } from '@shared/alpha-vantage';

/**
 * Handler for Alpha Vantage TIME_SERIES_WEEKLY and TIME_SERIES_WEEKLY_ADJUSTED.
 */
export class AvWeeklyTimeSeriesHandler extends AlphaVantageTimeSeriesHandlerBase<AvTimeSeriesNormalized> {
  protected transformResponse(raw: any): AvTimeSeriesNormalized {
    validateAlphaVantageApiResponse(raw);
    const metaRaw = raw['Meta Data'] || {};
    const tsAdjusted = raw['Weekly Adjusted Time Series'];
    const tsRaw = raw['Weekly Time Series'];
    const ts = tsAdjusted || tsRaw;
    if (!ts) {
      throw new Error('Invalid response format: Missing Weekly Time Series');
    }

    const meta: AvCommonMeta = {
      information: metaRaw['1. Information'] ?? metaRaw['Information'],
      symbol: metaRaw['2. Symbol'] ?? metaRaw['Symbol'],
      lastRefreshed: metaRaw['3. Last Refreshed'] ?? metaRaw['Last Refreshed'],
      outputSize: metaRaw['4. Output Size'] ?? metaRaw['Output Size'],
      timeZone: metaRaw['5. Time Zone'] ?? metaRaw['Time Zone'],
    };

    const weekly: Record<string, AvOhlcEntry> = {};
    for (const [date, values] of Object.entries<any>(ts)) {
      const adjustedClose = values['5. adjusted close'];
      const dividendAmount = values['7. dividend amount'];
      weekly[date] = {
        open: parseFloat(values['1. open']),
        high: parseFloat(values['2. high']),
        low: parseFloat(values['3. low']),
        close: parseFloat(values['4. close']),
        ...(adjustedClose !== undefined ? { adjustedClose: parseFloat(adjustedClose) } : {}),
        volume: parseInt(values['6. volume'] ?? values['5. volume'], 10),
        ...(dividendAmount !== undefined ? { dividendAmount: parseFloat(dividendAmount) } : {}),
      };
    }

    return { meta, series: { [TimeSeriesInterval.WEEKLY]: weekly } };
  }

  protected getBarsForStorage(transformed: AvTimeSeriesNormalized): StorageBar[] | null {
    const weekly = transformed?.series?.[TimeSeriesInterval.WEEKLY];
    if (!weekly) return null;
    const entries = Object.entries(weekly) as [string, AvOhlcEntry][];
    const bars: StorageBar[] = entries.map(([date, v]) => ({
      date,
      open: Number(v.open),
      high: Number(v.high),
      low: Number(v.low),
      close: Number(v.adjustedClose ?? v.close),
      volume: Number(v.volume),
    }));
    if (!bars.length) return null;
    return bars;
  }
}
