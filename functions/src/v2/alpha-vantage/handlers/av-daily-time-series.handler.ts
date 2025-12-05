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
      information: metaRaw['1. Information'],
      symbol: metaRaw['2. Symbol'],
      lastRefreshed: metaRaw['3. Last Refreshed'],
      outputSize: metaRaw['4. Output Size'],
      timeZone: metaRaw['5. Time Zone'],
    };

    const daily: Record<string, AvOhlcEntry> = {};
    for (const [date, values] of Object.entries<any>(timeSeriesRaw)) {
      // TIME_SERIES_DAILY_ADJUSTED guarantees adjusted close, dividend amount, and split coefficient
      const adjustedClose = values['5. adjusted close'];
      const dividendAmount = values['7. dividend amount'];
      const splitCoefficient = values['8. split coefficient'];
      daily[date] = {
        open: parseFloat(values['1. open']),
        high: parseFloat(values['2. high']),
        low: parseFloat(values['3. low']),
        close: parseFloat(values['4. close']),
        adjustedClose: parseFloat(adjustedClose),
        volume: parseInt(values['6. volume'] ?? values['5. volume'], 10),
        dividendAmount: parseFloat(dividendAmount),
        splitCoefficient: parseFloat(splitCoefficient),
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

    // Track previous RAW close as baseline for deltas
    let prevClose: number | undefined = undefined;
    const out: StorageBar[] = [];
    for (const { date, v } of entries) {
      const rawClose = Number(v.close);
      const previousClose = prevClose;
      const change = previousClose != null ? (rawClose - previousClose) : undefined;
      const changePercent = previousClose != null && previousClose !== 0 ? (change! / previousClose) * 100 : undefined;

      out.push({
        date,
        open: Number(v.open),
        high: Number(v.high),
        low: Number(v.low),
        // Always persist RAW close from provider for candlesticks and deltas
        close: rawClose,
        volume: Number(v.volume),
        // DAILY_ADJUSTED guarantees these fields, so always set them
        adjustedClose: Number(v.adjustedClose),
        dividendAmount: Number(v.dividendAmount),
        splitCoefficient: Number(v.splitCoefficient),
        // Derived fields for consistency with 2025 bars
        ...(previousClose != null ? { previousClose } : {}),
        ...(change != null ? { change } : {}),
        ...(changePercent != null ? { changePercent } : {}),
      });

      prevClose = rawClose;
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
