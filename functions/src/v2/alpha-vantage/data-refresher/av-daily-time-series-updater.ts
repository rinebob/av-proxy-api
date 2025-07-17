import { onSchedule } from 'firebase-functions/v2/scheduler';
import { Timestamp } from 'firebase-admin/firestore';
import { AlphaVantageHandlerFactory } from '../alpha-vantage-factory';
import { AlphaVantageEndpoint } from '../../common/common-av';
import { db } from '../../../firebase-admin-init';
import { FirestoreCollection } from '../../common/firestore-collections';

// Helper function to update daily time series with latest quote
async function updateDailyTimeSeriesWithQuote(symbol: string): Promise<boolean> {
  const globalQuoteEndpoint = AlphaVantageEndpoint.GLOBAL_QUOTE;
  const now = Timestamp.now();
  
  // Reference to the daily data document
  const dailyDataRef = db
    .collection(FirestoreCollection.TIME_SERIES)
    .doc(symbol)
    .collection(FirestoreCollection.DAILY)
    .doc(`av-${FirestoreCollection.DAILY}`);
  
  try {
    // 1. Fetch latest global quote
    console.log(`dTSU uDTSWQ [${symbol}] Fetching latest global quote...`);
    const quoteHandler = AlphaVantageHandlerFactory.createHandler(globalQuoteEndpoint);
    const quoteResponse = await quoteHandler.fetch({ symbol });
    
    if (!quoteResponse.data) {
      console.log(`dTSU uDTSWQ [${symbol}] No quote data received`);
      return false;
    }
    
    // 2. Get existing data
    const dailyDoc = await dailyDataRef.get();
    
    if (!dailyDoc.exists) {
      console.log(`dTSU uDTSWQ [${symbol}] No daily time series data found. Initial data should be loaded separately.`);
      return false;
    }
    
    const existingData = dailyDoc.data()?.data || [];
    const latestDate = existingData[0]?.date;
    const latestTradingDay = quoteResponse.data.latestTradingDay;
    
    // 3. If this is a new trading day (and the date is actually newer), add to the time series
    if (latestDate && new Date(latestTradingDay) > new Date(latestDate)) {
      const newDataPoint = {
        date: quoteResponse.data.latestTradingDay,
        open: parseFloat(quoteResponse.data.open),
        high: parseFloat(quoteResponse.data.high),
        low: parseFloat(quoteResponse.data.low),
        close: parseFloat(quoteResponse.data.price),
        volume: parseInt(quoteResponse.data.volume, 10),
        // Additional fields from global quote
        symbol: quoteResponse.data.symbol,
        previousClose: parseFloat(quoteResponse.data.previousClose),
        change: parseFloat(quoteResponse.data.change),
        changePercent: parseFloat(quoteResponse.data.changePercent.replace('%', '')),
      };
      
      // Add new data point to the beginning of the array
      const updatedData = [newDataPoint, ...existingData];
      
      // Update the document
      await dailyDataRef.set({
        data: updatedData,
        metadata: {
          lastUpdated: now,
          lastTradingDay: quoteResponse.data.latestTradingDay,
          lastRefreshSource: 'global-quote',
        }
      }, { merge: true });
      
      console.log(`dTSU uDTSWQ [${symbol}] Added new trading day: ${quoteResponse.data.latestTradingDay}`);
      return true;
    } else {
      console.log(`dTSU uDTSWQ [${symbol}] No new trading day data available (latest: ${latestDate})`);
      return false;
    }
  } catch (error) {
    console.error(`dTSU uDTSWQ [${symbol}] Error updating daily data:`, error);
    throw error;
  }
}

/**
 * Scheduled function that runs daily at 4:20 PM ET to update all tracked symbols
 * with the latest trading data from the global quote endpoint.
 */
export const updateDailyTimeSeries = onSchedule({
  schedule: '20 20 * * *', // 4:20 PM ET (20:20 UTC during EDT, 21:20 UTC during EST)
  timeZone: 'America/New_York',
  secrets: ['ALPHAVANTAGE_API_KEY'],
}, async () => {
  console.log('============ START DAILY DATA UPDATE ======================');
  console.log('--- dTSU uDTS Daily Time Series Update Started ---');
  const batchStart = Date.now();

  try {
    // 1. Get all tracked symbols
    const symbolsSnap = await db.collection(FirestoreCollection.TRACKED_SYMBOLS).get();
    const symbols = symbolsSnap.docs.map(doc => doc.id);
    
    if (symbols.length === 0) {
      console.log('No tracked symbols found');
      return;
    }

    console.log(`dTSU uDTS Processing ${symbols.length} tracked symbols...`);

    // 2. Process each symbol in parallel with rate limiting
    const BATCH_SIZE = 5; // Process 5 symbols at a time
    let updatedCount = 0;
    
    for (let i = 0; i < symbols.length; i += BATCH_SIZE) {
      const batch = symbols.slice(i, i + BATCH_SIZE);
      const results = await Promise.allSettled(
        batch.map(symbol => updateDailyTimeSeriesWithQuote(symbol))
      );

      // Log results
      results.forEach((result, index) => {
        const symbol = batch[index];
        if (result.status === 'fulfilled' && result.value === true) {
          updatedCount++;
        } else if (result.status === 'rejected') {
          console.error(`dTSU uDTS [${symbol}] Error:`, result.reason);
        }
      });

      // Add a small delay between batches to avoid rate limiting
      if (i + BATCH_SIZE < symbols.length) {
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
    }

    console.log(`dTSU uDTS Updated ${updatedCount} of ${symbols.length} symbols with new data`);
  } catch (error) {
    console.error('dTSU uDTS Error in daily time series update:', error);
    throw error;
  } finally {
    console.log(`dTSU uDTS --- Update completed in ${Date.now() - batchStart}ms ---`);
    console.log('dTSU uDTS ============ END DAILY DATA UPDATE ===================================');
  }
});
