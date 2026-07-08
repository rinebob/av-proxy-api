import { db } from '../../../firebase-admin-init';
import { Timestamp, WriteBatch } from 'firebase-admin/firestore';

import { AlphaVantageEndpoint, AV_TIME_SERIES_ENDPOINT_CONFIGS, OutputSize, TimeSeriesInterval } from '@shared/alpha-vantage';
import { ApiProvider, ApiResponse } from '@shared/core';
import { FirestoreCollection } from '@shared/firestore';
import { RefreshStatus, RefreshTrigger } from '@shared/firestore';
import type { CompactBar } from '@shared/alpha-vantage';

import { RefreshLoggerService } from '../../services/refresh-logger.service';
import {
  getSymbolTimeSeriesDocPath,
  getSymbolTimeSeriesYearDocPath,
  getSymbolTimeSeriesAllDocPath,
  getYearFromEpochMillis,
} from '../../common/firestore/firestore-paths';
import { adjustHistoryForBackfill } from '../logic/split-math';
import { createLogger } from '../../utils/utils';
import { computeDowFromDateString, formatEtDateTime, computeChCpForBarsAscending } from './av-firestore-utils';

const log = createLogger('av-time-series.writer');

/**
 * Internal helper for saving AV time series data to split-adjusted 'sa-time-series'.
 */
