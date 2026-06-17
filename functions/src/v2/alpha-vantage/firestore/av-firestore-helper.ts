import { db } from '../../../firebase-admin-init';
import { getFunctions } from 'firebase-admin/functions';
import { Timestamp, WriteBatch, FieldValue } from 'firebase-admin/firestore';

import { AlphaVantageEndpoint, AV_TIME_SERIES_ENDPOINT_CONFIGS, OutputSize, TimeSeriesInterval } from '@shared/alpha-vantage';
import { ApiProvider, ApiResponse } from '@shared/core';
import { FirestoreCollection } from '@shared/firestore';
import type { EndpointConfig } from '@shared/core';
import type { CompactBar } from '@shared/alpha-vantage';
import { DayOfWeek } from '@shared/alpha-vantage';
import { RefreshStatus, RefreshTrigger } from '@shared/firestore';

import { RefreshLoggerService } from '../../services/refresh-logger.service';

import type { SplitRemediationPayload } from '../tasks/split-remediator.task';
import { getSymbolTimeSeriesDocPath } from '../../common/firestore/firestore-paths';
import { adjustHistoryForBackfill } from '../logic/split-math';
import { CloudTask } from '../../common/constants';
import {
  getSymbolTimeSeriesYearDocPath,
  getSymbolTimeSeriesAllDocPath,
  getYearFromEpochMillis,
} from '../../common/firestore/firestore-paths';
import { createLogger } from '../../utils/utils';

const log = createLogger('av.ts'); // Abbrev: aFH sATSD

function formatPtDateTime(ts: Timestamp): string {
  return new Intl.DateTimeFormat('en-US', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: 'America/Los_Angeles',
  }).format(ts.toDate());
}

/**
 * Saves Alpha Vantage STANDARD (non-time-series) data to Firestore and logs refresh event using RefreshLoggerService.
 * @param data - The data to save
 * @param symbol - The symbol
 * @param endpoint - The Alpha Vantage endpoint
 * @param endpointConfig - The endpoint configuration
 * @returns Promise that resolves when persistence and logging complete
 */
