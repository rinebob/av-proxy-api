
import 'dotenv/config';
import { db } from '../src/firebase-admin-init';
import { FirestoreCollection } from '@shared/firestore';
import {
  AlphaVantageEndpoint,
  TimeSeriesInterval,
  AV_TIME_SERIES_ENDPOINT_CONFIGS,
  OutputSize,
  TimeSeriesEndpointConfig
} from '@shared/alpha-vantage';
import { saveAvTimeSeriesData } from '../src/v2/alpha-vantage/firestore/av-firestore-helper';
import { AvDailyTimeSeriesHandler } from '../src/v2/alpha-vantage/handlers/av-daily-time-series.handler';
import { AvWeeklyTimeSeriesHandler } from '../src/v2/alpha-vantage/handlers/av-weekly-time-series.handler';
import { AvMonthlyTimeSeriesHandler } from '../src/v2/alpha-vantage/handlers/av-monthly-time-series.handler';

async function main() {
  console.log(`--- Backfill Data Tool (Full History & Injection) ---`);

  const isEmulator =
    !!process.env.FIRESTORE_EMULATOR_HOST || process.env.FUNCTIONS_EMULATOR === 'true';
  if (isEmulator) {
    console.log('Detected Firestore EMULATOR.');
  }

  // 1. Get Symbols
  let symbols: string[] = [];
  if (process.env.SYMBOL) {
    symbols = [process.env.SYMBOL];
  } else if (process.env.SYMBOLS) {
    symbols = process.env.SYMBOLS.split(',');
  } else {
    const snapshot = await db.collection(FirestoreCollection.TRACKED_SYMBOLS).get();
    symbols = snapshot.docs.map(d => d.id).sort();
  }
  console.log(`Processing ${symbols.length} symbols...`);

  // Interval selection
  // BACKFILL_INTERVALS can be a comma-separated list: DAILY,WEEKLY,MONTHLY
  const intervalFlag = (process.env.BACKFILL_INTERVALS || '')
    .split(',')
    .map(s => s.trim().toUpperCase())
    .filter(Boolean);

  const requestedIntervals = new Set<TimeSeriesInterval>();
  for (const val of intervalFlag) {
    if (val === 'DAILY') requestedIntervals.add(TimeSeriesInterval.DAILY);
    if (val === 'WEEKLY') requestedIntervals.add(TimeSeriesInterval.WEEKLY);
    if (val === 'MONTHLY') requestedIntervals.add(TimeSeriesInterval.MONTHLY);
  }

  // Time window selection (only when explicitly requested)
  // 1) BACKFILL_FROM / BACKFILL_TO: YYYY-MM-DD (inclusive)
  // 2) BACKFILL_LOOKBACK_YEARS: N (from today back N years)
  let fromMs: number | null = null;
  let toMs: number | null = null;

  const fromStr = process.env.BACKFILL_FROM;
  const toStr = process.env.BACKFILL_TO;
  const lookbackYears = process.env.BACKFILL_LOOKBACK_YEARS
    ? Number(process.env.BACKFILL_LOOKBACK_YEARS)
    : null;

  if (fromStr) {
    const d = new Date(fromStr);
    if (!Number.isNaN(d.getTime())) fromMs = d.getTime();
  }
  if (toStr) {
    const d = new Date(toStr);
    if (!Number.isNaN(d.getTime())) {
      // Include the whole day
      toMs = d.getTime() + 24 * 60 * 60 * 1000;
    }
  }

  if (!fromMs && lookbackYears && lookbackYears > 0) {
    const now = new Date();
    const d = new Date(now.getFullYear() - lookbackYears, now.getMonth(), now.getDate());
    fromMs = d.getTime();
  }

  for (const symbol of symbols) {
    console.log(`\n[${symbol}] Backfilling...`);

    // Get Split History for Injection
    const doc = await db.doc(`${FirestoreCollection.SYMBOL_DATA}/${symbol}`).get();
    const splitHistory = (doc.data()?.splitHistory || []) as { date: string; factor: number }[];
    if (splitHistory.length > 0) {
      console.log(`  Loaded ${splitHistory.length} splits for injection.`);
    }

    // Define tasks: we will later filter based on requestedIntervals / emulator defaults
    const tasks = [
      {
        interval: TimeSeriesInterval.DAILY,
        endpoint: AlphaVantageEndpoint.TIME_SERIES_DAILY_ADJUSTED,
        Handler: AvDailyTimeSeriesHandler
      },
      {
        interval: TimeSeriesInterval.WEEKLY,
        endpoint: AlphaVantageEndpoint.TIME_SERIES_WEEKLY_ADJUSTED,
        Handler: AvWeeklyTimeSeriesHandler
      },
      {
        interval: TimeSeriesInterval.MONTHLY,
        endpoint: AlphaVantageEndpoint.TIME_SERIES_MONTHLY_ADJUSTED,
        Handler: AvMonthlyTimeSeriesHandler
      }
    ];

    for (const task of tasks) {
      // Interval filtering logic
      if (requestedIntervals.size > 0 && !requestedIntervals.has(task.interval)) {
        console.log(`  Skipping ${task.interval} (not in BACKFILL_INTERVALS).`);
        continue;
      }

      try {
        console.log(`  Fetching ${task.interval}...`);
        const config = AV_TIME_SERIES_ENDPOINT_CONFIGS[task.endpoint] as TimeSeriesEndpointConfig;
        const handler = new task.Handler(config);

        const res = await handler.fetch({
          symbol,
          outputsize: OutputSize.FULL,
          __checkWriteToggle: false // We will save manually with injection
        });

        let bars = res.data as any;

        // Normalize Raw Object (e.g. TSLA Monthly)
        if (!Array.isArray(bars)) {
          // Check for standard AV keys or normalized keys
          // AV uses "Time Series (Daily)", "Weekly Adjusted Time Series", etc.
          // Or "meta" / "series" wrapper from handler?
          // Handler might return { meta: ..., series: ... }

          const seriesObj =
            bars.series ||
            bars['Time Series (Daily)'] ||
            bars['Weekly Adjusted Time Series'] ||
            bars['Monthly Adjusted Time Series'] ||
            bars['Monthly Time Series'];

          if (seriesObj) {
            console.log(`  Normalizing raw object response...`);
            // Need to find the actual series object inside
            // If bars.series exists, use it.
            // If bars['Time Series (Daily)'] exists, use it.

            let series = seriesObj;
            // If seriesObj has nested interval keys (like handler norm?), check them.
            if (seriesObj.monthly) series = seriesObj.monthly;
            else if (seriesObj.weekly) series = seriesObj.weekly;
            else if (seriesObj.daily) series = seriesObj.daily;

            bars = Object.entries(series).map(([date, val]: [string, any]) => ({
              date,
              open: val['1. open'] || val.open,
              high: val['2. high'] || val.high,
              low: val['3. low'] || val.low,
              close: val['4. close'] || val.close,
              adjustedClose: val['5. adjusted close'] || val.adjustedClose,
              volume: val['6. volume'] || val.volume,
              dividendAmount: val['7. dividend amount'] || val.dividendAmount,
              splitCoefficient: val['8. split coefficient'] || val.splitCoefficient // Try to capture SC
            }));
            bars.sort(
              (a: any, b: any) => new Date(a.date).getTime() - new Date(b.date).getTime()
            );
          }
        }

        if (Array.isArray(bars)) {
          // Inject Splits
          if (splitHistory.length > 0) {
            // Ensure sorted
            bars.sort(
              (a: any, b: any) => new Date(a.date).getTime() - new Date(b.date).getTime()
            );
            let injected = 0;
            for (const split of splitHistory) {
              const splitBar = bars.find((b: any) => b.date >= split.date);
              if (splitBar) {
                splitBar.splitCoefficient = split.factor;
                injected++;
              }
            }
            if (injected > 0) console.log(`  Injected ${injected} splits.`);
          }

          // Generic time window trimming (applies equally to prod/emulator
          // whenever BACKFILL_* or emulator default window is active).
          if (fromMs || toMs) {
            const beforeCount = bars.length;
            bars = bars.filter((b: any) => {
              const time = new Date(b.date).getTime();
              if (Number.isNaN(time)) return false;
              if (fromMs && time < fromMs) return false;
              if (toMs && time >= toMs) return false;
              return true;
            });
            console.log(
              `  Time-window trim (${task.interval}): ${beforeCount} -> ${bars.length} bars.`
            );
          }

          // Save
          await saveAvTimeSeriesData(bars, symbol, task.endpoint, task.interval, {
            forceFullHistory: true,
            skipSplitPersistence: true // IMPORTANT: Don't pollute history with injected dates
          });
          console.log(`  ✓ Saved ${bars.length} bars.`);
        } else {
          console.error(`  ✕ Failed: Data is not an array.`);
        }
      } catch (err: any) {
        console.error(`  ✕ Failed ${task.interval}:`, err.message);
      }

      // Mini wait between intervals
      await new Promise(resolve => setTimeout(resolve, 1000));
    }

    // Rate Limit between symbols
    console.log(`  Waiting 2s...`);
    await new Promise(resolve => setTimeout(resolve, 2000));
  }

  console.log('\n--- Backfill Complete ---');
}

main().catch(console.error);