async function _internalSaveAvTimeSeriesData(
  data: any[],
  symbol: string,
  endpoint: AlphaVantageEndpoint,
  interval: TimeSeriesInterval,
  options?: { skipSplitPersistence?: boolean },
): Promise<void> {
  console.log(`aFH sATSD start ${endpoint} ${symbol} ${interval}`);
  log.info('timeseries.save.start', { symbol, endpoint, interval });
  // 1. Compute metadata fields
  let histStartDate: Timestamp | null = null;
  let histEndDate: Timestamp | null = null;

  // 2. Canonical doc path for time series
  const docPath = getSymbolTimeSeriesDocPath(symbol, endpoint, ApiProvider.ALPHA_VANTAGE);
  const docRef = db.doc(docPath);

  try {
    const startTime = Date.now();
    // 3. Sharded writes do not rely on existing refreshHistory; skip reading existing doc

    // 4. Prepare writes for non-intraday:
    // DAILY/WEEKLY -> year-sharded docs with compact bars array
    // MONTHLY -> single 'all' doc with compact bars array
    const vendor = ApiProvider.ALPHA_VANTAGE;
    let compactBars: CompactBar[] = [];
    
    for (const b of data) {
      const dt = new Date(b.date);
      const t = dt.getTime();
      if (isNaN(t)) continue;
      const intradayObservedAt = b.intradayObservedAt != null ? Number(b.intradayObservedAt) : undefined;
      const intradayTime = intradayObservedAt != null && Number.isFinite(intradayObservedAt)
        ? new Intl.DateTimeFormat('en-US', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'America/New_York' }).format(new Date(intradayObservedAt))
        : undefined;
      // Compute DOW based on the trading date string (UTC day) to reflect the bar's trading day
      const dStr = new Date(t).toISOString().slice(0, 10);
      const dow = computeDowFromDateString(dStr);
      const bar: CompactBar = {
        t,
        // Store human-readable date string in UTC (YYYY-MM-DD) for ease of display/debugging
        d: dStr,
        dow,
        o: Number(b.open),
        h: Number(b.high),
        l: Number(b.low),
        // Always persist RAW close from provider
        c: Number(b.close),
        v: Number(b.volume),
        // Persist adjusted series fields only when present; do not fallback to close/0/1
        ac: (b as any).adjustedClose != null ? Number((b as any).adjustedClose) : undefined,
        dv: (b as any).dividendAmount != null ? Number((b as any).dividendAmount) : undefined,
        sc: (b as any).splitCoefficient != null ? Number((b as any).splitCoefficient) : undefined,
        // Persist previousClose / change / changePercent exactly as provided (all raw-close based)
        pc: b.previousClose != null ? Number(b.previousClose) : undefined,
        ch: b.change != null ? Number(b.change) : undefined,
        cp: b.changePercent != null ? Number(b.changePercent) : undefined,
        ip: b.intradayPrice != null ? Number(b.intradayPrice) : undefined,
        io: intradayObservedAt,
        it: intradayTime,
        ic: (b as any).intradayChange != null ? Number((b as any).intradayChange) : null,
        ipc: (b as any).intradayPercentChange != null ? Number((b as any).intradayPercentChange) : null,
      };
      compactBars.push(bar);
    }

    // --- APPLY SPLIT ADJUSTMENTS (Backwards Pass) ---
    // DAILY: use provider splitCoefficient (sc) on the daily bars.
    // WEEKLY/MONTHLY: inject sc from symbol-data/{symbol}.splitHistory (AV SPLITS),
    // then run the same backwards-pass once over the AV W/M bars.
    if (compactBars.length > 0) {
      if (interval !== TimeSeriesInterval.DAILY) {
        // For WEEKLY/MONTHLY, ensure we search splits against bars in chronological
        // order so each split maps to the correct period-end bar (not always the
        // most recent one from a newest-first payload).
        compactBars.sort((a, b) => a.t - b.t);
        try {
          const symbolDocRef = db.doc(`${FirestoreCollection.SYMBOL_DATA}/${symbol}`);
          const symbolSnap = await symbolDocRef.get();
          const rawHistory = (symbolSnap.data()?.splitHistory ?? []) as Array<{ date: string; factor: number }>;

          if (Array.isArray(rawHistory) && rawHistory.length > 0) {
            const history = rawHistory
              .filter(e => typeof e?.date === 'string' && typeof e?.factor === 'number')
              .slice()
              .sort((a, b) => a.date.localeCompare(b.date)); // oldest -> newest

            for (const entry of history) {
              const splitDate = entry.date;
              const factor = entry.factor;
              if (!splitDate || !factor || factor === 1) continue;

              // First bar whose period-end date is on/after the split date.
              const idx = compactBars.findIndex(b => {
                const d = (b as any).d as string | undefined;
                return typeof d === 'string' && d >= splitDate;
              });
              if (idx >= 0) {
                compactBars[idx].sc = factor;
                console.log('aFH sATSD injecting_sc_from_splitHistory', {
                  symbol,
                  endpoint,
                  interval,
                  splitDate,
                  factor,
                  barDate: (compactBars[idx] as any).d,
                  sc: compactBars[idx].sc,
                });
                console.log('avFH _iSATSD compactBars[idx].sc: ', compactBars[idx].sc)
              }
            }
          }
        } catch (e) {
          console.warn('aFH sATSD splitHistory_injection_error', {
            symbol,
            endpoint,
            interval,
            error: String((e as any)?.message || e),
          });
        }
      }

      // Single newest->oldest pass using sc on the bars.
      compactBars = adjustHistoryForBackfill(compactBars);
    }
    // ------------------------------------------------

    // Sort bars ascending for deterministic writes
    compactBars.sort((a, b) => a.t - b.t);

    // --- DETECT & PERSIST SPLIT EVENTS (Full Backfill) ---
    // Only for adjusted series writes. Captures historical splits for the split-events collection.
    // IMPORTANT: Do NOT update symbolData.splitHistory here; that history is sourced exclusively
    // from the dedicated AV SPLITS sync + real-time detection paths.
    if (!options?.skipSplitPersistence) {
      const splits = compactBars.filter(b => b.sc !== undefined && b.sc !== 1);
      if (splits.length > 0) {
        console.log(`aFH sATSD backfilling ${splits.length} splits for ${symbol}`);
        const splitBatch = db.batch();
        
        for (const s of splits) {
          const date = s.d;
          const factor = Number(s.sc);
          const splitDocId = `${date}-${symbol}-${factor}`;
          const splitDocRef = db.collection(FirestoreCollection.SPLIT_EVENTS).doc(splitDocId);
          
          splitBatch.set(splitDocRef, {
            symbol,
            date,
            factor,
            detectedAt: Timestamp.now(),
            status: 'PROCESSED_BACKFILL' // Distinct status indicates this was part of a full history write
          }, { merge: true });
        }
        
        await splitBatch.commit();
      }
    }

    // Re-bucket into year shards using the adjusted bars
    const barsByYear = new Map<number, CompactBar[]>();
    for (const bar of compactBars) {
        const y = getYearFromEpochMillis(bar.t);
        const bucket = barsByYear.get(y) || [];
        bucket.push(bar);
        barsByYear.set(y, bucket);
    }

    // After sorting, compute end-of-day change metrics (ch/cp) vs prior day's adjusted close
    computeChCpForBarsAscending(compactBars);

    // Now that compactBars are sorted, compute robust metadata regardless of input order
    histStartDate = compactBars[0]?.t != null ? Timestamp.fromMillis(compactBars[0].t) : null;
    histEndDate = compactBars[compactBars.length - 1]?.t != null ? Timestamp.fromMillis(compactBars[compactBars.length - 1].t) : null;

    // Batched writes
    const BATCH_LIMIT = 400;
    let batch: WriteBatch = db.batch();
    let opsInBatch = 0;
    let totalBarWrites = 0;

    if (interval === TimeSeriesInterval.MONTHLY) {
      // Single 'all' doc
      const allDocPath = getSymbolTimeSeriesAllDocPath(symbol, endpoint, vendor);
      const latestNonPlaceholder = [...compactBars].reverse().find(b => {
        const o = Number(b.o || 0), h = Number(b.h || 0), l = Number(b.l || 0), c = Number(b.c || 0), v = Number(b.v || 0);
        return o !== 0 || h !== 0 || l !== 0 || c !== 0 || v !== 0;
      }) ?? (compactBars[compactBars.length - 1] ?? null);
      const latestUtcIso = latestNonPlaceholder?.t != null ? new Date(latestNonPlaceholder.t).toISOString() : null;
      const latestEtDateTime = latestNonPlaceholder?.t != null ? formatEtDateTime(latestNonPlaceholder.t) : null;
      const version = `${compactBars[compactBars.length - 1]?.t ?? ''}-${compactBars.length}`;
      batch.set(db.doc(allDocPath), {
        bars: compactBars,
        count: compactBars.length,
        firstBarTs: compactBars[0]?.t ?? null,
        lastBarTs: compactBars[compactBars.length - 1]?.t ?? null,
        latest: latestNonPlaceholder,
        latestUtcIso,
        latestEtDateTime,
        version,
        updatedAt: Timestamp.now(),
      }, { merge: true });
      opsInBatch++;
    } else {
      // Year-sharded DAILY / WEEKLY
      for (const [year, bars] of barsByYear.entries()) {
        const yearDocPath = getSymbolTimeSeriesYearDocPath(symbol, endpoint, vendor, year);
        const latestNonPlaceholder = [...bars].reverse().find(b => {
          const o = Number(b.o || 0), h = Number(b.h || 0), l = Number(b.l || 0), c = Number(b.c || 0), v = Number(b.v || 0);
          return o !== 0 || h !== 0 || l !== 0 || c !== 0 || v !== 0;
        }) ?? (bars[bars.length - 1] ?? null);
        const latestUtcIso = latestNonPlaceholder?.t != null ? new Date(latestNonPlaceholder.t).toISOString() : null;
        const latestEtDateTime = latestNonPlaceholder?.t != null ? formatEtDateTime(latestNonPlaceholder.t) : null;
        // Compute latest intraday observation from the most recent io across bars
        const latestIoMs = bars.reduce<number | null>((max, b) => {
          const io = b?.io != null ? Number(b.io) : NaN;
          return Number.isFinite(io) ? (max == null ? io : Math.max(max, io)) : max;
        }, null as any);
        const latestIoUtcIso = latestIoMs != null ? new Date(Number(latestIoMs)).toISOString() : null;
        const latestIoEtDateTime = latestIoMs != null ? formatEtDateTime(Number(latestIoMs)) : null;
        const version = `${bars[bars.length - 1]?.t ?? ''}-${bars.length}`;
        batch.set(db.doc(yearDocPath), {
          bars,
          count: bars.length,
          firstBarTs: bars[0]?.t ?? null,
          lastBarTs: bars[bars.length - 1]?.t ?? null,
          latest: latestNonPlaceholder,
          latestUtcIso,
          latestEtDateTime,
          latestIoUtcIso,
          latestIoEtDateTime,
          version,
          updatedAt: Timestamp.now(),
        }, { merge: true });
        opsInBatch++;
        totalBarWrites += bars.length;
        if (opsInBatch >= BATCH_LIMIT) {
          await batch.commit();
          batch = db.batch();
          opsInBatch = 0;
        }
      }
    }

    if (opsInBatch > 0) await batch.commit();

    // 6. Update top-level provider/interval doc metadata (no large arrays)
    const endpointConfig = AV_TIME_SERIES_ENDPOINT_CONFIGS[endpoint];
    if (!endpointConfig || typeof endpointConfig.ttl !== 'number') {
      throw new Error(`aFH sATSD TTL (ttlSeconds) must be specified in AV_TIME_SERIES_ENDPOINT_CONFIGS for endpoint: ${endpoint}`);
    }
    const ttlSeconds = endpointConfig.ttl;
    const histStartTs = compactBars[0]?.t != null ? compactBars[0].t : null;
    const histEndTs = compactBars[compactBars.length - 1]?.t != null ? compactBars[compactBars.length - 1].t : null;
    const latestBarIso = histEndTs != null ? new Date(histEndTs).toISOString() : 'null';
    console.log(`aFH sATSD latestBar=${latestBarIso} (${histEndTs ?? 'null'}) ${symbol} ${endpoint} ${interval}`);
    log.info('timeseries.save.latest_bar', { symbol, endpoint, interval, latestBarIso, latestBarMs: histEndTs });
    const availableYears = Array.from(barsByYear.keys()).sort((a, b) => a - b);
    const seriesVersion = `${histEndTs ?? ''}-${availableYears.length}`;

    // NOTE: We no longer use TTLs to drive refresh scheduling. nextRefreshAt is
    // a coarse indicator of when the next POST-phase run is expected. For now,
    // approximate this as "~next day" from the current write.
    const nextPostRunAt = Timestamp.fromDate(new Date(Date.now() + 24 * 60 * 60 * 1000));
    await docRef.set({
      metadata: {
        symbol,
        interval,
        histStartDate,
        histEndDate,
        lastUpdated: Timestamp.now(),
        nextRefreshAt: nextPostRunAt,
        ttlSeconds,
        vendor: ApiProvider.ALPHA_VANTAGE,
        endpoint: endpoint,
        histStartTs,
        histEndTs,
        availableYears,
      },
      latestBarTimestamp: histEndTs != null ? Timestamp.fromMillis(histEndTs) : null,
      seriesVersion,
    }, { merge: true });

    // 7. Log refresh event and update refreshHistory using the canonical service
    const refreshLogger = new RefreshLoggerService();
    await refreshLogger.logRefreshEvent(
      {
        vendor: ApiProvider.ALPHA_VANTAGE,
        endpoint,
        symbol,
        ttlSeconds,
        docPath,
      },
      {
        refreshedBy: 'system',
        status: RefreshStatus.SUCCESS,
        triggeredBy: RefreshTrigger.SCHEDULER,
        durationMs: Date.now() - startTime,
      }
    );

    // 8. Ensure symbol presence under symbol-data/{symbol} with minimal metadata for Console visibility.
    // Adjusted series is now the canonical write path, so we always hydrate symbol-data here.
    const symbolDocRef = db.doc(`${FirestoreCollection.SYMBOL_DATA}/${symbol}`);
    await symbolDocRef.set({
      nextRefreshAt: nextPostRunAt,
      nextRefreshBy: '',
      refreshedAt: Timestamp.now(),
      refreshedBy: 'time-series-write',
    }, { merge: true });

    console.log(`aFH sATSD ✓ ${endpoint} ${symbol} ${interval} wrote=${interval === TimeSeriesInterval.MONTHLY ? compactBars.length : totalBarWrites}`);
    log.info('timeseries.save.success', { symbol, endpoint, interval, barsWritten: interval === TimeSeriesInterval.MONTHLY ? compactBars.length : totalBarWrites, durationMs: Date.now() - startTime, latestBarIso });
  } catch (error) {
    console.error('! aFH sATSD error', (error as any)?.message || error);
    log.error('timeseries.save.error', { symbol, endpoint, interval, error: String((error as any)?.message || error) });
    throw error;
  }
}