export async function saveAvData(
  data: any,
  symbol: string,
  endpoint: AlphaVantageEndpoint,
  endpointConfig: EndpointConfig
): Promise<void> {
  console.log(`aFH sAD start ${endpoint} ${symbol}`);
  log.info('standard.save.start', { symbol, endpoint });
  const { firestorePath, ttl } = endpointConfig;

  if (typeof ttl !== 'number') {
    throw new Error('ttl (ttlSeconds) must be provided in endpoint config');
  }

  const startTime = Date.now();

  try {
    // 1. Prepare document path
    if (!firestorePath) {
      throw new Error(`No firestorePath configured for endpoint: ${endpoint}. A firestorePath must be provided.`);
    }
    const docPath = firestorePath.replace('{symbol}', symbol);

    // 2. Prepare common metadata fields for non-time-series AV endpoints
    const nowTs = Timestamp.now();
    const nextTs = Timestamp.fromDate(new Date(Date.now() + ttl * 1000));

    const updateData: Record<string, any> = {
      // Standard payload container
      data,
      metadata: {
        lastUpdated: nowTs,
        lastUpdatedHr: formatPtDateTime(nowTs),
        nextUpdate: nextTs,
        nextUpdateHr: formatPtDateTime(nextTs),
        // Remove legacy fields that may exist from older schemas
        nextRefreshAt: FieldValue.delete(),
        ttlSeconds: ttl,
        vendor: ApiProvider.ALPHA_VANTAGE,
        endpoint,
        symbol,
      },
    };

    // 3. Proceed with Firestore write and refresh event logging
    await db.doc(docPath).set(updateData, { merge: true });

    // 4. Log refresh event using RefreshLoggerService
    const refreshLogger = new RefreshLoggerService();
    await refreshLogger.logRefreshEvent(
      {
        vendor: ApiProvider.ALPHA_VANTAGE,
        endpoint,
        symbol,
        ttlSeconds: ttl,
        docPath, // canonical Firestore path must be provided
      },
      {
        refreshedBy: 'system',
        status: RefreshStatus.SUCCESS,
        triggeredBy: RefreshTrigger.SCHEDULER,
        durationMs: Date.now() - startTime,
        httpStatus: 200
        // Add other RefreshEvent fields as needed
      }
    );

    console.log(`aFH sAD ✓ ${endpoint} ${symbol}`);
    log.info('standard.save.success', { symbol, endpoint, docPath, durationMs: Date.now() - startTime });
  } catch (error) {
    console.error('! aFH sAD error', (error as any)?.message || error);
    log.error('standard.save.error', { error: String((error as any)?.message || error) });
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

/**
 * Upserts a single daily bar (YYYY-MM-DD) into the DAILY year-sharded doc.
 * - Merges required numeric fields, preserves intraday fields, sorts ascending and updates aggregates
 * - Recomputes ch/cp for the target bar using the previous day's adjusted close (fallback close)
 * - Optionally skips bumping the parent top-level series metadata (for intraday pre-close flows)
 * @param options.symbol Stock symbol
 * @param options.date ISO date (UTC day)
 * @param options.patch Partial CompactBar numeric fields to merge
 * @param options.endpoint Defaults to TIME_SERIES_DAILY_ADJUSTED
 * @param options.skipParentMetaBump When true, do not bump the top-level time-series metadata
 * @returns Promise that resolves on success
 */
/**
 * Internal helper for upserting daily bars to split-adjusted collection.
 */
async function _internalUpsertDailyBar(
  options: {
    symbol: string;
    date: string; // YYYY-MM-DD (UTC day)
  // Partial compact fields to merge (numeric only).
    patch: Partial<CompactBar>;
    endpoint?: AlphaVantageEndpoint; // defaults to DAILY_ADJUSTED
  // When true, do not bump the top-level time-series metadata. Used for pre-close intraday snapshots
    skipParentMetaBump?: boolean;
  // Epoch ms when the daily bar first finalized (POST). If provided and fz not yet set, this will be stamped.
    finalizedAtMs?: number;
  },
): Promise<void> {
  const { symbol, date, patch, endpoint = AlphaVantageEndpoint.TIME_SERIES_DAILY_ADJUSTED, skipParentMetaBump, finalizedAtMs } = options;
  const vendor = ApiProvider.ALPHA_VANTAGE;
  const t = new Date(`${date}T00:00:00.000Z`).getTime();
  const y = getYearFromEpochMillis(t);
  const yearDocPath = getSymbolTimeSeriesYearDocPath(symbol, endpoint, vendor, y);
  const yearRef = db.doc(yearDocPath);
  const metaDocPath = getSymbolTimeSeriesDocPath(symbol, endpoint, vendor);
  const metaRef = db.doc(metaDocPath);

  let pendingRemediation: SplitRemediationPayload | null = null;

  // Transactional upsert to avoid races
  await db.runTransaction(async (tx) => {
    // 1. Load both year shard and top-level metadata (for split idempotency)
    const [snap, metaSnap] = await Promise.all([
      tx.get(yearRef),
      tx.get(metaRef)
    ]);

    const bars: CompactBar[] = snap.exists ? ((snap.get('bars') ?? []) as CompactBar[]) : [];

    const idx = bars.findIndex((b) => b.t === t);
    if (idx >= 0) {
      const existing = bars[idx];
      const io = patch.io != null ? patch.io : existing.io;
      const it = io != null && Number.isFinite(io)
        ? new Intl.DateTimeFormat('en-US', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'America/New_York' }).format(new Date(io))
        : existing.it;
      const patchBar = {
        o: Number(patch.o ?? existing.o ?? 0),
        h: Number(patch.h ?? existing.h ?? patch.o ?? 0),
        l: Number(patch.l ?? existing.l ?? patch.o ?? 0),
        c: Number(patch.c ?? existing.c ?? 0),
        v: Number(patch.v ?? existing.v ?? 0),
        // Persist adjusted series fields only when explicitly provided; do not fallback to close/0/1
        ac: patch.ac != null ? Number(patch.ac) : (existing.ac != null ? Number(existing.ac) : undefined),
        dv: patch.dv != null ? Number(patch.dv) : (existing.dv != null ? Number(existing.dv) : undefined),
        sc: patch.sc != null ? Number(patch.sc) : (existing.sc != null ? Number(existing.sc) : undefined),
        ip: patch.ip != null ? Number(patch.ip) : existing.ip,
        io,
        it,
        ic: patch.ic != null ? Number(patch.ic) : ((existing as any).ic ?? null),
        ipc: patch.ipc != null ? Number(patch.ipc) : ((existing as any).ipc ?? null),
        dow: computeDowFromDateString(new Date(t).toISOString().slice(0, 10)),
      } as Partial<CompactBar> & { o: number; h: number; l: number; c: number; v: number; ac: number; dv: number; sc: number };
      const merged = { ...existing, ...patchBar } as CompactBar;

      // --- Split Remediation Logic ---
      // Only triggered for the split-adjusted collection
      const isSplitEvent = patch.sc !== undefined && patch.sc !== 1;
      if (isSplitEvent) {
        const metaData = metaSnap.data()?.metadata || {};
        const lastProcessed = metaData.latestSplitDateProcessed;

        // If we haven't processed this split date yet
        if (lastProcessed !== date) {
          console.log(`aFH sATSD Split Detected! ${symbol} ${date} factor=${patch.sc}`);
          // Update metadata to claim this split immediately prevents double-enqueuing
          tx.set(metaRef, {
            metadata: { latestSplitDateProcessed: date }
          }, { merge: true });

          // Record the event globally for audit/analytics (Dr. Reed's Recommendation)
          const splitDocId = `${date}-${symbol}-${patch.sc}`;
          const splitDocRef = db.collection(FirestoreCollection.SPLIT_EVENTS).doc(splitDocId);
          tx.set(splitDocRef, {
            symbol,
            date,
            factor: Number(patch.sc),
            detectedAt: Timestamp.now(),
            status: 'ENQUEUED'
          }, { merge: true });

          // Also persist to symbol-data/{symbol} (Local History)
          const symbolDocRef = db.doc(`${FirestoreCollection.SYMBOL_DATA}/${symbol}`);
          tx.set(symbolDocRef, {
            splitHistory: FieldValue.arrayUnion({
              date,
              factor: Number(patch.sc),
              detectedAt: Timestamp.now()
            })
          }, { merge: true });

          // Prepare payload for post-transaction dispatch
          pendingRemediation = {
            symbol,
            splitDate: date,
            splitFactor: Number(patch.sc)
          };
        }
      }
      // -------------------------------

      // Stamp fz if provided and not yet set, and bar is non-placeholder
      if (finalizedAtMs != null && (merged as any).fz == null) {
        const oo = Number(merged.o || 0), hh = Number(merged.h || 0), ll = Number(merged.l || 0), cc = Number(merged.c || 0);
        const nonPlaceholder = (oo !== 0) || (hh !== 0) || (ll !== 0) || (cc !== 0);
        if (nonPlaceholder) (merged as any).fz = Number(finalizedAtMs);
      }
      bars[idx] = merged;
    } else {
      const newBar: CompactBar = {
        t,
        d: new Date(t).toISOString().slice(0, 10),
        dow: computeDowFromDateString(new Date(t).toISOString().slice(0, 10)),
        o: Number(patch.o ?? 0),
        h: Number(patch.h ?? (patch.o ?? 0)),
        l: Number(patch.l ?? (patch.o ?? 0)),
        c: Number(patch.c ?? 0),
        v: Number(patch.v ?? 0),
        ac: patch.ac != null ? Number(patch.ac) : undefined,
        dv: patch.dv != null ? Number(patch.dv) : undefined,
        sc: patch.sc != null ? Number(patch.sc) : undefined,
        pc: patch.pc != null ? Number(patch.pc) : undefined,
        ch: patch.ch != null ? Number(patch.ch) : undefined,
        cp: patch.cp != null ? Number(patch.cp) : undefined,
        ip: patch.ip != null ? Number(patch.ip) : undefined,
        io: patch.io,
        it: patch.io != null && Number.isFinite(patch.io)
          ? new Intl.DateTimeFormat('en-US', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'America/New_York' }).format(new Date(patch.io))
          : undefined,
        ic: patch.ic != null ? Number(patch.ic) : null,
        ipc: patch.ipc != null ? Number(patch.ipc) : null,
      };
      if (finalizedAtMs != null) {
        const oo = Number(newBar.o || 0), hh = Number(newBar.h || 0), ll = Number(newBar.l || 0), cc = Number(newBar.c || 0);
        const nonPlaceholder = (oo !== 0) || (hh !== 0) || (ll !== 0) || (cc !== 0);
        if (nonPlaceholder) (newBar as any).fz = Number(finalizedAtMs);
      }
      bars.push(newBar);

      // --- Split Remediation Logic (New Bar) ---
      const isSplitEvent = patch.sc !== undefined && patch.sc !== 1;
      if (isSplitEvent) {
        const metaData = metaSnap.data()?.metadata || {};
        const lastProcessed = metaData.latestSplitDateProcessed;

        if (lastProcessed !== date) {
          console.log(`aFH sATSD Split Detected (New)! ${symbol} ${date} factor=${patch.sc}`);
          tx.set(metaRef, {
            metadata: { latestSplitDateProcessed: date }
          }, { merge: true });

          const splitDocId = `${date}-${symbol}-${patch.sc}`;
          const splitDocRef = db.collection(FirestoreCollection.SPLIT_EVENTS).doc(splitDocId);
          tx.set(splitDocRef, {
            symbol,
            date,
            factor: Number(patch.sc),
            detectedAt: Timestamp.now(),
            status: 'ENQUEUED'
          }, { merge: true });

          // Also persist to symbol-data/{symbol} (Local History)
          const symbolDocRef = db.doc(`${FirestoreCollection.SYMBOL_DATA}/${symbol}`);
          tx.set(symbolDocRef, {
            splitHistory: FieldValue.arrayUnion({
              date,
              factor: Number(patch.sc),
              detectedAt: Timestamp.now()
            })
          }, { merge: true });

          pendingRemediation = {
            symbol,
            splitDate: date,
            splitFactor: Number(patch.sc)
          };
        }
      }
      // -----------------------------------------
    }

    bars.sort((a, b) => a.t - b.t);

    const targetIdx = bars.findIndex((b) => b.t === t);
    if (targetIdx >= 0) {
      // Re-hydrate baseline using current snapshot to ensure latest persisted refs
      computeChCpForTargetIndex(bars, targetIdx);
    }

    const latestNonPlaceholder = [...bars].reverse().find(b => {
      const o = Number(b.o || 0), h = Number(b.h || 0), l = Number(b.l || 0), c = Number(b.c || 0), v = Number(b.v || 0);
      return o !== 0 || h !== 0 || l !== 0 || c !== 0 || v !== 0;
    }) ?? (bars[bars.length - 1] ?? null);
    const latestUtcIso = latestNonPlaceholder?.t != null ? new Date(latestNonPlaceholder.t).toISOString() : null;
    const latestEtDateTime = latestNonPlaceholder?.t != null ? formatEtDateTime(latestNonPlaceholder.t) : null;
    const latestIoMs = bars.reduce<number | null>((max, b) => {
      const io = b?.io != null ? Number(b.io) : NaN;
      return Number.isFinite(io) ? (max == null ? io : Math.max(max, io)) : max;
    }, null as any);
    const latestIoUtcIso = latestIoMs != null ? new Date(Number(latestIoMs)).toISOString() : null;
    const latestIoEtDateTime = latestIoMs != null ? formatEtDateTime(Number(latestIoMs)) : null;
    const version = `${bars[bars.length - 1]?.t ?? ''}-${bars.length}`;

    tx.set(yearRef, {
      bars,
      count: bars.length,
      firstBarTs: bars[0]?.t ?? null,
      // Persist lastBarTs as the epoch millis (t) of the last bar, not the full bar object
      lastBarTs: bars[bars.length - 1]?.t ?? null,
      latest: latestNonPlaceholder,
      latestUtcIso,
      latestEtDateTime,
      latestIoUtcIso,
      latestIoEtDateTime,
      version,
      updatedAt: Timestamp.now(),
    }, { merge: true });

  });

  // Dispatch task if needed (outside transaction)
  if (pendingRemediation) {
    try {
      const queue = getFunctions().taskQueue(CloudTask.REMEDIATE_SPLIT_HISTORY);
      await queue.enqueue(pendingRemediation);
      log.info('daily.upsert.remediation_enqueued', pendingRemediation);
    } catch (err) {
      log.error('daily.upsert.remediation_failed', { error: String(err), ...(pendingRemediation as SplitRemediationPayload) });
      // Non-fatal for the daily upsert, but critical for history consistency.
      // TODO: Consider alerting here.
    }
  }

  if (!skipParentMetaBump) {
    await bumpTimeSeriesTopLevelMetadata({
      symbol,
      endpoint,
      interval: TimeSeriesInterval.DAILY,
      latestDate: date,
    });
  }
}

