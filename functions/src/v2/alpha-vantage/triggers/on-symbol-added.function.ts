import { onDocumentCreated } from 'firebase-functions/v2/firestore';
import { AlphaVantageEndpoint, OutputSize, TimeSeriesDocument, DailyTimeSeriesDataTwo } from '../../common/common-av';
import { AlphaVantageHandlerFactory } from '../alpha-vantage-factory';
import { db, FieldValue } from '../../../firebase-admin-init';
import { FirestoreCollection } from '../../common/firestore/firestore-collections';
import { ApiProvider } from '../../common/data-providers';
import { RefreshLoggerService } from '../../services/refresh-logger.service';
import { TimeSeriesInterval } from '../../common/common-fn';
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

    console.log(`oSA.f oSA: Time series response: ${JSON.stringify(timeSeriesResponse)}`);
    
    // Limit data in non-production environments to prevent emulator issues
    const isProduction = process.env.NODE_ENV === 'production' || process.env.FUNCTIONS_EMULATOR !== 'true';
    const processedData = isProduction 
      ? timeSeriesResponse.data 
      : timeSeriesResponse.data.slice(0, 10); // Only keep 10 data points for testing

    // Prepare the time series data for Firestore
    const batch = db.batch();
    
    // Reference to the time series document (canonical path)
    const docPath = getSymbolTimeSeriesDocPath(symbol, AlphaVantageEndpoint.TIME_SERIES_DAILY, ApiProvider.ALPHA_VANTAGE);
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

    const timeSeriesDoc: TimeSeriesDocument<DailyTimeSeriesDataTwo> = {
      data: processedData,
      metadata,
      refreshHistory: []
    };
    
    // Add the time series data to the batch
    batch.set(timeSeriesRef, timeSeriesDoc, { merge: true });

    console.log(`oSA.f oSA: ------------ save to firestore (${isProduction ? 'production' : 'test'} mode) ------------`);
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
