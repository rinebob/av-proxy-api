import { onDocumentCreated } from 'firebase-functions/v2/firestore';
import { db, FieldValue } from '../../../firebase-admin-init';
import { Timestamp } from 'firebase-admin/firestore';

import { AlphaVantageEndpoint,
    OutputSize,
    DailyTimeSeriesDataTwo,
    TimeSeriesDocument,
    TimeSeriesInterval } from '@shared/alpha-vantage';
import { ApiProvider } from '@shared/core';
import { FirestoreCollection, RefreshStatus, RefreshTrigger } from '@shared/firestore';

import { AlphaVantageHandlerFactory } from '../alpha-vantage-factory';
import { RefreshLoggerService } from '../../services/refresh-logger.service';
import { getSymbolTimeSeriesDocPath } from '../../common/firestore/firestore-paths';

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
    // Get the Alpha Vantage handler for daily time series
    const handler = AlphaVantageHandlerFactory.createHandler(AlphaVantageEndpoint.TIME_SERIES_DAILY);
    
    // Fetch the time series data with required parameters
    const timeSeriesResponse = await handler.fetch({
      symbol,
      outputsize: OutputSize.FULL,
      datatype: 'json'
    });

    console.log(`oSA.f oSA: Time series response: ${JSON.stringify(timeSeriesResponse.data.slice(0, 5))}`);
    
    // Limit data in non-production environments to prevent emulator issues
    const isProduction = process.env.NODE_ENV === 'production' || process.env.FUNCTIONS_EMULATOR !== 'true';
    const processedData = isProduction 
      ? timeSeriesResponse.data 
      : timeSeriesResponse.data.slice(0, 10); // Only keep 10 data points for testing

    // Prepare the time series data for Firestore
    const batch = db.batch();
    
    // Reference to the time series document (canonical path)
    const docPath = getSymbolTimeSeriesDocPath(symbol, AlphaVantageEndpoint.TIME_SERIES_DAILY, ApiProvider.ALPHA_VANTAGE);
    console.log(`oSA.f oSA: Time series document path: ${docPath}`);
    const timeSeriesRef = db.doc(docPath);
    
    // Calculate tomorrow's date
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    
    // Create the document data with proper typing
    const metadata = RefreshLoggerService.getInitialTimeSeriesMetadata(
      processedData,
      symbol,
      TimeSeriesInterval.DAILY
    );

    console.log(`oSA.f oSA: Time series metadata: ${JSON.stringify(metadata)}`);

    // Augment metadata with refresh tracking fields
    const now = FieldValue.serverTimestamp();
    const nextRefreshAt = FieldValue.serverTimestamp();

    // --- Create initial refresh event for refreshHistory ---
    const initialRefreshEvent = {
      eventId: `initial-${symbol}-${Date.now()}`,
      triggeredBy: RefreshTrigger.SYMBOL_ADDED,
      refreshedAt: Timestamp.now(),
      refreshedBy: RefreshTrigger.SYMBOL_ADDED,
      durationMs: 0,
      nextRefreshAt: Timestamp.now(),
      nextRefreshBy: '',
      ttlHuman: '', // Set if you have a TTL string
      status: RefreshStatus.SUCCESS,
      errorDetails: null
    };

    const timeSeriesDoc: TimeSeriesDocument<DailyTimeSeriesDataTwo> = {
      data: processedData,
      metadata,
      refreshHistory: [initialRefreshEvent]
    };
    
    // Add the time series data to the batch
    batch.set(timeSeriesRef, timeSeriesDoc, { merge: true });

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

    console.log(`oSA.f oSA: ------------ save to firestore (${isProduction ? 'production' : 'dev'} mode) ------------`);
    // Commit the batch
    await batch.commit();

    console.log(`oSA.f oSA: Successfully saved time series data for symbol: ${symbol}`, {
      dataPoints: processedData.length,
      firstDate: processedData[processedData.length - 1]?.date,
      lastDate: processedData[0]?.date,
      isEmulator: !isProduction
    });

    console.log(`============= END SYMBOL ADD FOR: ${symbol} =============`);
    
    return { 
      success: true, 
      symbol, 
      dataPoints: processedData.length 
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    console.error(`oSA.f oSA: Error processing time series for ${symbol}: ${errorMessage}`);
    return { success: false, symbol, error: errorMessage };
  }
});