export async function upsertAvDailyBar(options: {
  symbol: string;
  date: string; // YYYY-MM-DD (UTC day)
  patch: Partial<CompactBar>;
  endpoint?: AlphaVantageEndpoint; // defaults to DAILY_ADJUSTED
  skipParentMetaBump?: boolean;
  finalizedAtMs?: number;
}): Promise<void> {
  // Adjusted-only: write exclusively to sa-time-series.
  await _internalUpsertDailyBar(options);
}

/**
 * Upserts a single weekly bar (YYYY-MM-DD) into the WEEKLY year-sharded doc.
 * - Merges, sorts ascending, updates aggregates, and bumps parent metadata
 *
 * @deprecated Use `mergeWeeklyCompactWindowIntoShards()` for weekly compact flows instead.
 * This helper is retained for legacy callers that still perform per-bar weekly upserts.
 *
 * @param options.symbol Stock symbol
 * @param options.date ISO date (UTC week anchor)
 * @param options.patch Partial CompactBar numeric fields to merge
 * @param options.endpoint Defaults to TIME_SERIES_WEEKLY_ADJUSTED
 * @returns Promise that resolves on success
 */
export async function upsertAvWeeklyBar(options: {
  symbol: string;
  date: string; // YYYY-MM-DD (UTC day)
  patch: Partial<CompactBar>;
  endpoint?: AlphaVantageEndpoint; // defaults to WEEKLY_ADJUSTED
}): Promise<void> {
  const { symbol, date, patch, endpoint = AlphaVantageEndpoint.TIME_SERIES_WEEKLY_ADJUSTED } = options;
  const vendor = ApiProvider.ALPHA_VANTAGE;
  const t = new Date(`${date}T00:00:00.000Z`).getTime();
  const y = getYearFromEpochMillis(t);
  const yearDocPath = getSymbolTimeSeriesYearDocPath(symbol, endpoint, vendor, y);
  const yearRef = db.doc(yearDocPath);
  const snap = await yearRef.get();
  const bars: CompactBar[] = snap.exists ? (snap.get('bars') ?? []) : [];

  const idx = bars.findIndex((b) => b.t === t);
  if (idx >= 0) {
    const existing = bars[idx];
    const patchBar = {
      o: Number(patch.o ?? existing.o ?? 0),
      h: Number(patch.h ?? existing.h ?? patch.o ?? 0),
      l: Number(patch.l ?? existing.l ?? patch.o ?? 0),
      c: Number(patch.c ?? existing.c ?? 0),
      v: Number(patch.v ?? existing.v ?? 0),
      ac: patch.ac != null ? Number(patch.ac) : (existing.ac != null ? Number(existing.ac) : undefined),
      dv: patch.dv != null ? Number(patch.dv) : (existing.dv != null ? Number(existing.dv) : undefined),
      sc: patch.sc != null ? Number(patch.sc) : (existing.sc != null ? Number(existing.sc) : undefined),
      dow: computeDowFromDateString(new Date(t).toISOString().slice(0, 10)),
    } as Partial<CompactBar> & { o: number; h: number; l: number; c: number; v: number; ac: number; dv: number; sc: number };
    bars[idx] = { ...existing, ...patchBar } as CompactBar;
  } else {
    const newBar: CompactBar = {
      t,
      d: new Date(t).toISOString().slice(0, 10),
      dow: computeDowFromDateString(new Date(t).toISOString().slice(0, 10)),
      o: Number(patch.o ?? 0),
      h: Number(patch.h ?? (patch.o ?? 0)),
      l: Number(patch.l ?? (patch.o ?? 0)),
      c: Number(patch.c ?? 0),
      v: Number(patch.v ?? 0),
      ac: patch.ac != null ? Number(patch.ac) : undefined,
      dv: patch.dv != null ? Number(patch.dv) : undefined,
      sc: patch.sc != null ? Number(patch.sc) : undefined,
      ic: null,
      ipc: null,
    };
    bars.push(newBar);
  }

  // Sort ascending for deterministic writes
  const latestBarW = bars[bars.length - 1] ?? null;
  const latestUtcIsoW = latestBarW?.t != null ? new Date(latestBarW.t).toISOString() : null;
  const latestEtDateTimeW = latestBarW?.t != null ? formatEtDateTime(latestBarW.t) : null;
  bars.sort((a, b) => a.t - b.t);
  await yearRef.set({
    bars,
    count: bars.length,
    firstBarTs: bars[0]?.t ?? null,
    lastBarTs: bars[bars.length - 1]?.t ?? null,
    latest: latestBarW,
    latestUtcIso: latestUtcIsoW,
    latestEtDateTime: latestEtDateTimeW,
    updatedAt: Timestamp.now(),
  }, { merge: true });

  await bumpTimeSeriesTopLevelMetadata({
    symbol,
    endpoint,
    interval: TimeSeriesInterval.WEEKLY,
    latestDate: date,
  });
}

/**
 * Upserts a single monthly bar (YYYY-MM-DD) into the MONTHLY single `all` doc.
 * - Merges, sorts ascending, updates aggregates, and bumps parent metadata
 *
 * @deprecated Use `mergeMonthlyCompactWindowIntoAllDocs()` for monthly compact flows instead.
 * This helper is retained for legacy callers that still perform per-bar monthly upserts.
 *
 * @param options.symbol Stock symbol
 * @param options.date ISO date (UTC month anchor)
 * @param options.patch Partial CompactBar numeric fields to merge
 * @param options.endpoint Defaults to TIME_SERIES_MONTHLY_ADJUSTED
 * @returns Promise that resolves on success
 */
