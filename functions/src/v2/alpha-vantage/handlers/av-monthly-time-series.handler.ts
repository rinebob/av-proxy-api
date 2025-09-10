import { AlphaVantageTimeSeriesHandlerBase, StorageBar } from './alpha-vantage-timeseries-base.handler';
import { validateAlphaVantageApiResponse } from '../utils/av-response-utils';
import { sortAndComputeChange } from '../utils/bars-utils';
import type { AvCommonMeta, AvOhlcEntry, AvTimeSeriesNormalized } from '@shared/alpha-vantage';
import { TimeSeriesInterval } from '@shared/alpha-vantage';

/**
 * Handler for Alpha Vantage TIME_SERIES_MONTHLY and TIME_SERIES_MONTHLY_ADJUSTED.
 */
export class AvMonthlyTimeSeriesHandler extends AlphaVantageTimeSeriesHandlerBase<AvTimeSeriesNormalized> {
  protected transformResponse(raw: any): AvTimeSeriesNormalized {
    validateAlphaVantageApiResponse(raw);
    const metaRaw = raw['Meta Data'] || {};
    const tsAdjusted = raw['Monthly Adjusted Time Series'];
    const tsRaw = raw['Monthly Time Series'];
    const ts = tsAdjusted || tsRaw;
    if (!ts) {
      throw new Error('Invalid response format: Missing Monthly Time Series');
    }

    const meta: AvCommonMeta = {
      information: metaRaw['1. Information'] ?? metaRaw['Information'],
      symbol: metaRaw['2. Symbol'] ?? metaRaw['Symbol'],
      lastRefreshed: metaRaw['3. Last Refreshed'] ?? metaRaw['Last Refreshed'],
      outputSize: metaRaw['4. Output Size'] ?? metaRaw['Output Size'],
      timeZone: metaRaw['5. Time Zone'] ?? metaRaw['Time Zone'],
    };

    const monthly: Record<string, AvOhlcEntry> = {};
    for (const [date, values] of Object.entries<any>(ts)) {
      const adjustedClose = values['5. adjusted close'];
      const dividendAmount = values['7. dividend amount'];
      monthly[date] = {
        open: parseFloat(values['1. open']),
        high: parseFloat(values['2. high']),
        low: parseFloat(values['3. low']),
        close: parseFloat(values['4. close']),
        ...(adjustedClose !== undefined ? { adjustedClose: parseFloat(adjustedClose) } : {}),
        volume: parseInt(values['6. volume'] ?? values['5. volume'], 10),
        ...(dividendAmount !== undefined ? { dividendAmount: parseFloat(dividendAmount) } : {}),
      };
    }

    return { meta, series: { [TimeSeriesInterval.MONTHLY]: monthly } };
  }

  protected getBarsForStorage(transformed: AvTimeSeriesNormalized): StorageBar[] | null {
    const monthly = transformed?.series?.[TimeSeriesInterval.MONTHLY];
    if (!monthly) return null;
    const bars: StorageBar[] = Object.entries(monthly).map(([date, v]) => ({
      date,
      open: Number(v.open),
      high: Number(v.high),
      low: Number(v.low),
      close: Number(v.adjustedClose ?? v.close),
      volume: Number(v.volume),
    }));
    if (!bars.length) return null;
    return sortAndComputeChange(bars);
  }
}
