import { db } from '../../../firebase-admin-init';
import { Timestamp, WriteBatch } from 'firebase-admin/firestore';

import { AlphaVantageEndpoint, AV_TIME_SERIES_ENDPOINT_CONFIGS, OutputSize, TimeSeriesInterval } from '@shared/alpha-vantage';
import { ApiProvider, ApiResponse } from '@shared/core';
import { FirestoreCollection } from '@shared/firestore';
import type { EndpointConfig } from '@shared/core';
import type { CompactBar } from '@shared/alpha-vantage';
import { DayOfWeek } from '@shared/alpha-vantage';
import { RefreshStatus, RefreshTrigger } from '@shared/firestore';

import { RefreshLoggerService } from '../../services/refresh-logger.service';

import { isManualWriteEnabled } from '../../common/firestore/manual-write-toggle';
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
 *
 * Write model (Alpha Vantage, provider = AV):
 * - Top-level provider/interval doc (metadata only):
 *   path = getSymbolTimeSeriesDocPath(symbol, endpoint, AV)
 *   fields: metadata{ symbol, interval, histStart/EndDate + histStart/EndTs, lastUpdated, nextRefreshAt, ttlSeconds, vendor, endpoint }, latestBarTimestamp
 *
 * - DAILY/WEEKLY (year-sharded):
 *   path = getSymbolTimeSeriesYearDocPath(symbol, endpoint, AV, {YYYY})
 *   doc = { bars: CompactBar[], count, firstBarTs, lastBarTs, updatedAt, latest }
 *
 * - MONTHLY (single ‘all’ doc):
 *   path = getSymbolTimeSeriesAllDocPath(symbol, endpoint, AV)
 *   doc = { bars: CompactBar[], count, firstBarTs, lastBarTs, updatedAt }
 *
 * Caller guidance:
 * - Use this function for full/backfill writes (large arrays). For compact updates (latest bar only), use
 *   upsert helpers: upsertAvDailyBar / upsertAvWeeklyBar / upsertAvMonthlyBar to minimize write sizes.
 * - Pass `checkManualWriteEnabled=false` from schedulers; UI/gateway-triggered calls may pass true to honor the toggle.
 *
 * @param data Array of StorageBar-like entries already transformed by handler; will be mapped to CompactBar
 * @param symbol Stock symbol
 * @param endpoint AV endpoint id (e.g., TIME_SERIES_DAILY_ADJUSTED)
 * @param interval Shared TimeSeriesInterval (DAILY/WEEKLY/MONTHLY)
 * @param checkManualWriteEnabled Honor the manual write toggle (true for UI flows, false for schedulers)
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
  // Emulator guard: trim DAILY/WEEKLY/MONTHLY to roughly last 1 year to keep emulator datasets small
  const emulator = process.env.FUNCTIONS_EMULATOR === 'true' || !!process.env.FIRESTORE_EMULATOR_HOST;
  if (emulator && Array.isArray(data) && (
    interval === TimeSeriesInterval.DAILY ||
    interval === TimeSeriesInterval.WEEKLY ||
    interval === TimeSeriesInterval.MONTHLY
  )) {
    const now = Date.now();
    const oneYearMs = 365 * 24 * 3600 * 1000;
    const cutoff = now - oneYearMs;
    const filtered = data.filter((b) => {
      const t = new Date(b.date).getTime();
      return Number.isFinite(t) && t >= cutoff;
    });
    if (filtered.length !== data.length) {
      const intervalLabel = String(interval);
      console.log(`aFH sATSD emulator trim [${intervalLabel}] ${data.length} → ${filtered.length}`);
      log.debug('timeseries.save.trim', { interval: intervalLabel, from: data.length, to: filtered.length });
      data = filtered;
    }
  }
  // 1. Compute metadata fields
  let histStartDate: Timestamp | null = null;
  let histEndDate: Timestamp | null = null;

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
        ic: (b as any).intradayChange != null ? Number((b as any).intradayChange) : null,
        ipc: (b as any).intradayPercentChange != null ? Number((b as any).intradayPercentChange) : null,
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
      const latestBar = compactBars[compactBars.length - 1] ?? null;
      const latestUtcIso = latestBar?.t != null ? new Date(latestBar.t).toISOString() : null;
      const latestEtDateTime = latestBar?.t != null ? formatEtDateTime(latestBar.t) : null;
      batch.set(db.doc(allDocPath), {
        bars: compactBars,
        count: compactBars.length,
        firstBarTs: compactBars[0]?.t ?? null,
        lastBarTs: compactBars[compactBars.length - 1]?.t ?? null,
        latest: latestBar,
        latestUtcIso,
        latestEtDateTime,
        updatedAt: Timestamp.now(),
      }, { merge: true });
      opsInBatch++;
    } else {
      // Year-sharded DAILY / WEEKLY
      for (const [year, bars] of barsByYear.entries()) {
        const yearDocPath = getSymbolTimeSeriesYearDocPath(symbol, endpoint, vendor, year);
        const latestBar = bars[bars.length - 1] ?? null;
        const latestUtcIso = latestBar?.t != null ? new Date(latestBar.t).toISOString() : null;
        const latestEtDateTime = latestBar?.t != null ? formatEtDateTime(latestBar.t) : null;
        const latestIoUtcIso = latestBar?.io != null ? new Date(Number(latestBar.io)).toISOString() : null;
        const latestIoEtDateTime = latestBar?.io != null ? formatEtDateTime(Number(latestBar.io)) : null;
        batch.set(db.doc(yearDocPath), {
          bars,
          count: bars.length,
          firstBarTs: bars[0]?.t ?? null,
          lastBarTs: bars[bars.length - 1]?.t ?? null,
          latest: latestBar,
          latestUtcIso,
          latestEtDateTime,
          latestIoUtcIso,
          latestIoEtDateTime,
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
    await docRef.set({
      metadata: {
        symbol,
        interval,
        histStartDate,
        histEndDate,
        lastUpdated: Timestamp.now(),
        nextRefreshAt: Timestamp.fromDate(new Date(Date.now() + ttlSeconds * 1000)),
        ttlSeconds,
        vendor: ApiProvider.ALPHA_VANTAGE,
        endpoint: endpoint,
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
 * If missing, it fetches a full series via the appropriate handler and relies on that handler
 * to perform normalized writes (year-sharded or monthly ‘all’ doc) and refresh logging.
 *
 * Use cases:
 * - Initialization when a symbol is newly tracked
 * - Emergency re-seeding when a series doc was deleted
 *
 * Notes:
 * - Prefers adjusted DAILY on initializer for consistent persisted shape
 * - Does not call saveAvTimeSeriesData directly; handler owns persistence
 *
 * @param symbol Stock symbol
 * @param interval TimeSeriesInterval
 * @param endpoint AV endpoint (DAILY_ADJUSTED | WEEKLY_ADJUSTED | MONTHLY_ADJUSTED)
 * @returns true if the series existed or was written successfully; false if provider returned no data
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
 *
 * Behavior:
 * - Reads the year doc bars[], merges or inserts the target bar based on epoch day (t)
 * - Recomputes count/firstBarTs/lastBarTs, sets updatedAt
 * - Calls bumpTimeSeriesTopLevelMetadata to refresh parent doc freshness
 *
 * @param options.symbol Stock symbol
 * @param options.date ISO date (UTC day)
 * @param options.patch Partial CompactBar fields to merge (numeric only)
 * @param options.endpoint Defaults to TIME_SERIES_DAILY_ADJUSTED
 */
export async function upsertAvDailyBar(options: {
  symbol: string;
  date: string; // YYYY-MM-DD (UTC day)
  // Partial compact fields to merge onto the bar. Use numeric values only.
  patch: Partial<CompactBar>;
  endpoint?: AlphaVantageEndpoint; // defaults to DAILY_ADJUSTED
  // When true, do not bump the top-level time-series metadata. Used for pre-close intraday snapshots
  skipParentMetaBump?: boolean;
}): Promise<void> {
  const { symbol, date, patch, endpoint = AlphaVantageEndpoint.TIME_SERIES_DAILY_ADJUSTED, skipParentMetaBump } = options;
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
      ac: Number(patch.ac ?? existing.ac ?? patch.c ?? existing.c ?? 0),
      dv: Number(patch.dv ?? existing.dv ?? 0),
      sc: Number(patch.sc ?? existing.sc ?? 1),
      ip: patch.ip != null ? Number(patch.ip) : existing.ip,
      io,
      it,
      ic: patch.ic != null ? Number(patch.ic) : ((existing as any).ic ?? null),
      ipc: patch.ipc != null ? Number(patch.ipc) : ((existing as any).ipc ?? null),
      dow: computeDowFromDateString(new Date(t).toISOString().slice(0, 10)),
    } as Partial<CompactBar> & { o: number; h: number; l: number; c: number; v: number; ac: number; dv: number; sc: number };
    bars[idx] = { ...existing, ...patchBar } as CompactBar;
  } else {
    // Insert new bar
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
    bars.push(newBar);
  }

  // Sort ascending for deterministic writes and update year doc aggregate fields
  const latestBar = bars[bars.length - 1] ?? null;
  const latestUtcIso = latestBar?.t != null ? new Date(latestBar.t).toISOString() : null;
  const latestEtDateTime = latestBar?.t != null ? formatEtDateTime(latestBar.t) : null;
  const latestIoUtcIso = latestBar?.io != null ? new Date(Number(latestBar.io)).toISOString() : null;
  const latestIoEtDateTime = latestBar?.io != null ? formatEtDateTime(Number(latestBar.io)) : null;
  bars.sort((a, b) => a.t - b.t);
  await yearRef.set({
    bars,
    count: bars.length,
    firstBarTs: bars[0]?.t ?? null,
    lastBarTs: bars[bars.length - 1]?.t ?? null,
    latest: latestBar,
    latestUtcIso,
    latestEtDateTime,
    latestIoUtcIso,
    latestIoEtDateTime,
    updatedAt: Timestamp.now(),
  }, { merge: true });

  if (!skipParentMetaBump) {
    await bumpTimeSeriesTopLevelMetadata({
      symbol,
      endpoint,
      interval: TimeSeriesInterval.DAILY,
      latestDate: date,
    });
  }
}

/**
 * Upserts a single weekly bar (YYYY-MM-DD) into the WEEKLY year-sharded doc.
 * See upsertAvDailyBar for flow details; this variant targets WEEKLY and does not include intraday fields.
 *
 * @param options.symbol Stock symbol
 * @param options.date ISO date (UTC week anchor)
 * @param options.patch Partial CompactBar fields to merge (numeric only)
 * @param options.endpoint Defaults to TIME_SERIES_WEEKLY_ADJUSTED
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
 * Upserts a single monthly bar (YYYY-MM-DD) into the MONTHLY single ‘all’ doc.
 *
 * Behavior:
 * - Reads the ‘all’ doc bars[], merges or inserts the target bar
 * - Recomputes aggregates and sets updatedAt
 * - Calls bumpTimeSeriesTopLevelMetadata to refresh parent doc freshness
 *
 * @param options.symbol Stock symbol
 * @param options.date ISO date (UTC month anchor)
 * @param options.patch Partial CompactBar fields to merge (numeric only)
 * @param options.endpoint Defaults to TIME_SERIES_MONTHLY_ADJUSTED
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
 * Upserts a single daily bar (YYYY-MM-DD) with intraday-only fields (ip/io/it) and optional dow.
 * This helper is used by PRE-close intraday flow to create the day’s bar strictly when intraday data exists for today ET.
 * Keep schema stable by providing safe numeric defaults for required numeric fields when creating a new bar; do not bump parent metadata.
 *
 * @param options.symbol Stock symbol
 * @param options.date ISO date (UTC day)
 * @param options.ip Latest intraday price
 * @param options.io Epoch ms of the latest intraday bar timestamp
 * @param options.dow Optional day-of-week (0=Sun..6=Sat) in ET
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
  const snap = await yearRef.get();
  const bars: any[] = snap.exists ? (snap.get('bars') ?? []) : [];

  const idx = bars.findIndex((b) => b.t === t);
  const it = new Intl.DateTimeFormat('en-US', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'America/New_York' }).format(new Date(io));

  // Derive intraday deltas against previous trading day's adjusted close
  const prevAc = await getPreviousAdjustedClose({ symbol, date });
  const ic = prevAc != null && Number.isFinite(prevAc) ? Number(ip) - Number(prevAc) : null;
  const ipc = prevAc != null && Number.isFinite(prevAc) && Number(prevAc) !== 0
    ? (Number(ic) / Number(prevAc)) * 100
    : null;

  if (idx >= 0) {
    const existing = bars[idx] || {};
    const merged = {
      ...existing,
      // preserve existing OHLC/adj fields if present; only update intraday snapshot and dow
      ip: Number(ip),
      io: Number(io),
      it,
      dow,
      ic, // intraday change from previous adjusted close
      ipc, // intraday percent change
    };
    bars[idx] = merged;
  } else {
    // Create a minimal intraday-provisional bar: only date, dow, and intraday fields.
    const newBar = {
      t,
      d: new Date(t).toISOString().slice(0, 10),
      dow,
      // intraday snapshot
      ip: Number(ip),
      io: Number(io),
      it,
      ic,  // intraday change from previous adjusted close
      ipc, // intraday percent change
    };
    bars.push(newBar);
  }

  // Sort ascending for deterministic writes
  const latestBarI = bars[bars.length - 1] ?? null;
  const latestUtcIsoI = latestBarI?.t != null ? new Date(latestBarI.t).toISOString() : null;
  const latestEtDateTimeI = latestBarI?.t != null ? formatEtDateTime(latestBarI.t) : null;
  const latestIoUtcIsoI = latestBarI?.io != null ? new Date(Number(latestBarI.io)).toISOString() : null;
  const latestIoEtDateTimeI = latestBarI?.io != null ? formatEtDateTime(Number(latestBarI.io)) : null;
  bars.sort((a, b) => a.t - b.t);
  await yearRef.set({
    bars,
    count: bars.length,
    firstBarTs: bars[0]?.t ?? null,
    lastBarTs: bars[bars.length - 1]?.t ?? null,
    latest: latestBarI,
    latestUtcIso: latestUtcIsoI,
    latestEtDateTime: latestEtDateTimeI,
    latestIoUtcIso: latestIoUtcIsoI,
    latestIoEtDateTime: latestIoEtDateTimeI,
    updatedAt: Timestamp.now(),
  }, { merge: true });
}

/**
 * Bumps the top-level time-series metadata after a compact upsert so the parent
 * doc reflects current freshness in Console.
 *
 * When to use:
 * - After upsertAvDailyBar/Weekly/Monthly so operators see updated lastUpdated/nextRefreshAt
 *
 * Fields set on parent doc:
 * - metadata: { symbol, interval, lastUpdated, nextRefreshAt (now+ttl), ttlSeconds, vendor, endpoint, histEndDate/histEndTs }
 * - latestBarTimestamp: Timestamp of latest bar
 *
 * @param options.symbol Stock symbol
 * @param options.endpoint AV endpoint id
 * @param options.interval TimeSeriesInterval
 * @param options.latestDate ISO date (YYYY-MM-DD, UTC) to derive latestTs
 * @param options.vendor Defaults to ApiProvider.ALPHA_VANTAGE
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
    const docPath = getSymbolTimeSeriesDocPath(symbol, endpoint, vendor);
    const docRef = db.doc(docPath);
    const latestTs = new Date(`${latestDate}T00:00:00.000Z`).getTime();
    const now = Timestamp.now();
    await docRef.set({
      metadata: {
        symbol,
        interval,
        lastUpdated: now,
        nextRefreshAt: Timestamp.fromDate(new Date(Date.now() + ttlSeconds * 1000)),
        ttlSeconds,
        vendor,
        endpoint,
        histEndDate: Number.isFinite(latestTs) ? Timestamp.fromMillis(latestTs) : null,
        histEndTs: Number.isFinite(latestTs) ? latestTs : null,
      },
      latestBarTimestamp: Number.isFinite(latestTs) ? Timestamp.fromMillis(latestTs) : null,
    }, { merge: true });
  } catch (e: any) {
    console.error('bumpTSMeta error', String(e?.message || e));
  }
}

/**
 * Fetch the previous trading day's adjusted close for a given symbol and endpoint.
 * Strategy: compute prevDate = date - 1 day (UTC), derive its epoch midnight, look up
 * the exact bar in the year doc for that year; if not present, also check the prior year doc.
 * Returns `ac` if present, else `c`, else null.
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
 * Computes DayOfWeek from a trading date string (YYYY-MM-DD).
 * Uses the UTC date (midnight Z) to reflect the bar's trading day (Mon-Fri).
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
 * Formats an ET date-time string with seconds (YYYY-MM-DD HH:mm:ss) for a given epoch millis.
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
