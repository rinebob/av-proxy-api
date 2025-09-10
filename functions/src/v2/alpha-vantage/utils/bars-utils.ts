import type { StorageBar } from '../handlers/alpha-vantage-timeseries-base.handler';
import { parseIsoDateMs } from './date-utils';

/**
 * Sorts bars ascending by ISO date and computes change (ch) and percent change (cp)
 * based on the immediately prior bar's close. First bar gets ch=0, cp=0.
 * Values are rounded to 2 decimals.
 */
export function sortAndComputeChange(bars: StorageBar[]): StorageBar[] {
  if (!Array.isArray(bars) || bars.length === 0) return bars;

  // Sort ascending
  bars.sort((a, b) => parseIsoDateMs(a.date) - parseIsoDateMs(b.date));

  for (let i = 0; i < bars.length; i++) {
    const curr = bars[i];
    if (i === 0) {
      curr.change = 0;
      curr.changePercent = 0;
      continue;
    }
    const priorClose = bars[i - 1].close;
    const currClose = curr.close;
    if (Number.isFinite(priorClose) && Number.isFinite(currClose) && priorClose !== 0) {
      const changeRaw = currClose - (priorClose as number);
      const percentRaw = (changeRaw / (priorClose as number)) * 100;
      curr.change = Number(changeRaw.toFixed(2));
      curr.changePercent = Number(percentRaw.toFixed(2));
    } else {
      curr.change = 0;
      curr.changePercent = 0;
    }
  }

  return bars;
}