export async function upsertAvMonthlyBar(options: {
  symbol: string;
  date: string; // YYYY-MM-DD (UTC day)
  patch: Partial<CompactBar>;
  endpoint?: AlphaVantageEndpoint; // defaults to MONTHLY_ADJUSTED
}): Promise<void> {
  const { symbol, date, patch, endpoint = AlphaVantageEndpoint.TIME_SERIES_MONTHLY_ADJUSTED } = options;
  const vendor = ApiProvider.ALPHA_VANTAGE;
  const allDocPath = getSymbolTimeSeriesAllDocPath(symbol, endpoint, vendor);
  const allRef = db.doc(allDocPath);
  const snap = await allRef.get();
  const bars: CompactBar[] = snap.exists ? (snap.get('bars') ?? []) : [];
  const t = new Date(`${date}T00:00:00.000Z`).getTime();

  const idx = bars.findIndex((b) => b.t === t);
  if (idx >= 0) {
    const existing = bars[idx];
    const patchBar = {
      o: Number(patch.o ?? existing.o ?? 0),
      h: Number(patch.h ?? existing.h ?? patch.o ?? 0),
      l: Number(patch.l ?? existing.l ?? patch.o ?? 0),
      c: Number(patch.c ?? existing.c ?? 0),
      v: Number(patch.v ?? existing.v ?? 0),
      ac: Number(patch.ac ?? existing.ac ?? patch.c ?? existing.c ?? 0),
      dv: Number(patch.dv ?? existing.dv ?? 0),
      sc: Number(patch.sc ?? existing.sc ?? 1),
      dow: computeDowFromDateString(new Date(t).toISOString().slice(0, 10)),
    } as Partial<CompactBar> & { o: number; h: number; l: number; c: number; v: number; ac: number; dv: number; sc: number };
    bars[idx] = { ...existing, ...patchBar } as CompactBar;
  } else {
    const newBar: CompactBar = {
      t,
      d: new Date(t).toISOString().slice(0, 10),
      dow: computeDowFromDateString(new Date(t).toISOString().slice(0, 10)),
      o: Number(patch.o ?? 0),
      h: Number(patch.h ?? (patch.o ?? 0)),
      l: Number(patch.l ?? (patch.o ?? 0)),
      c: Number(patch.c ?? 0),
      v: Number(patch.v ?? 0),
      ac: Number(patch.ac ?? patch.c ?? 0),
      dv: Number(patch.dv ?? 0),
      sc: Number(patch.sc ?? 1),
      ic: null,
      ipc: null,
    };
    bars.push(newBar);
  }

  // Sort ascending for deterministic writes
  const latestBarM = bars[bars.length - 1] ?? null;
  const latestUtcIsoM = latestBarM?.t != null ? new Date(latestBarM.t).toISOString() : null;
  const latestEtDateTimeM = latestBarM?.t != null ? formatEtDateTime(latestBarM.t) : null;
  bars.sort((a, b) => a.t - b.t);
  await allRef.set({
    bars,
    count: bars.length,
    firstBarTs: bars[0]?.t ?? null,
    lastBarTs: bars[bars.length - 1]?.t ?? null,
    latest: latestBarM,
    latestUtcIso: latestUtcIsoM,
    latestEtDateTime: latestEtDateTimeM,
    updatedAt: Timestamp.now(),
  }, { merge: true });

  await bumpTimeSeriesTopLevelMetadata({
    symbol,
    endpoint,
    interval: TimeSeriesInterval.MONTHLY,
    latestDate: date,
  });
}

/**
 * Canonical merge path for AV TIME_SERIES_WEEKLY_ADJUSTED compact windows.
 *
 * Semantics:
 * - Sorts the incoming weekly bars by date and considers only the latest AV
 *   bar from the compact window.
 * - Loads the year-sharded SA weekly doc for the year of that AV bar.
 * - If the existing latest bar in that shard falls in the same Monday-based
 *   calendar week as the AV bar, overwrites it; otherwise appends a new bar.
 * - When writing the first bar into a new year shard, also checks the last bar
 *   in the prior-year shard and removes it if it belongs to the same week, so
 *   that the week is represented exactly once across all shards.
 *
 * This enforces a strict one-bar-per-calendar-week invariant for the weekly
 * adjusted series while trusting AV for the bar contents.
 */
