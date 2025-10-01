import { onDocumentCreated } from 'firebase-functions/v2/firestore';
import { db, FieldValue } from '../../../firebase-admin-init';

import {
  AlphaVantageEndpoint,
  OutputSize,
  TimeSeriesInterval
} from '@shared/alpha-vantage';
import { FirestoreCollection, RefreshTrigger, RefreshStatus } from '@shared/firestore';

import { AlphaVantageHandlerFactory } from '../alpha-vantage-factory';
import { RefreshLoggerService } from '../../services/refresh-logger.service';
import { HealthMetricsService } from '../../health-metrics/health-metrics.service';

/**
 * Cloud Function that triggers when a new symbol is added to the tracked-symbols collection.
 * Fetches the full time series data for the symbol and saves it to the time-series collection.
 */
export const onSymbolAdded = onDocumentCreated(
  {
    document: `${FirestoreCollection.TRACKED_SYMBOLS}/{symbol}`,
    secrets: ['ALPHAVANTAGE_API_KEY'],
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
      const handler = AlphaVantageHandlerFactory.createHandler(AlphaVantageEndpoint.TIME_SERIES_DAILY_ADJUSTED);

      // Fetch the time series data with required parameters and let the handler
      // persist sharded bars and metadata (year-sharded DAILY_ADJUSTED)
      await handler.fetch({
        symbol,
        outputsize: OutputSize.FULL,
        datatype: 'json',
        __checkWriteToggle: false // backend-triggered init should bypass manual write toggle
      });
      const durationMs = Date.now() - startedAt;

      // Calculate tomorrow's date
      const tomorrow = new Date();
      tomorrow.setDate(tomorrow.getDate() + 1);

      // Create the document data with proper typing
      const metadata = RefreshLoggerService.getInitialTimeSeriesMetadata(
        [], // initial metadata; actual bars persisted by handler
        symbol,
        TimeSeriesInterval.DAILY
      );

      console.log(`oSA.f oSA: Time series metadata: ${JSON.stringify(metadata)}`);

      // Augment metadata with refresh tracking fields
      const now = FieldValue.serverTimestamp();
      const nextRefreshAt = FieldValue.serverTimestamp();

      // Only write symbol-level metadata here (time series persisted by handler)
      const batch = db.batch();

      // --- Add refresh metadata as symbol doc properties ---
      const symbolDocRef = db.doc(`${FirestoreCollection.SYMBOL_DATA}/${symbol}`);
      const symbolMetadata = {
        nextRefreshAt,
        nextRefreshBy: '',
        refreshedAt: now,
        refreshedBy: RefreshTrigger.SYMBOL_ADDED,
        ttlHuman: '' // TODO: set human-friendly TTL if needed
      };
      console.log(`oSA.f oSA: Symbol metadata: ${JSON.stringify(symbolMetadata)}`);
      batch.set(symbolDocRef, symbolMetadata, { merge: true });

      console.log(`oSA.f oSA: ------------ save to firestore ------------`);
      // Commit the batch
      await batch.commit();

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
