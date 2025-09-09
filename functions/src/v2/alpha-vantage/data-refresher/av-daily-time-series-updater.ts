import { db } from '../../../firebase-admin-init';
import { onSchedule } from 'firebase-functions/v2/scheduler';
import { AlphaVantageHandlerFactory } from '../alpha-vantage-factory';

import { AlphaVantageEndpoint, TimeSeriesInterval } from '@shared/alpha-vantage';
import { FirestoreCollection } from '@shared/firestore';
import { ApiProvider } from '@shared/core';

import { DAILY_TIME_SERIES_UPDATE_SCHEDULE, INTRADAY_SNAPSHOT_SCHEDULE } from '../../common/function-schedules';
import { initializeTimeSeriesIfMissing, saveAvTimeSeriesData, upsertAvDailyBar } from '../firestore/av-firestore-helper';
import { getSymbolTimeSeriesDocPath } from '../../common/firestore/firestore-paths';

// Helper function to update daily time series with latest quote
async function updateDailyTimeSeriesWithQuote(symbol: string): Promise<boolean> {
  const globalQuoteEndpoint = AlphaVantageEndpoint.GLOBAL_QUOTE;
  
  // Reference to the daily adjusted time-series doc (canonical path used by partner readers)
  const dailyDataDocPath = getSymbolTimeSeriesDocPath(symbol, AlphaVantageEndpoint.TIME_SERIES_DAILY_ADJUSTED, ApiProvider.ALPHA_VANTAGE);
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
    
    // 2. Read normalized metadata to determine latest bar timestamp (histEndTs)
    let metaSnap = await dailyDataRef.get();
    if (!metaSnap.exists) {
      const initialized = await initializeTimeSeriesIfMissing(
        symbol,
        TimeSeriesInterval.DAILY,
        AlphaVantageEndpoint.TIME_SERIES_DAILY_ADJUSTED,
      );
      if (!initialized) return false;
      console.log(`dTSU uDTSWQ [${symbol}] No daily adjusted series found. Initialized full series.`);
      metaSnap = await dailyDataRef.get();
    }
    
    const meta = metaSnap.data() as any;
    const latestHistEndTs: number | null = meta?.metadata?.histEndTs ?? null;
    const latestTradingDay: string = quoteResponse.data.latestTradingDay;
    const latestTradingDayMs = new Date(latestTradingDay).getTime();
    
    // 3. If this is a new trading day beyond histEndTs, append a new compact bar via sharded writer
    if (Number.isFinite(latestTradingDayMs) && (latestHistEndTs == null || latestTradingDayMs > latestHistEndTs)) {
      const bar = {
        date: latestTradingDay,
        open: Number(quoteResponse.data.open),
        high: Number(quoteResponse.data.high),
        low: Number(quoteResponse.data.low),
        close: Number(quoteResponse.data.price),
        volume: Number(quoteResponse.data.volume),
        previousClose: Number(quoteResponse.data.previousClose),
        change: Number(quoteResponse.data.change),
        // Strip % and convert to numeric; keep as 1.23 for 1.23%
        changePercent: typeof quoteResponse.data.changePercent === 'string'
          ? Number(quoteResponse.data.changePercent.replace('%', '').trim())
          : Number(quoteResponse.data.changePercent),
      };
      
      // Persist via normalized sharded writer; scheduled job -> do not check manual toggle
      await saveAvTimeSeriesData(
        [bar],
        symbol,
        AlphaVantageEndpoint.TIME_SERIES_DAILY_ADJUSTED,
        TimeSeriesInterval.DAILY,
        false,
      );
      
      console.log(`dTSU uDTSWQ [${symbol}] Appended new trading day bar: ${latestTradingDay}`);
      return true;
    }
    
    console.log(`dTSU uDTSWQ [${symbol}] No new trading day data available (latest histEndTs: ${latestHistEndTs})`);
    return false;
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

/**
 * Intraday snapshot updater
 * Runs at 3:30 PM ET to capture "pre-close" price and timestamp for the trading day.
 * Stores as compact fields on the daily bar:
 *  - ip: intradayPrice
 *  - io: intradayObservedAt (epoch ms)
 */
async function updateIntradaySnapshotWithQuote(symbol: string): Promise<boolean> {
  const quoteHandler = AlphaVantageHandlerFactory.createHandler(AlphaVantageEndpoint.GLOBAL_QUOTE);
  const resp = await quoteHandler.fetch({ symbol });
  const q = resp.data;
  if (!q) return false;

  // Ensure series exists so year doc is present when upserting
  await initializeTimeSeriesIfMissing(symbol, TimeSeriesInterval.DAILY, AlphaVantageEndpoint.TIME_SERIES_DAILY_ADJUSTED);

  // Use AV-provided trading day as the bar date (YYYY-MM-DD, local to AV feed but effectively UTC day key)
  const date = q.latestTradingDay as string;
  const nowMs = Date.now();
  const price = Number(q.price);
  if (!date || !Number.isFinite(price)) return false;

  await upsertAvDailyBar({
    symbol,
    date,
    patch: { ip: price, io: nowMs },
    endpoint: AlphaVantageEndpoint.TIME_SERIES_DAILY_ADJUSTED,
  });

  console.log(`dTSU intraday [${symbol}] captured snapshot ${price} at ${new Date(nowMs).toISOString()} for ${date}`);
  return true;
}

export async function updateIntradaySnapshotHandler() {
  console.log('============ START INTRADAY SNAPSHOT UPDATE (3:30 PM ET) ======================');
  const symbolsSnap = await db.collection(FirestoreCollection.TRACKED_SYMBOLS).get();
  const symbols = symbolsSnap.docs.map(d => d.id);
  if (!symbols.length) {
    console.log('No tracked symbols for intraday snapshot');
    return;
  }
  const BATCH_SIZE = 5;
  let updated = 0;
  for (let i = 0; i < symbols.length; i += BATCH_SIZE) {
    const batch = symbols.slice(i, i + BATCH_SIZE);
    const results = await Promise.allSettled(batch.map(s => updateIntradaySnapshotWithQuote(s)));
    results.forEach((r) => { if (r.status === 'fulfilled' && r.value) updated++; });
    if (i + BATCH_SIZE < symbols.length) await new Promise(res => setTimeout(res, 1000));
  }
  console.log(`Intraday snapshot updated for ${updated}/${symbols.length} symbols`);
}

export const updateIntradaySnapshot = onSchedule({
  schedule: INTRADAY_SNAPSHOT_SCHEDULE,
  timeZone: 'America/New_York',
  secrets: ['ALPHAVANTAGE_API_KEY'],
}, updateIntradaySnapshotHandler);
