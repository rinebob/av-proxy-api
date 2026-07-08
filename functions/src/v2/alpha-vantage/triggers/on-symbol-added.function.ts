import { onDocumentCreated } from 'firebase-functions/v2/firestore';
import { db, FieldValue } from '../../../firebase-admin-init';

import {
  AlphaVantageEndpoint,
  OutputSize,
} from '@shared/alpha-vantage';
import { FirestoreCollection, RefreshTrigger, RefreshStatus } from '@shared/firestore';
import { ApiProvider } from '@shared/core';

import { AlphaVantageHandlerFactory } from '../alpha-vantage-factory';
import { HealthMetricsService } from '../../health-metrics/health-metrics.service';
import { getSymbolTimeSeriesDocPath } from '../../common/firestore/firestore-paths';

/**
 * Cloud Function that triggers when a new symbol is added to the tracked-symbols collection.
 * Fetches the full time series data for the symbol and saves it to the time-series collection.
 */
export const onSymbolAdded = onDocumentCreated(
  {
    document: `${FirestoreCollection.TRACKED_SYMBOLS}/{symbol}`,
    secrets: ['ALPHAVANTAGE_API_KEY'],
    memory: '1GiB',
  },
  async (event) => {
    // Convert symbol to uppercase immediately when we get it
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
      timestamp: FieldValue.serverTimestamp()
    });

    try {
      const hms = new HealthMetricsService();
      const startedAt = Date.now();
      // Get the Alpha Vantage handler for adjusted daily time series
      const dailyHandler = AlphaVantageHandlerFactory.createHandler(AlphaVantageEndpoint.TIME_SERIES_DAILY_ADJUSTED);

      // Fetch the full daily time series data and let the handler
      // persist sharded bars and metadata (year-sharded DAILY_ADJUSTED)
      await dailyHandler.fetch({
        symbol,
        outputsize: OutputSize.FULL,
        datatype: 'json',
      });
      const durationMs = Date.now() - startedAt;

      // Ensure WEEKLY full-history exists: only backfill if adjusted parent doc is missing.
      // We now treat sa-time-series as the sole canonical store for AV OHLCV bars.
      const weeklyParentPath = getSymbolTimeSeriesDocPath(
        symbol,
        AlphaVantageEndpoint.TIME_SERIES_WEEKLY_ADJUSTED,
        ApiProvider.ALPHA_VANTAGE,
        true, // isSplitAdjusted -> sa-time-series
      );
      const weeklyParentRef = db.doc(weeklyParentPath);
      const weeklyParentSnap = await weeklyParentRef.get();
      if (!weeklyParentSnap.exists) {
        console.log(`oSA.f oSA: Starting weekly full-history backfill for symbol: ${symbol}`);
        const weeklyHandler = AlphaVantageHandlerFactory.createHandler(
          AlphaVantageEndpoint.TIME_SERIES_WEEKLY_ADJUSTED
        );

        const weeklyStartedAt = Date.now();
        await weeklyHandler.fetch({
          symbol,
          datatype: 'json',
        });

        const weeklyDurationMs = Date.now() - weeklyStartedAt;

        console.log(`oSA.f oSA: Completed weekly full-history backfill for ${symbol} in ${weeklyDurationMs}ms`);

        await hms.recordSymbolRefresh(
          AlphaVantageEndpoint.TIME_SERIES_WEEKLY_ADJUSTED as any,
          symbol,
          RefreshStatus.SUCCESS,
          weeklyDurationMs,
          undefined,
          { trigger: RefreshTrigger.SYMBOL_ADDED }
        );
      } else {
        console.log(`oSA.f oSA: Weekly time-series already present for ${symbol}, skipping full-history backfill.`);
      }

      // Ensure MONTHLY full-history exists: only backfill if adjusted parent doc is missing.
      const monthlyParentPath = getSymbolTimeSeriesDocPath(
        symbol,
        AlphaVantageEndpoint.TIME_SERIES_MONTHLY_ADJUSTED,
        ApiProvider.ALPHA_VANTAGE,
        true, // isSplitAdjusted -> sa-time-series
      );
      const monthlyParentRef = db.doc(monthlyParentPath);
      const monthlyParentSnap = await monthlyParentRef.get();
      if (!monthlyParentSnap.exists) {
        console.log(`oSA.f oSA: Starting monthly full-history backfill for symbol: ${symbol}`);
        const monthlyHandler = AlphaVantageHandlerFactory.createHandler(
          AlphaVantageEndpoint.TIME_SERIES_MONTHLY_ADJUSTED
        );

        const monthlyStartedAt = Date.now();
        await monthlyHandler.fetch({
          symbol,
          datatype: 'json',
        });

        const monthlyDurationMs = Date.now() - monthlyStartedAt;

        console.log(`oSA.f oSA: Completed monthly full-history backfill for ${symbol} in ${monthlyDurationMs}ms`);

        await hms.recordSymbolRefresh(
          AlphaVantageEndpoint.TIME_SERIES_MONTHLY_ADJUSTED as any,
          symbol,
          RefreshStatus.SUCCESS,
          monthlyDurationMs,
          undefined,
          { trigger: RefreshTrigger.SYMBOL_ADDED }
        );
      } else {
        console.log(`oSA.f oSA: Monthly time-series already present for ${symbol}, skipping full-history backfill.`);
      }

      // Ensure a minimal symbol-data/{symbol} document exists with the new
      // metadata fields. Time-series bars themselves are persisted by the
      // Alpha Vantage handlers above.
      const symbolDocRef = db.doc(`${FirestoreCollection.SYMBOL_DATA}/${symbol}`);
      await symbolDocRef.set(
        {
          createdAt: FieldValue.serverTimestamp(),
          createdBy: 'bulk-import',
        },
        { merge: true },
      );

      // Record request log and endpoint-symbols status for visibility
      await hms.recordSymbolRefresh(
        AlphaVantageEndpoint.TIME_SERIES_DAILY_ADJUSTED as any,
        symbol,
        RefreshStatus.SUCCESS,
        durationMs,
        undefined,
        { trigger: RefreshTrigger.SYMBOL_ADDED }
      );

      console.log(`oSA.f oSA: Successfully initialized adjusted daily time series for symbol: ${symbol}`);

      console.log(`============= END SYMBOL ADD FOR: ${symbol} =============`);

      return {
        success: true,
        symbol
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      console.error(`oSA.f oSA: Error processing time series for ${symbol}: ${errorMessage}`);
      return { success: false, symbol, error: errorMessage };
    }
  }
);