export async function mergeWeeklyCompactWindowIntoShards(options: {
  symbol: string;
  endpoint: AlphaVantageEndpoint;
  storageBars: Array<{
    date: string;
    open: number;
    high: number;
    low: number;
    close: number;
    volume: number;
    adjustedClose?: number;
    dividendAmount?: number;
    splitCoefficient?: number;
  }>;
}): Promise<void> {
  const { symbol, endpoint, storageBars } = options;
  if (!Array.isArray(storageBars) || storageBars.length === 0) {
    return;
  }

  const vendor = ApiProvider.ALPHA_VANTAGE;

  const parseDateYear = (dStr: string): number | null => {
    const ts = new Date(`${dStr}T00:00:00.000Z`).getTime();
    if (!Number.isFinite(ts)) return null;
    return getYearFromEpochMillis(ts);
  };

  const weekStart = (dateStr: string): string => {
    const d = new Date(`${dateStr}T00:00:00.000Z`);
    const day = d.getUTCDay(); // 0=Sun,1=Mon,..6=Sat
    const diff = day === 0 ? -6 : 1 - day; // move back to Monday
    d.setUTCDate(d.getUTCDate() + diff);
    return d.toISOString().slice(0, 10);
  };

  const sameWeek = (d1: string, d2: string): boolean => weekStart(d1) === weekStart(d2);

  // Sort incoming AV weekly bars and take the latest one only.
  const sorted = [...storageBars].sort((a, b) => {
    const ta = new Date(`${a.date}T00:00:00.000Z`).getTime();
    const tb = new Date(`${b.date}T00:00:00.000Z`).getTime();
    return ta - tb;
  });
  const lastAv = sorted[sorted.length - 1];
  const lastAvDate = lastAv.date;
  const lastAvYear = parseDateYear(lastAvDate);
  if (lastAvYear == null) {
    return;
  }

  const yearDocPath = getSymbolTimeSeriesYearDocPath(symbol, endpoint, vendor, lastAvYear);
  const ref = db.doc(yearDocPath);
  const snap = await ref.get();
  const existingBars: CompactBar[] = snap.exists ? ((snap.get('bars') ?? []) as CompactBar[]) : [];

  if (!existingBars.length) {
    // This is the first bar for this year shard. We may need to drop an in-progress
    // bar that lives at the end of the prior-year shard but belongs to the same
    // calendar week as lastAvDate.
    const priorYear = lastAvYear - 1;
    if (Number.isFinite(priorYear)) {
      const priorYearDocPath = getSymbolTimeSeriesYearDocPath(symbol, endpoint, vendor, priorYear);
      const priorRef = db.doc(priorYearDocPath);
      const priorSnap = await priorRef.get();
      if (priorSnap.exists) {
        const priorBars: CompactBar[] = (priorSnap.get('bars') ?? []) as CompactBar[];
        if (priorBars.length) {
          const priorLast = priorBars[priorBars.length - 1];
          const priorLastDate = typeof priorLast.d === 'string' && priorLast.d.length >= 10
            ? priorLast.d.slice(0, 10)
            : (typeof priorLast.t === 'number'
              ? new Date(priorLast.t).toISOString().slice(0, 10)
              : null);

          if (priorLastDate && sameWeek(priorLastDate, lastAvDate)) {
            // Drop the last bar in the prior-year shard; its week will now be
            // represented solely by the bar we are about to write in the new
            // year shard.
            priorBars.pop();

            priorBars.sort((a, b) => a.t - b.t);

            const latestNonPlaceholderPrior = [...priorBars].reverse().find((bar) => {
              const o = Number(bar.o || 0), h = Number(bar.h || 0), l = Number(bar.l || 0), c = Number(bar.c || 0), v = Number(bar.v || 0);
              return o !== 0 || h !== 0 || l !== 0 || c !== 0 || v !== 0;
            }) ?? (priorBars[priorBars.length - 1] ?? null);
            const latestUtcIsoPrior = latestNonPlaceholderPrior?.t != null ? new Date(latestNonPlaceholderPrior.t).toISOString() : null;
            const latestEtDateTimePrior = latestNonPlaceholderPrior?.t != null ? formatEtDateTime(latestNonPlaceholderPrior.t) : null;

            await priorRef.set({
              bars: priorBars,
              count: priorBars.length,
              firstBarTs: priorBars[0]?.t ?? null,
              lastBarTs: priorBars[priorBars.length - 1]?.t ?? null,
              latest: latestNonPlaceholderPrior,
              latestUtcIso: latestUtcIsoPrior,
              latestEtDateTime: latestEtDateTimePrior,
              updatedAt: Timestamp.now(),
            }, { merge: true });
          }
        }
      }
    }

    // We expect backfill to have populated history, but guard anyway.
    const t = new Date(`${lastAvDate}T00:00:00.000Z`).getTime();
    const newBar: CompactBar = {
      t,
      d: lastAvDate,
      dow: computeDowFromDateString(lastAvDate),
      o: Number(lastAv.open),
      h: Number(lastAv.high),
      l: Number(lastAv.low),
      c: Number(lastAv.close),
      v: Number(lastAv.volume),
      ac: lastAv.adjustedClose != null ? Number(lastAv.adjustedClose) : undefined,
      dv: lastAv.dividendAmount != null ? Number(lastAv.dividendAmount) : undefined,
      sc: lastAv.splitCoefficient != null ? Number(lastAv.splitCoefficient) : undefined,
      ic: null,
      ipc: null,
    };
    existingBars.push(newBar);
  } else {
    const lastFs = existingBars[existingBars.length - 1];
    const lastFsDate = typeof lastFs.d === 'string' && lastFs.d.length >= 10
      ? lastFs.d.slice(0, 10)
      : new Date(lastFs.t).toISOString().slice(0, 10);

    const t = new Date(`${lastAvDate}T00:00:00.000Z`).getTime();
    const newBar: CompactBar = {
      t,
      d: lastAvDate,
      dow: computeDowFromDateString(lastAvDate),
      o: Number(lastAv.open),
      h: Number(lastAv.high),
      l: Number(lastAv.low),
      c: Number(lastAv.close),
      v: Number(lastAv.volume),
      ac: lastAv.adjustedClose != null ? Number(lastAv.adjustedClose) : undefined,
      dv: lastAv.dividendAmount != null ? Number(lastAv.dividendAmount) : undefined,
      sc: lastAv.splitCoefficient != null ? Number(lastAv.splitCoefficient) : undefined,
      ic: null,
      ipc: null,
    };

    if (sameWeek(lastFsDate, lastAvDate)) {
      // Same calendar week: overwrite the latest bar with the new AV bar.
      existingBars[existingBars.length - 1] = newBar;
    } else {
      // New week: append the new AV bar.
      existingBars.push(newBar);
    }
  }

  existingBars.sort((a, b) => a.t - b.t);

  const latestNonPlaceholder = [...existingBars].reverse().find((bar) => {
    const o = Number(bar.o || 0), h = Number(bar.h || 0), l = Number(bar.l || 0), c = Number(bar.c || 0), v = Number(bar.v || 0);
    return o !== 0 || h !== 0 || l !== 0 || c !== 0 || v !== 0;
  }) ?? (existingBars[existingBars.length - 1] ?? null);
  const latestUtcIso = latestNonPlaceholder?.t != null ? new Date(latestNonPlaceholder.t).toISOString() : null;
  const latestEtDateTime = latestNonPlaceholder?.t != null ? formatEtDateTime(latestNonPlaceholder.t) : null;

  await ref.set({
    bars: existingBars,
    count: existingBars.length,
    firstBarTs: existingBars[0]?.t ?? null,
    lastBarTs: existingBars[existingBars.length - 1]?.t ?? null,
    latest: latestNonPlaceholder,
    latestUtcIso,
    latestEtDateTime,
    updatedAt: Timestamp.now(),
  }, { merge: true });

  const latestDateForMeta = typeof latestNonPlaceholder?.d === 'string' && latestNonPlaceholder.d.length >= 10
    ? latestNonPlaceholder.d
    : (latestNonPlaceholder?.t != null ? new Date(latestNonPlaceholder.t).toISOString().slice(0, 10) : null);

  if (latestDateForMeta) {
    await bumpTimeSeriesTopLevelMetadata({
      symbol,
      endpoint,
      interval: TimeSeriesInterval.WEEKLY,
      latestDate: latestDateForMeta,
    });
  }
}

/**
 * Merge a compact MONTHLY window into the single monthly `all` doc.
 *
 * Semantics:
 * - Uses a date key (YYYY-MM-DD) per bar and merges incoming bars into an in-memory map
 *   keyed by trading date.
 * - For each date in the compact window, replaces or inserts that month in the `all` doc.
 * - Preserves existing months outside the compact window.
 * - Runs only for the split-adjusted series (`sa-time-series`).
 * - Keeps `bars` sorted ascending by `t` and refreshes count/first/last/`latest*` fields.
 * - After writes, bumps the top-level MONTHLY metadata via `bumpTimeSeriesTopLevelMetadata`.
 */
