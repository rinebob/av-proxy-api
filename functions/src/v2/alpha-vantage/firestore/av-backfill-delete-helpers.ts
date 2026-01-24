/**
 * Shared helpers for deleting Alpha Vantage split‑adjusted time-series
 * trees prior to running a full backfill. These operate exclusively on
 * the canonical `sa-time-series` hierarchy and are safe to call multiple
 * times (idempotent deletes).
 */

import { db } from '../../../firebase-admin-init';

import { AlphaVantageEndpoint } from '@shared/alpha-vantage';
import { ApiProvider } from '@shared/core';

import {
  getSymbolTimeSeriesAllDocPath,
  getSymbolTimeSeriesDocPath,
  getSymbolTimeSeriesYearsCollectionPath,
} from '../../common/firestore/firestore-paths';
import { betterLogger } from '../../utils/utils';

const backfillLogger = betterLogger('avBF.del');

/**
 * Deletes all documents in a collection path in batches.
 */
export async function deleteCollection(path: string, batchSize = 400): Promise<number> {
  let deleted = 0;
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const snap = await db.collection(path).limit(batchSize).get();
    if (snap.empty) break;
    const batch = db.batch();
    for (const doc of snap.docs) {
      batch.delete(doc.ref);
    }
    await batch.commit();
    deleted += snap.size;
    if (snap.size < batchSize) break;
  }
  return deleted;
}

/**
 * Deletes the DAILY_ADJUSTED time-series tree for a symbol from
 * `symbol-data/{symbol}/sa-time-series`.
 */
export async function deleteDailyAdjustedForSymbol(symbol: string): Promise<void> {
  const endpoint = AlphaVantageEndpoint.TIME_SERIES_DAILY_ADJUSTED;
  const parentPath = getSymbolTimeSeriesDocPath(symbol, endpoint, ApiProvider.ALPHA_VANTAGE, true);
  const yearsPath = getSymbolTimeSeriesYearsCollectionPath(symbol, endpoint, ApiProvider.ALPHA_VANTAGE, true);
  const allDocPath = getSymbolTimeSeriesAllDocPath(symbol, endpoint, ApiProvider.ALPHA_VANTAGE, true);

  // Delete year-sharded docs
  await deleteCollection(yearsPath).catch((e: any) => {
    backfillLogger.error(
      `delete_collection_years_failed symbol=${symbol} endpoint=${endpoint} yearsPath=${yearsPath} error=${String(
        e?.message || e,
      )}`,
      {
        function: 'avBF.del',
        symbol,
        endpoint,
        yearsPath,
        error: String(e?.message || e),
      } as any,
    );
  });

  // Delete any stray `all` doc (harmless for daily)
  try {
    await db.doc(allDocPath).delete();
  } catch (e: any) {
    backfillLogger.error(
      `delete_all_doc_failed symbol=${symbol} endpoint=${endpoint} path=${allDocPath} error=${String(
        e?.message || e,
      )}`,
      {
        function: 'avBF.del',
        symbol,
        endpoint,
        path: allDocPath,
        error: String(e?.message || e),
      } as any,
    );
  }

  // Finally delete parent doc to clear stale metadata
  try {
    await db.doc(parentPath).delete();
  } catch (e: any) {
    backfillLogger.error(
      `delete_parent_doc_failed symbol=${symbol} endpoint=${endpoint} path=${parentPath} error=${String(
        e?.message || e,
      )}`,
      {
        function: 'avBF.del',
        symbol,
        endpoint,
        path: parentPath,
        error: String(e?.message || e),
      } as any,
    );
  }
}

/**
 * Deletes the WEEKLY_ADJUSTED time-series tree for a symbol from
 * `symbol-data/{symbol}/sa-time-series`.
 */
export async function deleteWeeklyAdjustedForSymbol(symbol: string): Promise<void> {
  const endpoint = AlphaVantageEndpoint.TIME_SERIES_WEEKLY_ADJUSTED;
  const parentPath = getSymbolTimeSeriesDocPath(symbol, endpoint, ApiProvider.ALPHA_VANTAGE, true);
  const yearsPath = getSymbolTimeSeriesYearsCollectionPath(symbol, endpoint, ApiProvider.ALPHA_VANTAGE, true);

  await deleteCollection(yearsPath).catch((e: any) => {
    backfillLogger.error(
      `delete_collection_weekly_years_failed symbol=${symbol} endpoint=${endpoint} yearsPath=${yearsPath} error=${String(
        e?.message || e,
      )}`,
      {
        function: 'avBF.del',
        symbol,
        endpoint,
        yearsPath,
        error: String(e?.message || e),
      } as any,
    );
  });

  try {
    await db.doc(parentPath).delete();
  } catch (e: any) {
    backfillLogger.error(
      `delete_weekly_parent_doc_failed symbol=${symbol} endpoint=${endpoint} path=${parentPath} error=${String(
        e?.message || e,
      )}`,
      {
        function: 'avBF.del',
        symbol,
        endpoint,
        path: parentPath,
        error: String(e?.message || e),
      } as any,
    );
  }
}

/**
 * Deletes the MONTHLY_ADJUSTED time-series tree for a symbol from
 * `symbol-data/{symbol}/sa-time-series`.
 */
export async function deleteMonthlyAdjustedForSymbol(symbol: string): Promise<void> {
  const endpoint = AlphaVantageEndpoint.TIME_SERIES_MONTHLY_ADJUSTED;
  const parentPath = getSymbolTimeSeriesDocPath(symbol, endpoint, ApiProvider.ALPHA_VANTAGE, true);
  const allDocPath = getSymbolTimeSeriesAllDocPath(symbol, endpoint, ApiProvider.ALPHA_VANTAGE, true);

  try {
    await db.doc(allDocPath).delete();
  } catch (e: any) {
    backfillLogger.error(
      `delete_monthly_all_doc_failed symbol=${symbol} endpoint=${endpoint} path=${allDocPath} error=${String(
        e?.message || e,
      )}`,
      {
        function: 'avBF.del',
        symbol,
        endpoint,
        path: allDocPath,
        error: String(e?.message || e),
      } as any,
    );
  }

  try {
    await db.doc(parentPath).delete();
  } catch (e: any) {
    backfillLogger.error(
      `delete_monthly_parent_doc_failed symbol=${symbol} endpoint=${endpoint} path=${parentPath} error=${String(
        e?.message || e,
      )}`,
      {
        function: 'avBF.del',
        symbol,
        endpoint,
        path: parentPath,
        error: String(e?.message || e),
      } as any,
    );
  }
}
