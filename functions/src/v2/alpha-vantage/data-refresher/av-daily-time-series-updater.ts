import { onSchedule } from 'firebase-functions/v2/scheduler';
import { Timestamp } from 'firebase-admin/firestore';
import { AlphaVantageHandlerFactory } from '../alpha-vantage-factory';
import { AlphaVantageEndpoint } from '../../common/common-av';
import { db } from '../../../firebase-admin-init';
import { FirestoreCollection } from '../../common/firestore/firestore-collections';
import { getSymbolTimeSeriesDocPath } from '../../common/firestore/firestore-paths';
import { DAILY_TIME_SERIES_UPDATE_SCHEDULE } from '../../common/function-schedules';
import { ApiProvider } from '../../common/data-providers';
import { initializeTimeSeriesIfMissing } from '../firestore/av-firestore-helper';
import { TimeSeriesInterval } from '../../common/common-fn';

// Helper function to update daily time series with latest quote
async function updateDailyTimeSeriesWithQuote(symbol: string): Promise<boolean> {
  const globalQuoteEndpoint = AlphaVantageEndpoint.GLOBAL_QUOTE;
  const now = Timestamp.now();
  
  // Reference to the daily data document (canonical path)
  const dailyDataDocPath = getSymbolTimeSeriesDocPath(symbol, AlphaVantageEndpoint.TIME_SERIES_DAILY, ApiProvider.ALPHA_VANTAGE);
  const dailyDataRef = db.doc(dailyDataDocPath);
  
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
    let dailyDoc = await dailyDataRef.get();
    
    if (!dailyDoc.exists) {
      const initialized = await initializeTimeSeriesIfMissing(symbol, TimeSeriesInterval.DAILY, globalQuoteEndpoint);
      if (!initialized) return false;
      console.log(`dTSU uDTSWQ [${symbol}] No daily time series data found. Loading initial data.`);
      dailyDoc = await dailyDataRef.get();
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
 * Core handler function that can be called directly or via the scheduled function
 */
export async function updateDailyTimeSeriesHandler() {
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
      console.log(`dTSU uDTS Processing batch ${i / BATCH_SIZE + 1} of ${Math.ceil(symbols.length / BATCH_SIZE)}`);
      
      // Process batch in parallel
      const results = await Promise.allSettled(
        batch.map(symbol => updateDailyTimeSeriesWithQuote(symbol))
      );

      // Process results
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
}

/**
 * Scheduled function that runs daily to update all tracked symbols
 * with the latest trading data from the global quote endpoint.
 */
export const updateDailyTimeSeries = onSchedule({
  schedule: DAILY_TIME_SERIES_UPDATE_SCHEDULE,
  timeZone: 'America/New_York',
  secrets: ['ALPHAVANTAGE_API_KEY'],
}, updateDailyTimeSeriesHandler);