export async function mergeMonthlyCompactWindowIntoAllDocs(options: {
  symbol: string;
  endpoint: AlphaVantageEndpoint;
  storageBars: Array<{
    date: string;
    open: number;
    high: number;
    low: number;
    close: number;
    volume: number;
    adjustedClose?: number;
    dividendAmount?: number;
    splitCoefficient?: number;
  }>;
}): Promise<void> {
  const { symbol, endpoint, storageBars } = options;
  if (!Array.isArray(storageBars) || storageBars.length === 0) {
    return;
  }

  const vendor = ApiProvider.ALPHA_VANTAGE;

  const ensureDate = (bar: CompactBar): string => {
    if (typeof bar.d === 'string' && bar.d.length >= 10) {
      return bar.d.slice(0, 10);
    }
    if (typeof bar.t === 'number') {
      return new Date(bar.t).toISOString().slice(0, 10);
    }
    return '';
  };

  let latestDateForMeta: string | null = null;

  // Adjusted-only: write exclusively to sa-time-series.
  const allDocPath = getSymbolTimeSeriesAllDocPath(symbol, endpoint, vendor);
  const ref = db.doc(allDocPath);
  const snap = await ref.get();
  const existingBars: CompactBar[] = snap.exists ? ((snap.get('bars') ?? []) as CompactBar[]) : [];

  const map = new Map<string, CompactBar>();
  for (const bar of existingBars) {
    const dStr = ensureDate(bar);
    if (!dStr) continue;
    map.set(dStr, bar);
  }

  // Limit writes to a small tip window to avoid rewriting the full compact
  // history on every run. For MONTHLY we overwrite only the last 2 bars using
  // AV as the source of truth, preserving all older history when present.
  const WINDOW_SIZE = 2;
  const sortedStorageBars = [...storageBars].sort((a, b) => {
    const ta = new Date(`${a.date}T00:00:00.000Z`).getTime();
    const tb = new Date(`${b.date}T00:00:00.000Z`).getTime();
    return ta - tb;
  });
  const windowBars = sortedStorageBars.slice(-WINDOW_SIZE);

  for (const b of windowBars) {
    const t = new Date(`${b.date}T00:00:00.000Z`).getTime();
    if (!Number.isFinite(t)) continue;
    const dStr = new Date(t).toISOString().slice(0, 10);

    // Enforce a single bar per calendar month: before inserting this bar
    // for YYYY-MM, remove any existing entries in the same month so only
    // the latest monthly bar (from AV) is retained.
    const monthKey = dStr.slice(0, 7); // YYYY-MM
    for (const [k] of map) {
      if (k.slice(0, 7) === monthKey) {
        map.delete(k);
      }
    }

    const existing = map.get(dStr);
    const dow = computeDowFromDateString(dStr);

    const merged: CompactBar = {
      ...(existing ?? {} as CompactBar),
      t,
      d: dStr,
      dow,
      o: Number(b.open),
      h: Number(b.high),
      l: Number(b.low),
      c: Number(b.close),
      v: Number(b.volume),
      ac: b.adjustedClose != null ? Number(b.adjustedClose) : (existing?.ac),
      dv: b.dividendAmount != null ? Number(b.dividendAmount) : (existing?.dv),
      sc: b.splitCoefficient != null ? Number(b.splitCoefficient) : (existing?.sc),
      ic: existing?.ic ?? null,
      ipc: existing?.ipc ?? null,
    } as CompactBar;

    map.set(dStr, merged);
  }

  const mergedBars = Array.from(map.values());
  if (mergedBars.length === 0) {
    return;
  }

  mergedBars.sort((a, b) => a.t - b.t);

  const latestNonPlaceholder = [...mergedBars].reverse().find((bar) => {
    const o = Number(bar.o || 0), h = Number(bar.h || 0), l = Number(bar.l || 0), c = Number(bar.c || 0), v = Number(bar.v || 0);
    return o !== 0 || h !== 0 || l !== 0 || c !== 0 || v !== 0;
  }) ?? (mergedBars[mergedBars.length - 1] ?? null);
  const latestUtcIso = latestNonPlaceholder?.t != null ? new Date(latestNonPlaceholder.t).toISOString() : null;
  const latestEtDateTime = latestNonPlaceholder?.t != null ? formatEtDateTime(latestNonPlaceholder.t).toString() : null;

  await ref.set({
    bars: mergedBars,
    count: mergedBars.length,
    firstBarTs: mergedBars[0]?.t ?? null,
    lastBarTs: mergedBars[mergedBars.length - 1]?.t ?? null,
    latest: latestNonPlaceholder,
    latestUtcIso,
    latestEtDateTime,
    updatedAt: Timestamp.now(),
  }, { merge: true });

  // Use latest date from mergedBars for top-level metadata.
  const last = mergedBars[mergedBars.length - 1];
  const dLast = typeof last.d === 'string' && last.d.length >= 10
    ? last.d
    : new Date(last.t).toISOString().slice(0, 10);
  latestDateForMeta = dLast;

  if (latestDateForMeta) {
    await bumpTimeSeriesTopLevelMetadata({
      symbol,
      endpoint,
      interval: TimeSeriesInterval.MONTHLY,
      latestDate: latestDateForMeta,
    });
  }
}

/**
 * Upsert intraday snapshot fields for the given DAILY trading date, creating the day bar if needed.
 * - Only sets intraday fields (ip/io/it) and optional delta (ic/ipc); does not compute EOD ch/cp here.
 * - Does not bump parent metadata to avoid churn during trading hours.
 * @param options.symbol Stock symbol
 * @param options.date ISO date for the trading day (ET-derived)
 * @param options.ip Latest intraday price
 * @param options.io Epoch ms of latest intraday bar timestamp
 * @param options.dow Required DayOfWeek label (ET)
 * @returns Promise that resolves on success
 */
export async function upsertAvDailyIntradaySnapshot(options: {
  symbol: string;
  date: string; // YYYY-MM-DD (ET-derived trading date)
  ip: number;   // latest intraday price
  io: number;   // epoch ms of the latest intraday bar timestamp
  dow: DayOfWeek; // required human-readable day-of-week (ET)
}): Promise<void> {
  const { symbol, date, ip, io, dow } = options;
  const vendor = ApiProvider.ALPHA_VANTAGE;
  const t = new Date(`${date}T00:00:00.000Z`).getTime();
  const y = getYearFromEpochMillis(t);
  const yearDocPath = getSymbolTimeSeriesYearDocPath(symbol, AlphaVantageEndpoint.TIME_SERIES_DAILY_ADJUSTED, vendor, y);
  const yearRef = db.doc(yearDocPath);

  console.log(`[upsertAvDailyIntradaySnapshot] Starting transaction for ${symbol} at path: ${yearDocPath}`);

  await db.runTransaction(async (tx) => {
    const snap = await tx.get(yearRef);
    const bars: CompactBar[] = snap.exists ? ((snap.get('bars') ?? []) as CompactBar[]) : [];

    // locate or create the day bar, updating only intraday fields
    let idx = bars.findIndex((b) => b.t === t);
    if (idx < 0) {
      const itStr = new Intl.DateTimeFormat('en-US', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'America/New_York' }).format(new Date(io));
      const prevCandidate = bars.reduce<CompactBar | null>((p, b) => (b.t < t && (!p || b.t > p.t)) ? b : p, null as any);
      const prevClose = prevCandidate && (typeof (prevCandidate as any).ac === 'number' ? (prevCandidate as any).ac : (prevCandidate as any).c);
      const icVal = Number.isFinite(Number(prevClose)) ? Number((Number(ip) - Number(prevClose)).toFixed(2)) : 0;
      const ipcVal = Number.isFinite(Number(prevClose)) && Number(prevClose) !== 0 ? Number((((Number(ip) - Number(prevClose)) / Number(prevClose)) * 100).toFixed(2)) : 0;
      const newBar: CompactBar = {
        t,
        d: new Date(t).toISOString().slice(0, 10),
        dow,
        o: 0, h: 0, l: 0, c: 0, v: 0, ac: 0, dv: 0, sc: 1,
        ip: Number(ip),
        io: Number(io),
        it: itStr,
        ic: icVal,
        ipc: ipcVal,
      };
      bars.push(newBar);
      idx = bars.length - 1;
    } else {
      const existing = bars[idx];
      const itStr = new Intl.DateTimeFormat('en-US', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'America/New_York' }).format(new Date(io));
      const prevCandidate = bars.reduce<CompactBar | null>((p, b) => (b.t < t && (!p || b.t > p.t)) ? b : p, null as any);
      const prevClose = prevCandidate && (typeof (prevCandidate as any).ac === 'number' ? (prevCandidate as any).ac : (prevCandidate as any).c);
      const icVal = Number.isFinite(Number(prevClose)) ? Number((Number(ip) - Number(prevClose)).toFixed(2)) : 0;
      const ipcVal = Number.isFinite(Number(prevClose)) && Number(prevClose) !== 0 ? Number((((Number(ip) - Number(prevClose)) / Number(prevClose)) * 100).toFixed(2)) : 0;
      bars[idx] = { ...existing, ip: Number(ip), io: Number(io), it: itStr, ic: icVal, ipc: ipcVal } as CompactBar;
    }

    bars.sort((a, b) => a.t - b.t);

    const latestBar = bars[bars.length - 1] ?? null;
    const latestUtcIso = latestBar?.t != null ? new Date(latestBar.t).toISOString() : null;
    const latestEtDateTime = latestBar?.t != null ? formatEtDateTime(latestBar.t) : null;
    const latestIoUtcIso = latestBar?.io != null ? new Date(Number(latestBar.io)).toISOString() : null;
    const latestIoEtDateTime = latestBar?.io != null ? formatEtDateTime(Number(latestBar.io)) : null;
    const version = `${bars[bars.length - 1]?.t ?? ''}-${bars.length}`;

    const finalVersion = version;
    tx.set(yearRef, {
      bars,
      count: bars.length,
      firstBarTs: bars[0]?.t ?? null,
      lastBarTs: bars[bars.length - 1]?.t ?? null,
      latest: latestBar,
      latestUtcIso,
      latestEtDateTime,
      latestIoUtcIso,
      latestIoEtDateTime,
      version: finalVersion,
      updatedAt: Timestamp.now(),
    }, { merge: true });
    console.log(`[upsertAvDailyIntradaySnapshot] Transaction set for ${symbol}, version: ${finalVersion}`);
  });

  console.log(`[upsertAvDailyIntradaySnapshot] Transaction committed for ${symbol} at path: ${yearDocPath}`);
}

