import type { StorageBar } from '../handlers/alpha-vantage-timeseries-base.handler';
import { parseIsoDateMs } from './date-utils';

/**
 * Sorts bars ascending by ISO date. No change metrics are computed or persisted.
 */
export function sortAndComputeChange(bars: StorageBar[]): StorageBar[] {
  if (!Array.isArray(bars) || bars.length === 0) return bars;

  // Sort ascending
  bars.sort((a, b) => parseIsoDateMs(a.date) - parseIsoDateMs(b.date));

  return bars;
}
