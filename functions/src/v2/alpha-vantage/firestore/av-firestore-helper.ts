import { db } from '../../../firebase-admin-init';
import { Timestamp, WriteBatch } from 'firebase-admin/firestore';

import { AlphaVantageEndpoint, AV_TIME_SERIES_ENDPOINT_CONFIGS, OutputSize, TimeSeriesInterval } from '@shared/alpha-vantage';
import { ApiProvider, ApiResponse } from '@shared/core';
import { FirestoreCollection } from '@shared/firestore';
import type { EndpointConfig } from '@shared/core';
import type { CompactBar } from '@shared/alpha-vantage';

import { RefreshLoggerService } from '../../services/refresh-logger.service';

import { isManualWriteEnabled } from '../../common/firestore/manual-write-toggle';
import { RefreshStatus, RefreshTrigger } from '../../common/refresh.types';
import { getSymbolTimeSeriesDocPath } from '../../common/firestore/firestore-paths';
import {
  getSymbolTimeSeriesYearDocPath,
  getSymbolTimeSeriesAllDocPath,
  getYearFromEpochMillis,
} from '../../common/firestore/firestore-paths';
import { createLogger } from '../../utils/utils';

const log = createLogger('av.ts'); // Abbrev: aFH sATSD

/**
 * Saves Alpha Vantage STANDARD (non-time-series) data to Firestore and logs refresh event using RefreshLoggerService.
 * @param data - The data to save
 * @param symbol - The symbol
 * @param endpoint - The Alpha Vantage endpoint
 * @param endpointConfig - The endpoint configuration
 * @param checkManualWriteEnabled - REQUIRED: must always be set by caller. If true, enforces the manual Firestore write toggle. Pass false for scheduled jobs.
 */