/**
 * Bump the top-level time-series metadata for console visibility after a write.
 *
 * Semantics:
 * - Always sets `lastUpdated`, `nextRefreshAt`, `ttlSeconds`, `vendor`, and `endpoint`.
 * - For DAILY/WEEKLY: derives `histStartTs`, `histEndTs`, and `availableYears` from the
 *   underlying `years/{YYYY}` shards when present.
 * - For MONTHLY: derives bounds and `availableYears` from the raw monthly `all` doc bars.
 * - Falls back to `latestDate` when no bars are found (e.g., first write or partial series).
 * - Writes `histStartDate`/`histEndDate` (Timestamp), `histStartTs`/`histEndTs` (ms),
 *   and `availableYears` when derivable, plus `latestBarTimestamp` aligned to `histEndTs`.
 *
 * This function is the canonical way writers keep parent time-series metadata in sync with
 * the actual stored bar arrays, and is used by daily upserts, weekly/monthly merges, and
 * repair tooling.
 *
 * @param options.symbol Stock symbol
 * @param options.endpoint AV endpoint id
 * @param options.interval TimeSeriesInterval
 * @param options.latestDate ISO date used as a fallback for histStartTs/EndTs
 * @param options.vendor Optional provider (defaults AV)
 * @returns Promise that resolves on success
 */
export async function bumpTimeSeriesTopLevelMetadata(options: {
  symbol: string;
  endpoint: AlphaVantageEndpoint;
  interval: TimeSeriesInterval;
  latestDate: string; // YYYY-MM-DD (UTC)
  vendor?: ApiProvider;
}): Promise<void> {
  const { symbol, endpoint, interval, latestDate, vendor = ApiProvider.ALPHA_VANTAGE } = options;
  try {
    const endpointConfig = AV_TIME_SERIES_ENDPOINT_CONFIGS[endpoint];
    if (!endpointConfig || typeof endpointConfig.ttl !== 'number') {
      throw new Error(`bumpTSMeta ttl missing for endpoint=${endpoint}`);
    }
    const ttlSeconds = endpointConfig.ttl;
    // Time-series job pipeline now treats the split-adjusted series as canonical.
    // Use the adjusted series doc as the parent for metadata.
    const docPath = getSymbolTimeSeriesDocPath(symbol, endpoint, vendor);
    const docRef = db.doc(docPath);
    const latestTsFromDate = new Date(`${latestDate}T00:00:00.000Z`).getTime();

    // Derive histStartTs, histEndTs, and availableYears from actual shards/all-doc when possible.
    let histStartTs: number | null = null;
    let histEndTs: number | null = null;
    let availableYears: number[] = [];

    if (interval === TimeSeriesInterval.MONTHLY) {
      // Use the adjusted monthly all-doc as the source of truth for date bounds/years.
      const allPath = getSymbolTimeSeriesAllDocPath(symbol, endpoint, vendor);
      const allSnap = await db.doc(allPath).get();
      if (allSnap.exists) {
        const data = allSnap.data() as any;
        const bars: Array<{ t?: number }> = Array.isArray(data?.bars) ? data.bars : [];
        if (bars.length) {
          const first = bars[0];
          const last = bars[bars.length - 1];
          const firstTs = typeof first?.t === 'number' ? first.t : NaN;
          const lastTs = typeof last?.t === 'number' ? last.t : NaN;
          if (Number.isFinite(firstTs)) histStartTs = firstTs;
          if (Number.isFinite(lastTs)) histEndTs = lastTs;
          const yearSet = new Set<number>();
          for (const b of bars) {
            const t = typeof b?.t === 'number' ? b.t : NaN;
            if (!Number.isFinite(t)) continue;
            const y = new Date(t).getUTCFullYear();
            if (Number.isFinite(y)) yearSet.add(y);
          }
          availableYears = Array.from(yearSet).sort((a, b) => a - b);
        }
      }
    } else {
      // Daily/Weekly: inspect the adjusted years subcollection and derive bounds from earliest/latest year shards.
      const yearsColPath = `${docPath}/years`;
      const yearsSnap = await db.collection(yearsColPath).get();
      const years = yearsSnap.docs.map(d => Number(d.id)).filter(n => Number.isFinite(n)).sort((a, b) => a - b);
      if (years.length) {
        availableYears = years;
        const earliestYear = years[0];
        const latestYear = years[years.length - 1];

        const earliestPath = getSymbolTimeSeriesYearDocPath(symbol, endpoint, vendor, earliestYear);
        const latestPath = getSymbolTimeSeriesYearDocPath(symbol, endpoint, vendor, latestYear);
        const [earliestSnap, latestSnap] = await Promise.all([
          db.doc(earliestPath).get(),
          db.doc(latestPath).get(),
        ]);

        if (earliestSnap.exists) {
          const eData = earliestSnap.data() as any;
          const eBars: Array<{ t?: number }> = Array.isArray(eData?.bars) ? eData.bars : [];
          if (eBars.length) {
            const first = eBars[0];
            const firstTs = typeof first?.t === 'number' ? first.t : NaN;
            if (Number.isFinite(firstTs)) histStartTs = firstTs;
          }
        }

        if (latestSnap.exists) {
          const lData = latestSnap.data() as any;
          const lBars: Array<{ t?: number }> = Array.isArray(lData?.bars) ? lData.bars : [];
          if (lBars.length) {
            const last = lBars[lBars.length - 1];
            const lastTs = typeof last?.t === 'number' ? last.t : NaN;
            if (Number.isFinite(lastTs)) histEndTs = lastTs;
          }
        }
      }
    }

    // Fallbacks: if we couldn't derive bounds from shards, fall back to latestDate when valid.
    if (!Number.isFinite(histStartTs as number) && Number.isFinite(latestTsFromDate)) {
      histStartTs = latestTsFromDate;
    }
    if (!Number.isFinite(histEndTs as number) && Number.isFinite(latestTsFromDate)) {
      histEndTs = latestTsFromDate;
    }

    const now = Timestamp.now();
    // Coarse next-run indicator: approx next day. This matches the adjusted
    // writer path and keeps metadata consistent for live compact updates.
    const nextPostRunAt = Timestamp.fromDate(new Date(Date.now() + 24 * 60 * 60 * 1000));

    const payload: any = {
      metadata: {
        symbol,
        interval,
        lastUpdated: now,
        nextRefreshAt: nextPostRunAt,
        ttlSeconds,
        vendor,
        endpoint,
        histEndDate: Number.isFinite(histEndTs as number) ? Timestamp.fromMillis(histEndTs as number) : null,
        histEndTs: Number.isFinite(histEndTs as number) ? histEndTs : null,
      },
      latestBarTimestamp: Number.isFinite(histEndTs as number) ? Timestamp.fromMillis(histEndTs as number) : null,
    };

    if (Number.isFinite(histStartTs as number)) {
      (payload.metadata as any).histStartTs = histStartTs;
      (payload.metadata as any).histStartDate = Timestamp.fromMillis(histStartTs as number);
    }
    if (Array.isArray(availableYears) && availableYears.length) {
      (payload.metadata as any).availableYears = availableYears;
    }

    await docRef.set(payload, { merge: true });

    // Also hydrate symbol-data so live compact updates maintain the same
    // presence/metadata expectations as full writes.
    const symbolDocRef = db.doc(`${FirestoreCollection.SYMBOL_DATA}/${symbol}`);
    await symbolDocRef.set({
      nextRefreshAt: nextPostRunAt,
      nextRefreshBy: '',
      refreshedAt: now,
      refreshedBy: 'time-series-write',
    }, { merge: true });
  } catch (e: any) {
    console.error('bumpTSMeta error', String(e?.message || e));
  }
}

