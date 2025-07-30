import { onSchedule } from 'firebase-functions/v2/scheduler';
import { db } from '../../../firebase-admin-init';
import { FirestoreCollection } from '../../common/firestore/firestore-collections';
import { AlphaVantageEndpoint } from '../../common/common-av';
import { AlphaVantageHandlerFactory } from '../alpha-vantage-factory';
import { AlphaVantageBulkQuotesResponse } from '../handlers/av-bulk-quote.handler';
import { getSymbolTimeSeriesDocPath } from '../../common/firestore/firestore-paths';
import { BULK_QUOTE_UPDATE_SCHEDULE } from '../../common/function-schedules';

const BATCH_SIZE = 100; // Max symbols per batch for bulk quotes
const BATCH_DELAY_MS = 1000; // 1 second delay between batches to respect rate limits

/**
 * Updates daily time series data for all tracked symbols using bulk quotes
 * This is a scheduled function that runs periodically
 */
export const _updateAllDailyTimeSeriesBulk = onSchedule({
  schedule: BULK_QUOTE_UPDATE_SCHEDULE,
  timeZone: 'America/New_York',
  secrets: ['ALPHAVANTAGE_API_KEY'],
}, async () => {
  console.log('dTSU uADTS: Starting BULK update of daily time series data');
  const startTime = Date.now();
  
  try {
    // Get all tracked symbols
    const symbolsSnapshot = await db.collection(FirestoreCollection.TRACKED_SYMBOLS).get();
    const symbols = symbolsSnapshot.docs.map(doc => doc.id);
    
    if (symbols.length === 0) {
      console.log('dTSU uADTS: No tracked symbols found');
      return;
    }
    
    console.log(`dTSU uADTS: Found ${symbols.length} symbols to update`);
    
    // Process symbols in batches
    let updatedCount = 0;
    const errors: {symbol: string; error: string}[] = [];
    
    for (let i = 0; i < symbols.length; i += BATCH_SIZE) {
      const batch = symbols.slice(i, i + BATCH_SIZE);
      console.log(`dTSU uADTS: Processing batch ${i / BATCH_SIZE + 1} of ${Math.ceil(symbols.length / BATCH_SIZE)} (${batch.length} symbols)`);
      
      try {
        // Create bulk quote handler using the factory
        const endpoint: AlphaVantageEndpoint = AlphaVantageEndpoint.REALTIME_BULK_QUOTES;
        const bulkQuoteHandler = AlphaVantageHandlerFactory.createHandler<AlphaVantageBulkQuotesResponse>(endpoint);
        
        // Fetch bulk quotes for this batch
        const response = await bulkQuoteHandler.fetch({ 
          symbols: batch.join(','), 
          datatype: 'json' 
        });
        const { quotes = [], note } = response.data || {};
        
        if (note) {
          console.warn(`dTSU uADTS: Rate limit note: ${note}`);
        }
        
        // Process each quote in the batch
        const updatePromises = quotes.map(quote => 
          updateDailyTimeSeriesWithBulkQuote(quote).catch(error => ({
            symbol: quote.symbol,
            error: error.message
          }))
        );
        
        const results = await Promise.all(updatePromises);
        
        // Count successful updates and collect errors
        const batchResults = results.map((result, index) => {
          if (result === true) {
            updatedCount++;
            return { symbol: batch[index], success: true };
          } else if (result && 'error' in result) {
            errors.push({ symbol: result.symbol, error: result.error });
            return { symbol: result.symbol, success: false, error: result.error };
          }
          return { symbol: batch[index], success: false, error: 'Unknown error' };
        });
        
        console.log(`dTSU uADTS: Batch ${i / BATCH_SIZE + 1} results:`, 
          `${batchResults.filter(r => r.success).length} updated,`,
          `${batchResults.filter(r => !r.success).length} failed`
        );
        
      } catch (error) {
        console.error(`dTSU uADTS: Error processing batch ${i / BATCH_SIZE + 1}:`, error);
        // Add all symbols in this batch to errors
        batch.forEach(symbol => {
          errors.push({ 
            symbol, 
            error: error instanceof Error ? error.message : 'Unknown error' 
          });
        });
      }
      
      // Add delay between batches to respect rate limits
      if (i + BATCH_SIZE < symbols.length) {
        await new Promise(resolve => setTimeout(resolve, BATCH_DELAY_MS));
      }
    }
    
    // Log summary
    const duration = (Date.now() - startTime) / 1000;
    console.log(`dTSU uADTS: Bulk update completed in ${duration.toFixed(2)}s`);
    console.log(`dTSU uADTS: Updated ${updatedCount} of ${symbols.length} symbols`);
    
    if (errors.length > 0) {
      console.error(`dTSU uADTS: ${errors.length} errors occurred during update`);
      // Log first 5 errors as samples
      errors.slice(0, 5).forEach((err, i) => {
        console.error(`dTSU uADTS: Error ${i + 1}/${errors.length}: ${err.symbol} - ${err.error}`);
      });
    }
    
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    console.error('dTSU uADTS: Error in bulk updateAllDailyTimeSeriesBulk:', errorMessage, error);
    throw error;
  }
});

