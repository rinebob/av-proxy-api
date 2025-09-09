import { AlphaVantageTimeSeriesHandlerBase, StorageBar } from './alpha-vantage-timeseries-base.handler';
import { validateAlphaVantageApiResponse } from '../utils/av-response-utils';

/**
 * Normalized meta data for AV Daily responses
 */
interface AvDailyMeta {
  information?: string;
  symbol?: string;
  lastRefreshed?: string;
  outputSize?: string;
  timeZone?: string;
}

/**
 * Normalized time series entry for AV Daily responses
 */
interface AvDailyEntry {
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  adjustedClose?: number;
  dividendAmount?: number;
  splitCoefficient?: number;
}

/**
 * Normalized response for AV Daily responses
 */
interface AvDailyNormalizedResponse {
  meta: AvDailyMeta;
  timeSeriesDaily: Record<string, AvDailyEntry>;
}

/**
 * Handler for Alpha Vantage TIME_SERIES_DAILY (and DAILY_ADJUSTED via factory mapping).
 * Returns an AV-like normalized object for the UI, with sane keys, and saves compact bars to Firestore.
 */
export class AvDailyTimeSeriesHandler extends AlphaVantageTimeSeriesHandlerBase<AvDailyNormalizedResponse> {
  /**
   * Transform AV raw JSON into an AV-like normalized object with clean keys.
   */
  protected transformResponse(raw: any): AvDailyNormalizedResponse {
    validateAlphaVantageApiResponse(raw);
    const metaRaw = raw['Meta Data'] || {};
    const tsRaw = raw['Time Series (Daily)'];
    if (!tsRaw) {
      throw new Error('Invalid response format: Missing Time Series (Daily)');
    }
    // Normalize meta keys to camelCase
    const meta: AvDailyMeta = {
      information: metaRaw['1. Information'] ?? metaRaw['Information'],
      symbol: metaRaw['2. Symbol'] ?? metaRaw['Symbol'],
      lastRefreshed: metaRaw['3. Last Refreshed'] ?? metaRaw['Last Refreshed'],
      outputSize: metaRaw['4. Output Size'] ?? metaRaw['Output Size'],
      timeZone: metaRaw['5. Time Zone'] ?? metaRaw['Time Zone'],
    };

    // Normalize time series keys: keep by-date map, but clean field names
    const timeSeriesDaily: Record<string, AvDailyEntry> = {};
    for (const [date, values] of Object.entries<any>(tsRaw)) {
      const adjustedClose = values['5. adjusted close'];
      const dividendAmount = values['7. dividend amount'];
      const splitCoefficient = values['8. split coefficient'];
      timeSeriesDaily[date] = {
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

    return { meta, timeSeriesDaily };
  }

  /**
   * Derive compact bars array for storage from the normalized object.
   */
  protected toBarsArray(timeSeriesDaily: Record<string, AvDailyEntry>): StorageBar[] {
    // AV returns newest-first in the API; order is not guaranteed in object keys. We preserve as-is; storage will handle sorting.
    return Object.entries(timeSeriesDaily).map(([date, v]) => ({
      date,
      open: Number(v.open),
      high: Number(v.high),
      low: Number(v.low),
      // Prefer adjustedClose when present for storage default
      close: Number((v as AvDailyEntry).adjustedClose ?? v.close),
      volume: Number(v.volume),
      // Preserve optional adjusted series fields when present
      ...(v.adjustedClose != null ? { adjustedClose: Number(v.adjustedClose) } : {}),
      ...(v.dividendAmount != null ? { dividendAmount: Number(v.dividendAmount) } : {}),
      ...(v.splitCoefficient != null ? { splitCoefficient: Number(v.splitCoefficient) } : {}),
    }));
  }

  /**
   * Provide bars to the base class for storage persistence.
   */
  protected getBarsForStorage(transformed: AvDailyNormalizedResponse): StorageBar[] | null {
    if (!transformed?.timeSeriesDaily) return null;
    const bars = this.toBarsArray(transformed.timeSeriesDaily);
    return bars.length ? bars : null;
  }
}