/**
 * Fetch the previous trading day's adjusted close for a symbol/endpoint by reading the year docs.
 * - Searches current and previous year docs for the latest bar with t < current day
 * - Returns ac if present, else c; null if not found
 * @param options.symbol Stock symbol
 * @param options.date Current trading day (YYYY-MM-DD UTC)
 * @param options.endpoint Defaults to TIME_SERIES_DAILY_ADJUSTED
 * @returns Previous adjusted close number or null
 */
export async function getPreviousAdjustedClose(options: {
  symbol: string;
  date: string; // YYYY-MM-DD UTC current trading day
  endpoint?: AlphaVantageEndpoint; // defaults to DAILY_ADJUSTED
}): Promise<number | null> {
  const { symbol, date, endpoint = AlphaVantageEndpoint.TIME_SERIES_DAILY_ADJUSTED } = options;
  const vendor = ApiProvider.ALPHA_VANTAGE;
  // Current day midnight UTC and year docs to check
  const currTs = new Date(`${date}T00:00:00.000Z`).getTime();
  if (!Number.isFinite(currTs)) return null;
  const currYear = getYearFromEpochMillis(currTs);
  const prevYear = currYear - 1;
  const paths = [
    getSymbolTimeSeriesYearDocPath(symbol, endpoint, vendor, currYear),
    getSymbolTimeSeriesYearDocPath(symbol, endpoint, vendor, prevYear),
  ];
  let candidate: CompactBar | null = null;
  for (const path of paths) {
    const ref = db.doc(path);
    const snap = await ref.get();
    const bars: CompactBar[] = snap.exists ? (snap.get('bars') ?? []) : [];
    if (!Array.isArray(bars) || bars.length === 0) continue;
    // Bars are persisted sorted ascending by t.
    // We want the most recent prior trading day: last bar with t < currTs.
    for (let i = bars.length - 1; i >= 0; i--) {
      const bt = bars[i]?.t;
      if (typeof bt !== 'number') continue;
      if (bt < currTs) {
        candidate = bars[i];
        break;
      }
    }
    if (candidate) break; // found in current year; no need to check prior year
  }
  if (!candidate) return null;
  if (typeof candidate.ac === 'number' && Number.isFinite(candidate.ac)) return candidate.ac;
  if (typeof candidate.c === 'number' && Number.isFinite(candidate.c)) return candidate.c;
  return null;
}

/**
 * Compute DayOfWeek label from a trading date string (YYYY-MM-DD) using UTC midnight.
 * @param d ISO date string (YYYY-MM-DD)
 * @returns DayOfWeek label (Sun..Sat)
 */
function computeDowFromDateString(d: string): DayOfWeek {
  const dt = new Date(`${d}T00:00:00.000Z`);
  const day = dt.getUTCDay(); // 0=Sun..6=Sat
  switch (day) {
    case 0: return DayOfWeek.Sun;
    case 1: return DayOfWeek.Mon;
    case 2: return DayOfWeek.Tue;
    case 3: return DayOfWeek.Wed;
    case 4: return DayOfWeek.Thu;
    case 5: return DayOfWeek.Fri;
    case 6: return DayOfWeek.Sat;
    default: return DayOfWeek.Mon;
  }
}

/**
 * Format an Eastern Time date-time string 'YYYY-MM-DD HH:mm:ss' for an epoch millis.
 * @param tsMs Epoch milliseconds
 * @returns ET formatted string with seconds precision
 */
function formatEtDateTime(tsMs: number): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/New_York',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
  }).formatToParts(new Date(tsMs));
  const m = Object.fromEntries(parts.map(p => [p.type, p.value]));
  return `${m.year}-${m.month}-${m.day} ${m.hour}:${m.minute}:${m.second}`;
}

/**
 * Helper: round a number to 2 decimal places.
 * @param n Number to round
 * @returns Rounded number
 */
function round2(n: number): number { return Math.round(n * 100) / 100; }

/**
 * Compute EOD change metrics for a sorted array of bars in-place.
 * - ch = currClose - prevClose
 * - cp = (ch / prevClose) * 100
 * - Uses RAW close (c) only as the baseline; omits when baseline is missing/zero.
 * @param bars Sorted ascending array of CompactBar
 */
function computeChCpForBarsAscending(bars: Array<CompactBar>): void {
  if (!Array.isArray(bars) || bars.length === 0) return;
  // Assume already sorted ascending by t.
  for (let i = 0; i < bars.length; i++) {
    const curr = bars[i];
    const prev = i > 0 ? bars[i - 1] : undefined;
    const prevClose = prev?.c;
    const currClose = curr?.c;
    if (prevClose != null && prevClose !== 0 && currClose != null) {
      const change = currClose - prevClose;
      const pct = (change / prevClose) * 100;
      curr.ch = round2(change);
      curr.cp = round2(pct);
    } else {
      delete (curr as any).ch;
      delete (curr as any).cp;
    }
  }
}

/**
 * Recompute EOD change metrics for a specific index within a sorted bars array.
 * - Uses the immediate previous bar as the baseline.
 * - Uses RAW close (c) only and omits when baseline is missing/zero.
 * @param bars Sorted ascending array of CompactBar
 * @param index Index of the target bar to recompute
 */
function computeChCpForTargetIndex(bars: Array<CompactBar>, index: number): void {
  if (!Array.isArray(bars) || index < 0 || index >= bars.length) return;
  const curr = bars[index];
  const prev = index > 0 ? bars[index - 1] : undefined;
  const prevClose = prev?.c;
  const currClose = curr?.c;
  if (prevClose != null && prevClose !== 0 && currClose != null) {
    const change = currClose - prevClose;
    const pct = (change / prevClose) * 100;
    curr.ch = round2(change);
    curr.cp = round2(pct);
  } else {
    delete (curr as any).ch;
    delete (curr as any).cp;
  }
}