export async function saveAvData(
  data: any,
  symbol: string,
  endpoint: AlphaVantageEndpoint,
  endpointConfig: EndpointConfig,
  checkManualWriteEnabled: boolean
): Promise<void> {
  console.log(`aFH sAD start ${endpoint} ${symbol}`);
  log.info('standard.save.start', { symbol, endpoint, checkManualWriteEnabled });
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

    // 2. Check manual Firestore write enabled
    // Note: only requests made from frontend should go through this check.  All other callers especially scheduled jobs
    // should pass false for checkManualWriteEnabled.  This is just a mechanism to enable a ui initiated data refresh instead
    // of waiting for the next scheduled job.
    if (checkManualWriteEnabled) {
      const enabled = await isManualWriteEnabled();
      console.log(`aFH sAD toggle enabled? ${enabled}`);
      log.debug('standard.save.toggle', { enabled });
      if (!enabled) {
        console.log('aFH sAD toggle OFF; skip');
        log.info('standard.save.skip_toggle');
        return;
      }
    }

    // 3. If enabled or bypassed, proceed with Firestore write and refresh event logging
    await db.doc(docPath).set({ data }, { merge: true });

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
 * @param data - The time series data array
 * @param symbol - The symbol
 * @param endpoint - The Alpha Vantage endpoint
 * @param interval - The time series interval
 * @param checkManualWriteEnabled - REQUIRED: must always be set by caller. If true, enforces the manual Firestore write toggle. Pass false for scheduled jobs.
 */
export async function saveAvTimeSeriesData(
  data: any[],
  symbol: string,
  endpoint: AlphaVantageEndpoint,
  interval: TimeSeriesInterval,
  checkManualWriteEnabled: boolean
): Promise<void> {
  console.log(`aFH sATSD start ${endpoint} ${symbol} ${interval}`);
  log.info('timeseries.save.start', { symbol, endpoint, interval });
  // Emulator guard: for DAILY, keep roughly last 1 year of data to reduce emulator dataset size
  const emulator = process.env.FUNCTIONS_EMULATOR === 'true' || !!process.env.FIRESTORE_EMULATOR_HOST;
  if (emulator && interval === TimeSeriesInterval.DAILY && Array.isArray(data)) {
    const now = Date.now();
    const oneYearMs = 365 * 24 * 3600 * 1000;
    const cutoff = now - oneYearMs;
    const filtered = data.filter((b) => {
      const t = new Date(b.date).getTime();
      return Number.isFinite(t) && t >= cutoff;
    });
    if (filtered.length !== data.length) {
      console.log(`aFH sATSD emulator trim ${data.length} → ${filtered.length}`);
      log.debug('timeseries.save.trim', { from: data.length, to: filtered.length });
      data = filtered;
    }
  }
  // 1. Compute metadata fields
  const histDataPoints = Array.isArray(data) ? data.length : 0;
  const histStartDate = histDataPoints > 0 && data[histDataPoints - 1]?.date
    ? Timestamp.fromDate(new Date(data[histDataPoints - 1].date))
    : null;
  const histEndDate = histDataPoints > 0 && data[0]?.date
    ? Timestamp.fromDate(new Date(data[0].date))
    : null;

  // 2. Canonical doc path for time series
  const docPath = getSymbolTimeSeriesDocPath(symbol, endpoint, ApiProvider.ALPHA_VANTAGE);
  const docRef = db.doc(docPath);

  try {
    const startTime = Date.now();
    // 3. Respect manual Firestore write toggle for UI/gateway-triggered calls
    if (checkManualWriteEnabled) {
      const enabled = await isManualWriteEnabled();
      console.log(`aFH sATSD toggle? ${enabled}`);
      log.debug('timeseries.save.toggle', { enabled });
      if (!enabled) {
        console.log('aFH sATSD toggle OFF; skip');
        log.info('timeseries.save.skip_toggle');
        return;
      }
    }
    // 3. Sharded writes do not rely on existing refreshHistory; skip reading existing doc

    // 4. Prepare writes for non-intraday:
    // DAILY/WEEKLY -> year-sharded docs with compact bars array
    // MONTHLY -> single 'all' doc with compact bars array
    const vendor = ApiProvider.ALPHA_VANTAGE;
    const barsByYear = new Map<number, CompactBar[]>();
    const compactBars: CompactBar[] = [];
    for (const b of data) {
      const dt = new Date(b.date);
      const t = dt.getTime();
      if (isNaN(t)) continue;
      const intradayObservedAt = b.intradayObservedAt != null ? Number(b.intradayObservedAt) : undefined;
      const intradayTime = intradayObservedAt != null && Number.isFinite(intradayObservedAt)
        ? new Intl.DateTimeFormat('en-US', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'America/New_York' }).format(new Date(intradayObservedAt))
        : undefined;
      const bar: CompactBar = {
        t,
        // Store human-readable date string in UTC (YYYY-MM-DD) for ease of display/debugging
        d: new Date(t).toISOString().slice(0, 10),
        o: Number(b.open),
        h: Number(b.high),
        l: Number(b.low),
        c: Number(b.close),
        // Required compact fields: provide sensible defaults when provider fields are absent
        // v: volume -> default 0
        v: Number(b.volume ?? 0),
        // ac: adjusted close -> default to close when adjusted not provided
        ac: Number((b as any).adjustedClose ?? b.close ?? 0),
        // dv: dividend amount -> default 0
        dv: Number((b as any).dividendAmount ?? 0),
        // sc: split coefficient -> default 1
        sc: Number((b as any).splitCoefficient ?? 1),
        pc: b.previousClose != null ? Number(b.previousClose) : undefined,
        ch: b.change != null ? Number(b.change) : undefined,
        cp: b.changePercent != null ? Number(b.changePercent) : undefined,
        ip: b.intradayPrice != null ? Number(b.intradayPrice) : undefined,
        io: intradayObservedAt,
        it: intradayTime,
      };
      compactBars.push(bar);
      const y = getYearFromEpochMillis(t);
      const bucket = barsByYear.get(y) || [];
      bucket.push(bar);
      barsByYear.set(y, bucket);
    }

    // Sort bars ascending for deterministic writes
    compactBars.sort((a, b) => a.t - b.t);
    for (const arr of barsByYear.values()) arr.sort((a, b) => a.t - b.t);

    // Batched writes
    const BATCH_LIMIT = 400;
    let batch: WriteBatch = db.batch();
    let opsInBatch = 0;
    let totalBarWrites = 0;

    if (interval === TimeSeriesInterval.MONTHLY) {
      // Single 'all' doc
      const allDocPath = getSymbolTimeSeriesAllDocPath(symbol, endpoint, vendor);
      batch.set(db.doc(allDocPath), {
        bars: compactBars,
        count: compactBars.length,
        firstBarTs: compactBars[0]?.t ?? null,
        lastBarTs: compactBars[compactBars.length - 1]?.t ?? null,
        updatedAt: Timestamp.now(),
      }, { merge: true });
      opsInBatch++;
    } else {
      // Year-sharded DAILY / WEEKLY
      for (const [year, bars] of barsByYear.entries()) {
        const yearDocPath = getSymbolTimeSeriesYearDocPath(symbol, endpoint, vendor, year);
        batch.set(db.doc(yearDocPath), {
          bars,
          count: bars.length,
          firstBarTs: bars[0]?.t ?? null,
          lastBarTs: bars[bars.length - 1]?.t ?? null,
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
    const availableYears = Array.from(barsByYear.keys()).sort((a, b) => a - b);
    const histStartTs = compactBars[0]?.t ?? null;
    const histEndTs = compactBars[compactBars.length - 1]?.t ?? null;
    const latestBarIso = histEndTs != null ? new Date(histEndTs).toISOString() : 'null';
    console.log(`aFH sATSD latestBar=${latestBarIso} (${histEndTs ?? 'null'}) ${symbol} ${endpoint} ${interval}`);
    log.info('timeseries.save.latest_bar', { symbol, endpoint, interval, latestBarIso, latestBarMs: histEndTs });
    await docRef.set({
      metadata: {
        symbol,
        interval,
        histDataPoints,
        histStartDate,
        histEndDate,
        lastUpdated: Timestamp.now(),
        nextRefreshAt: Timestamp.fromDate(new Date(Date.now() + ttlSeconds * 1000)),
        ttlSeconds,
        vendor: ApiProvider.ALPHA_VANTAGE,
        endpoint: endpoint,
        availableYears,
        histStartTs,
        histEndTs,
      },
      latestBarTimestamp: histEndTs != null ? Timestamp.fromMillis(histEndTs) : null,
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

    // 8. Ensure symbol presence under symbol-data/{symbol} with minimal metadata for Console visibility
    const symbolDocRef = db.doc(`${FirestoreCollection.SYMBOL_DATA}/${symbol}`);
    await symbolDocRef.set({
      nextRefreshAt: Timestamp.fromDate(new Date(Date.now() + ttlSeconds * 1000)),
      nextRefreshBy: '',
      refreshedAt: Timestamp.now(),
      refreshedBy: 'time-series-write', // or 'scheduler' depending on caller
      ttlHuman: ''
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
 * Ensures the time series exists for a symbol/interval in Firestore.
 * If missing, fetches full time series from Alpha Vantage and writes it.
 * Returns true if initialized (or already exists), false if fetch failed.
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
 * Upserts a single daily bar for the given symbol and date.
 * @param options - The upsert options
 */
export async function upsertAvDailyBar(options: {
  symbol: string;
  date: string; // YYYY-MM-DD (UTC day)
  // Partial compact fields to merge onto the bar. Use numeric values only.
  patch: { o?: number; h?: number; l?: number; c?: number; v?: number; ac?: number; dv?: number; sc?: number; pc?: number; ch?: number; cp?: number; ip?: number; io?: number };
  endpoint?: AlphaVantageEndpoint; // defaults to DAILY_ADJUSTED
}): Promise<void> {
  const { symbol, date, patch, endpoint = AlphaVantageEndpoint.TIME_SERIES_DAILY_ADJUSTED } = options;
  const docPath = getSymbolTimeSeriesDocPath(symbol, endpoint, ApiProvider.ALPHA_VANTAGE);
  const dataRef = db.collection(`${docPath}/data`).doc(date);
  const data = await dataRef.get();
  const bars: CompactBar[] = data.exists ? data.get('bars') : [];

  const t = new Date(`${date}T00:00:00.000Z`).getTime();
  const idx = bars.findIndex((b) => b.t === t);
  if (idx >= 0) {
    const existing = bars[idx];
    const io = patch.io != null ? patch.io : existing.io;
    const it = io != null && Number.isFinite(io)
      ? new Intl.DateTimeFormat('en-US', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'America/New_York' }).format(new Date(io))
      : existing.it;
    const patchBar = {
      o: Number(patch.o ?? existing.o),
      h: Number(patch.h ?? existing.h),
      l: Number(patch.l ?? existing.l),
      c: Number(patch.c ?? existing.c),
      // Ensure required compact fields are set; provide defaults if patch values are missing
      v: Number(patch.v ?? existing.v ?? 0),
      ac: Number(patch.ac ?? existing.ac ?? patch.c ?? existing.c ?? 0),
      dv: Number(patch.dv ?? existing.dv ?? 0),
      sc: Number(patch.sc ?? existing.sc ?? 1),
      pc: patch.pc != null ? Number(patch.pc) : existing.pc,
      ch: patch.ch != null ? Number(patch.ch) : existing.ch,
      cp: patch.cp != null ? Number(patch.cp) : existing.cp,
      ip: patch.ip != null ? Number(patch.ip) : existing.ip,
      io,
      it,
    } as Partial<CompactBar> & { o: number; h: number; l: number; c: number; v: number; ac: number; dv: number; sc: number };

    bars[idx] = { ...existing, ...patchBar } as CompactBar;
  } else {
    // Insert new bar
    const newBar: CompactBar = {
      t,
      d: new Date(t).toISOString().slice(0, 10),
      o: Number(patch.o ?? 0),
      h: Number(patch.h ?? (patch.o ?? 0)),
      l: Number(patch.l ?? (patch.o ?? 0)),
      c: Number(patch.c ?? 0),
      v: Number(patch.v ?? 0),
      ac: Number(patch.ac ?? patch.c ?? 0),
      dv: Number(patch.dv ?? 0),
      sc: Number(patch.sc ?? 1),
      pc: patch.pc != null ? Number(patch.pc) : undefined,
      ch: patch.ch != null ? Number(patch.ch) : undefined,
      cp: patch.cp != null ? Number(patch.cp) : undefined,
      ip: patch.ip != null ? Number(patch.ip) : undefined,
      io: patch.io,
      it: patch.io != null && Number.isFinite(patch.io)
        ? new Intl.DateTimeFormat('en-US', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'America/New_York' }).format(new Date(patch.io))
        : undefined,
    };
    bars.push(newBar);
  }

  await dataRef.set({ bars }, { merge: true });
}

/**
 * Upserts a single weekly bar for the given symbol and date (YYYY-MM-DD),
 * writing into the year-sharded WEEKLY doc.
 */
export async function upsertAvWeeklyBar(options: {
  symbol: string;
  date: string; // YYYY-MM-DD (UTC day)
  patch: { o?: number; h?: number; l?: number; c?: number; v?: number; ac?: number; dv?: number; sc?: number };
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
      ac: Number(patch.ac ?? existing.ac ?? patch.c ?? existing.c ?? 0),
      dv: Number(patch.dv ?? existing.dv ?? 0),
      sc: Number(patch.sc ?? existing.sc ?? 1),
    } as Partial<CompactBar> & { o: number; h: number; l: number; c: number; v: number; ac: number; dv: number; sc: number };
    bars[idx] = { ...existing, ...patchBar } as CompactBar;
  } else {
    const newBar: CompactBar = {
      t,
      d: new Date(t).toISOString().slice(0, 10),
      o: Number(patch.o ?? 0),
      h: Number(patch.h ?? (patch.o ?? 0)),
      l: Number(patch.l ?? (patch.o ?? 0)),
      c: Number(patch.c ?? 0),
      v: Number(patch.v ?? 0),
      ac: Number(patch.ac ?? patch.c ?? 0),
      dv: Number(patch.dv ?? 0),
      sc: Number(patch.sc ?? 1),
    };
    bars.push(newBar);
  }

  // Sort ascending for deterministic writes
  bars.sort((a, b) => a.t - b.t);
  await yearRef.set({
    bars,
    count: bars.length,
    firstBarTs: bars[0]?.t ?? null,
    lastBarTs: bars[bars.length - 1]?.t ?? null,
    updatedAt: Timestamp.now(),
  }, { merge: true });
}

/**
 * Upserts a single monthly bar for the given symbol and date (YYYY-MM-DD),
 * writing into the single 'all' MONTHLY doc.
 */
export async function upsertAvMonthlyBar(options: {
  symbol: string;
  date: string; // YYYY-MM-DD (UTC day)
  patch: { o?: number; h?: number; l?: number; c?: number; v?: number; ac?: number; dv?: number; sc?: number };
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
    } as Partial<CompactBar> & { o: number; h: number; l: number; c: number; v: number; ac: number; dv: number; sc: number };
    bars[idx] = { ...existing, ...patchBar } as CompactBar;
  } else {
    const newBar: CompactBar = {
      t,
      d: new Date(t).toISOString().slice(0, 10),
      o: Number(patch.o ?? 0),
      h: Number(patch.h ?? (patch.o ?? 0)),
      l: Number(patch.l ?? (patch.o ?? 0)),
      c: Number(patch.c ?? 0),
      v: Number(patch.v ?? 0),
      ac: Number(patch.ac ?? patch.c ?? 0),
      dv: Number(patch.dv ?? 0),
      sc: Number(patch.sc ?? 1),
    };
    bars.push(newBar);
  }

  // Sort ascending for deterministic writes
  bars.sort((a, b) => a.t - b.t);
  await allRef.set({
    bars,
    count: bars.length,
    firstBarTs: bars[0]?.t ?? null,
    lastBarTs: bars[bars.length - 1]?.t ?? null,
    updatedAt: Timestamp.now(),
  }, { merge: true });
}
