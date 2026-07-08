import { onDocumentCreated } from 'firebase-functions/v2/firestore';
import { db, FieldValue } from '../../../firebase-admin-init';

import {
  AlphaVantageEndpoint,
  OutputSize,
  TimeSeriesInterval,
} from '@shared/alpha-vantage';
import { FirestoreCollection, RefreshTrigger, RefreshStatus } from '@shared/firestore';
import { ApiProvider } from '@shared/core';

import { AlphaVantageHandlerFactory } from '../alpha-vantage-factory';
import { HealthMetricsService } from '../../health-metrics/health-metrics.service';
import { getSymbolTimeSeriesDocPath } from '../../common/firestore/firestore-paths';
import { publishSymbolAddedBatch } from '../../partner/symbol-added.publisher';
import type { SymbolAddedPayloadV1 } from '../../partner/schemas/symbol-added.schema';

const AVAILABLE_INTERVALS = [
  TimeSeriesInterval.DAILY,
  TimeSeriesInterval.WEEKLY,
  TimeSeriesInterval.MONTHLY,
];

interface EnsureIntervalOptions {
  /** When provided, passes `outputsize` to the AV handler. */
  outputsize?: OutputSize;
  /** When true, skips the fetch if the canonical split-adjusted parent doc already exists. */
  skipIfParentExists?: boolean;
}

/**
 * Fetch time-series data for a single symbol/interval.
 *
 * - If `skipIfParentExists` is true and the canonical `sa-time-series` parent doc
 *   already exists, returns true without making an AV call.
 * - Otherwise creates the appropriate AV handler, calls `fetch`, records a health
 *   metric on success, and returns true/false to indicate outcome.
 */
async function ensureIntervalData(
  symbol: string,
  endpoint: AlphaVantageEndpoint,
  hms: HealthMetricsService,
  options: EnsureIntervalOptions = {},
): Promise<boolean> {
  if (options.skipIfParentExists) {
    const parentPath = getSymbolTimeSeriesDocPath(
      symbol,
      endpoint,
      ApiProvider.ALPHA_VANTAGE,
      true, // isSplitAdjusted -> sa-time-series
    );
    const parentRef = db.doc(parentPath);
    const parentSnap = await parentRef.get();
    if (parentSnap.exists) {
      console.log(`oSA.f oSA: ${endpoint} time-series already present for ${symbol}, skipping full-history backfill.`);
      return true;
    }
  }

  const startedAt = Date.now();
  try {
    console.log(`oSA.f oSA: Starting ${endpoint} fetch for symbol: ${symbol}`);
    const handler = AlphaVantageHandlerFactory.createHandler(endpoint);
    const fetchParams: { symbol: string; datatype: string; outputsize?: string } = {
      symbol,
      datatype: 'json',
    };
    if (options.outputsize) {
      fetchParams.outputsize = options.outputsize;
    }
    await handler.fetch(fetchParams);

    await hms.recordSymbolRefresh(
      endpoint,
      symbol,
      RefreshStatus.SUCCESS,
      Date.now() - startedAt,
      undefined,
      { trigger: RefreshTrigger.SYMBOL_ADDED }
    );

    console.log(`oSA.f oSA: Completed ${endpoint} fetch for ${symbol} in ${Date.now() - startedAt}ms`);
    return true;
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    console.error(`oSA.f oSA: Error fetching ${endpoint} for ${symbol}: ${errorMessage}`);
    return false;
  }
}

/**
 * Cloud Function that triggers when a new symbol is added to the tracked-symbols collection.
 * Fetches DAILY, WEEKLY, and MONTHLY adjusted history independently, then publishes a
 * `partner-symbol-added` message when all intervals are available in Firestore.
 */
export const onSymbolAdded = onDocumentCreated(
  {
    document: `${FirestoreCollection.TRACKED_SYMBOLS}/{symbol}`,
    secrets: ['ALPHAVANTAGE_API_KEY'],
    memory: '1GiB',
  },
  async (event) => {
    const symbol = event.params.symbol.toUpperCase();
    const symbolData = event.data?.data();

    if (!symbolData) {
      console.error('oSA.f oSA: No data found for symbol:', symbol);
      return;
    }

    console.log(`============= START SYMBOL ADD FOR: ${symbol} =============`);
    console.log(`oSA.f oSA: New symbol tracked: ${symbol}`, {
      region: symbolData.region,
      matchScore: symbolData.matchScore,
      timestamp: new Date().toISOString(),
    });

    const hms = new HealthMetricsService();
    const startedAt = Date.now();

    // Fetch each interval independently in parallel. A failure in one interval
    // does not block the others, but the onboarding message is only sent when all
    // three intervals are available.
    const [dailyOk, weeklyOk, monthlyOk] = await Promise.all([
      ensureIntervalData(symbol, AlphaVantageEndpoint.TIME_SERIES_DAILY_ADJUSTED, hms, {
        outputsize: OutputSize.FULL,
      }),
      ensureIntervalData(symbol, AlphaVantageEndpoint.TIME_SERIES_WEEKLY_ADJUSTED, hms, {
        skipIfParentExists: true,
      }),
      ensureIntervalData(symbol, AlphaVantageEndpoint.TIME_SERIES_MONTHLY_ADJUSTED, hms, {
        skipIfParentExists: true,
      }),
    ]);

    const allOk = dailyOk && weeklyOk && monthlyOk;

    if (allOk) {
      // Ensure a minimal symbol-data/{symbol} document exists with the new
      // metadata fields. Time-series bars themselves are persisted by the
      // Alpha Vantage handlers above.
      const symbolDocRef = db.doc(`${FirestoreCollection.SYMBOL_DATA}/${symbol}`);
      await symbolDocRef.set(
        {
          createdAt: FieldValue.serverTimestamp(),
          createdBy: 'on-symbol-added',
        },
        { merge: true },
      );

      // Notify partner consumers that this symbol is ready for full-history fetch.
      const payload: SymbolAddedPayloadV1 = {
        version: 'v1',
        symbols: [symbol],
        addedAtUTC: new Date().toISOString(),
        status: 'ready',
        availableIntervals: AVAILABLE_INTERVALS,
      };

      try {
        await publishSymbolAddedBatch(payload, { symbol });
      } catch (pubErr: any) {
        const errorMessage = pubErr instanceof Error ? pubErr.message : String(pubErr);
        console.error(`oSA.f oSA: Failed to publish symbol-added message for ${symbol}: ${errorMessage}`);
        // Do not fail the whole function because the Pub/Sub publish failed;
        // the symbol data is already persisted. Logs will surface the issue.
      }

      console.log(`oSA.f oSA: Successfully initialized D/W/M adjusted time series for symbol: ${symbol}`);
    } else {
      console.error(
        `oSA.f oSA: Symbol onboarding incomplete for ${symbol}. ` +
        `daily=${dailyOk} weekly=${weeklyOk} monthly=${monthlyOk}`
      );
    }

    const durationMs = Date.now() - startedAt;
    console.log(`============= END SYMBOL ADD FOR: ${symbol} (${durationMs}ms, allOk=${allOk}) =============`);
  }
);