/**
 * Saves Alpha Vantage TIME SERIES data to Firestore, using the normalized, non-deprecated schema.
 * - DAILY/WEEKLY: writes year-sharded docs with compact bars array
 * - MONTHLY: writes single 'all' doc
 * - Updates top-level provider/interval metadata and logs refresh
 * - Computes d (YYYY-MM-DD), dow, and EOD change fields (ch/cp) per bar
 * @param data Normalized array from handler; converted to CompactBar for persistence
 * @param symbol Stock symbol
 * @param endpoint Alpha Vantage endpoint id
 * @param interval Shared time-series interval
 * @returns Promise that resolves on success
 */
export async function saveAvTimeSeriesData(
  data: any[],
  symbol: string,
  endpoint: AlphaVantageEndpoint,
  interval: TimeSeriesInterval,
  options?: { skipLegacyWrite?: boolean; skipSplitPersistence?: boolean },
): Promise<void> {
  // Adjusted-only writes: persist exclusively to sa-time-series.
  // Raw time-series is no longer maintained.
  await _internalSaveAvTimeSeriesData(data, symbol, endpoint, interval, {
    skipSplitPersistence: options?.skipSplitPersistence,
  });
}

/**
 * Initialize a time-series if missing by fetching a full series via the canonical handler
 * and allowing the handler to perform normalized writes and logging.
 * @param symbol Stock symbol
 * @param interval TimeSeriesInterval to initialize
 * @param endpoint Target AV endpoint; DAILY maps to DAILY_ADJUSTED
 * @returns true if series exists or was successfully written; false when provider returned no data
 */
