import { db } from '../../firebase-admin-init';
import { Timestamp } from 'firebase-admin/firestore';
import { FirestoreCollection } from '@shared/firestore';
import { ApiProvider } from '@shared/core';
import { AlphaVantageEndpoint } from '@shared/alpha-vantage';
import { getSymbolTimeSeriesYearDocPath, getYearFromEpochMillis } from '../common/firestore/firestore-paths';

export interface DailyValidationResult {
  passed: boolean;
  summary: { totalSymbols: number; checked: number; failures: number; warnings: number };
  failures?: Array<{ symbol: string; reason: string }>; // truncated
}

/**
 * Validate the DAILY_ADJUSTED bar for the given market date across all symbols.
 * - Completeness: bar exists for targetTs
 * - Sanity: finite o/h/l/c/v; l<=h; o,h,c within [l,h]; v>=0
 * Writes a validation summary under system/time-series-status/daily-adjusted/{date}.
 */
export async function runDailyValidation(marketDate: string, targetTs: number, symbols: string[]): Promise<DailyValidationResult> {
  const y = getYearFromEpochMillis(Number(targetTs));
  const failures: Array<{ symbol: string; reason: string }> = [];
  let checked = 0;

  for (const symbol of symbols) {
    try {
      const yearDocPath = getSymbolTimeSeriesYearDocPath(symbol, AlphaVantageEndpoint.TIME_SERIES_DAILY_ADJUSTED, ApiProvider.ALPHA_VANTAGE, y);
      const snap = await db.doc(yearDocPath).get();
      const bars = (snap.get('bars') ?? []) as Array<any>;
      const b = bars.find(bb => Number(bb?.t) === Number(targetTs));
      checked++;
      if (!b) {
        failures.push({ symbol, reason: 'missing_bar' });
        continue;
      }
      const o = Number(b.o), h = Number(b.h), l = Number(b.l), c = Number(b.c), v = Number(b.v ?? 0);
      if (![o, h, l, c, v].every(Number.isFinite)) { failures.push({ symbol, reason: 'non_finite_fields' }); continue; }
      if (!(l <= h)) { failures.push({ symbol, reason: 'l_gt_h' }); continue; }
      if (!((l <= o && o <= h) && (l <= c && c <= h))) { failures.push({ symbol, reason: 'ohlc_out_of_bounds' }); continue; }
      if (v < 0) { failures.push({ symbol, reason: 'negative_volume' }); continue; }
    } catch (e: any) {
      failures.push({ symbol, reason: 'read_error' });
    }
  }

  const result: DailyValidationResult = {
    passed: failures.length === 0,
    summary: { totalSymbols: symbols.length, checked, failures: failures.length, warnings: 0 },
    failures: failures.slice(0, 500),
  };

  // Persist validation summary under STATUS doc
  try {
    const statusDocPath = `${FirestoreCollection.SYSTEM}/${FirestoreCollection.TIME_SERIES_STATUS}/${FirestoreCollection.DAILY_ADJUSTED}/${marketDate}`;
    await db.doc(statusDocPath).set({
      validation: {
        ...result.summary,
        failedSymbolsSample: result.failures,
        updatedAt: Timestamp.now(),
      }
    }, { merge: true });
  } catch {}

  return result;
}