/**
 * Updates daily time series data with a single quote from bulk response
 * @param quote The quote data to update with
 * @returns True if the data was updated, false otherwise
 */
async function updateDailyTimeSeriesWithBulkQuote(quote: {
  symbol: string;
  latestTradingDay: string;
  open: string;
  high: string;
  low: string;
  price: string;
  volume: string;
  previousClose: string;
  change: string;
  changePercent: string;
}): Promise<boolean> {
  const { symbol, latestTradingDay } = quote;
  
  try {
    // Canonical Firestore doc ref for daily time series
    const docPath = getSymbolTimeSeriesDocPath(symbol, AlphaVantageEndpoint.TIME_SERIES_DAILY, ApiProvider.ALPHA_VANTAGE);
    const dailyDataRef = db.doc(docPath);
    
    // Get existing data
    const dailyDoc = await dailyDataRef.get();
    
    if (!dailyDoc.exists) {
      console.log(`dTSU uDTSWBQ [${symbol}] No daily time series data found. Initial data should be loaded separately.`);
      return false;
    }
    
    const existingData = dailyDoc.data()?.data || [];
    const latestDate = existingData[0]?.date;
    
    // If this is a new trading day (and the date is actually newer), add to the time series
    if (latestDate && new Date(latestTradingDay) > new Date(latestDate)) {
      const newDataPoint = {
        date: latestTradingDay,
        open: parseFloat(quote.open),
        high: parseFloat(quote.high),
        low: parseFloat(quote.low),
        close: parseFloat(quote.price),
        volume: parseInt(quote.volume, 10),
        // Additional fields from bulk quote
        symbol: quote.symbol,
        previousClose: parseFloat(quote.previousClose),
        change: parseFloat(quote.change),
        changePercent: parseFloat(quote.changePercent.replace('%', '')),
        source: 'bulk-quote',
      };
      
      // Add new data point to the beginning of the array
      const updatedData = [newDataPoint, ...existingData];
      
      // Update the document
      await dailyDataRef.set({
        data: updatedData,
        metadata: {
          lastUpdated: new Date(),
          lastTradingDay: latestTradingDay,
          lastRefreshSource: 'bulk-quote',
        }
      }, { merge: true });
      
      console.log(`dTSU uDTSWBQ [${symbol}] Added new trading day: ${latestTradingDay}`);
      return true;
    } else {
      console.log(`dTSU uDTSWBQ [${symbol}] No new trading day data available (latest: ${latestDate})`);
      return false;
    }
  } catch (error) {
    console.error(`dTSU uDTSWBQ [${symbol}] Error updating daily data:`, error);
    throw error;
  }
}
