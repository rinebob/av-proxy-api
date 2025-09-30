import { AlphaVantageTimeSeriesHandlerBase, StorageBar } from './alpha-vantage-timeseries-base.handler';
import { validateAlphaVantageApiResponse } from '../utils/av-response-utils';
import type { AvCommonMeta, AvOhlcEntry, AvTimeSeriesNormalized } from '@shared/alpha-vantage';
import { TimeSeriesInterval } from '@shared/alpha-vantage';

/**
 * Handler class for Alpha Vantage TIME_SERIES_DAILY(_ADJUSTED)
 */
export class AvDailyTimeSeriesHandler extends AlphaVantageTimeSeriesHandlerBase<AvTimeSeriesNormalized> {
  /**
   * Transform AV JSON to unified normalized response
   */
  protected transformResponse(raw: any): AvTimeSeriesNormalized {
    validateAlphaVantageApiResponse(raw);
    const metaRaw = raw['Meta Data'] || {};
    const timeSeriesRaw = raw['Time Series (Daily)'] || raw['Time Series Daily'];
    if (!timeSeriesRaw) {
      throw new Error('Invalid response format: Missing Time Series (Daily)');
    }

    const meta: AvCommonMeta = {
      information: metaRaw['1. Information'] ?? metaRaw['Information'],
      symbol: metaRaw['2. Symbol'] ?? metaRaw['Symbol'],
      lastRefreshed: metaRaw['3. Last Refreshed'] ?? metaRaw['Last Refreshed'],
      outputSize: metaRaw['4. Output Size'] ?? metaRaw['Output Size'],
      timeZone: metaRaw['5. Time Zone'] ?? metaRaw['Time Zone'],
    };

    const daily: Record<string, AvOhlcEntry> = {};
    for (const [date, values] of Object.entries<any>(timeSeriesRaw)) {
      // Daily adjusted has adjusted close and dividend (and split coefficient)
      const adjustedClose = values['5. adjusted close'];
      const dividendAmount = values['7. dividend amount'];
      const splitCoefficient = values['8. split coefficient'];
      daily[date] = {
        open: parseFloat(values['1. open']),
        high: parseFloat(values['2. high']),
        low: parseFloat(values['3. low']),
        close: parseFloat(values['4. close']),
        // Optional adjusted fields (present for adjusted endpoint)
        ...(adjustedClose !== undefined ? { adjustedClose: parseFloat(adjustedClose) } : {}),
        volume: parseInt(values['6. volume'] ?? values['5. volume'], 10),
        ...(dividendAmount !== undefined ? { dividendAmount: parseFloat(dividendAmount) } : {}),
        ...(splitCoefficient !== undefined ? { splitCoefficient: parseFloat(splitCoefficient) } : {}),
      };
    }

    return { meta, series: { [TimeSeriesInterval.DAILY]: daily } };
  }

  /**
   * Derive compact bars array for storage from the normalized object.
   */
  protected toBarsArray(seriesByDate: Record<string, AvOhlcEntry>): StorageBar[] {
    // Turn map into array
    const entries = Object.entries(seriesByDate).map(([date, v]) => ({ date, v }));
    // Sort ascending by date so we can compute previousClose and deltas deterministically
    entries.sort((a, b) => new Date(`${a.date}T00:00:00.000Z`).getTime() - new Date(`${b.date}T00:00:00.000Z`).getTime());

    let prevAdjClose: number | undefined = undefined;
    const out: StorageBar[] = [];
    for (const { date, v } of entries) {
      const closeForStorage = Number((v as AvOhlcEntry).adjustedClose ?? v.close);
      const previousClose = prevAdjClose;
      const change = previousClose != null ? (closeForStorage - previousClose) : undefined;
      const changePercent = previousClose != null && previousClose !== 0 ? (change! / previousClose) * 100 : undefined;

      out.push({
        date,
        open: Number(v.open),
        high: Number(v.high),
        low: Number(v.low),
        // Prefer adjustedClose when present for storage default
        close: closeForStorage,
        volume: Number(v.volume),
        // Preserve optional adjusted series fields when present
        ...(v.adjustedClose != null ? { adjustedClose: Number(v.adjustedClose) } : {}),
        ...(v.dividendAmount != null ? { dividendAmount: Number(v.dividendAmount) } : {}),
        ...(v.splitCoefficient != null ? { splitCoefficient: Number(v.splitCoefficient) } : {}),
        // Derived fields for consistency with 2025 bars
        ...(previousClose != null ? { previousClose } : {}),
        ...(change != null ? { change } : {}),
        ...(changePercent != null ? { changePercent } : {}),
      });

      prevAdjClose = closeForStorage;
    }

    return out;
  }

  /**
   * Provide bars to the base class for storage persistence.
   */
  protected getBarsForStorage(transformed: AvTimeSeriesNormalized): StorageBar[] | null {
    const daily = transformed?.series?.[TimeSeriesInterval.DAILY];
    if (!daily) return null;
    const bars = this.toBarsArray(daily);
    if (!bars.length) return null;
    return bars;
  }
}