export async function initializeTimeSeriesIfMissing(
  symbol: string,
  interval: TimeSeriesInterval,
  endpoint: AlphaVantageEndpoint,
): Promise<boolean> {
  // 1. Canonical doc path for time series
  const docPath = getSymbolTimeSeriesDocPath(symbol, endpoint, ApiProvider.ALPHA_VANTAGE);
  const dataRef = db.doc(docPath);
  const doc = await dataRef.get();
  if (doc.exists) return true;

  console.log(`[initTSIM] No time series found at path: ${docPath}. Fetching full...`);
  console.log(`[initTSIM] Will write to Firestore path: ${docPath}`);

  // 2. Fetch the full time series from Alpha Vantage using canonical config and handler
  // Prefer adjusted for daily during initializer
  const effectiveEndpoint = endpoint === AlphaVantageEndpoint.TIME_SERIES_DAILY
    ? AlphaVantageEndpoint.TIME_SERIES_DAILY_ADJUSTED
    : endpoint;
  const endpointConfig = AV_TIME_SERIES_ENDPOINT_CONFIGS[effectiveEndpoint];
  if (!endpointConfig) {
    throw new Error(`[initTSIM] No time series config found for endpoint: ${effectiveEndpoint}`);
  }
  let handler: { fetch: (params: any) => Promise<ApiResponse<any>> };
  switch (effectiveEndpoint) {
    case AlphaVantageEndpoint.TIME_SERIES_DAILY_ADJUSTED: {
      // Dynamic import to avoid circular dependency at module load time
      const { AvDailyTimeSeriesHandler } = await import('../handlers/av-daily-time-series.handler');
      handler = new AvDailyTimeSeriesHandler(endpointConfig);
      break;
    }
    case AlphaVantageEndpoint.TIME_SERIES_WEEKLY_ADJUSTED: {
      const { AvWeeklyTimeSeriesHandler } = await import('../handlers/av-weekly-time-series.handler');
      handler = new AvWeeklyTimeSeriesHandler(endpointConfig as any);
      break;
    }
    case AlphaVantageEndpoint.TIME_SERIES_MONTHLY_ADJUSTED: {
      const { AvMonthlyTimeSeriesHandler } = await import('../handlers/av-monthly-time-series.handler');
      handler = new AvMonthlyTimeSeriesHandler(endpointConfig as any);
      break;
    }
    // TODO: Add cases for non-adjusted WEEKLY/MONTHLY if needed
    default:
      throw new Error(`[initTSIM] No handler implemented for endpoint: ${effectiveEndpoint}`);
  }
  const response = await handler.fetch({ symbol, outputsize: OutputSize.FULL, __checkWriteToggle: false });
  let data = response.data;

  const isArrayPayload = Array.isArray(data);
  if (!data || (isArrayPayload && data.length === 0)) {
    console.log(`[initTSIM] No data received from AV for ${symbol} [${interval}] at path: ${docPath}`);
    return false;
  }

  // Emulator-aware truncation for local testing
  const isEmulator = process.env.FUNCTIONS_EMULATOR === 'true' || !!process.env.FIRESTORE_EMULATOR_HOST;
  console.log('[initTSIM] Emulator detected?: ', isEmulator);
  if (isEmulator && Array.isArray(data)) {
    console.log('[initTSIM] Emulator detected: truncating time series data to first 10 records.');
    data = data.slice(0, 10);
    console.log(`[initTSIM] Data length after truncation: ${data.length}`);
  }

  // 3. Handler is responsible for saving data and logging refresh event
  // Do NOT call saveAvTimeSeriesData here!

  console.log(`[initTSIM] Initialized time series at path: ${docPath} (${isArrayPayload ? data.length : 'object'})`);
  return true;
}
