// =======================================
// DATA MANAGER: Alpha Vantage-Only Refresher
// VERSION: 1.2.0 (auto phase, internal announce, real symbolsUpdatedCount)
// =======================================

import { db } from '../../../firebase-admin-init';
import { Timestamp } from 'firebase-admin/firestore';
import { onSchedule } from 'firebase-functions/v2/scheduler';

import { AlphaVantageHandlerFactory } from '../../alpha-vantage/alpha-vantage-factory';

import { AV_ENDPOINT_CONFIGS, AV_IMPLEMENTED_ENDPOINTS, AV_TIME_SERIES_ENDPOINT_CONFIGS, TimeSeriesInterval, AlphaVantageEndpoint, DayOfWeek } from '@shared/alpha-vantage';
import { ApiProvider } from '@shared/core';
import { FirestoreCollection, RefreshStatus, RefreshTrigger } from '@shared/firestore';

import { AV_REFRESH_MANAGER_SCHEDULE, TS_DAILY_PRE_CLOSE_SCHEDULE, TS_DAILY_POST_CLOSE_SCHEDULE, TS_POST_CLOSE_SCHEDULE, TS_DAILY_INTRADAY_HOURLY_SCHEDULE, TS_DAILY_POST_EVENING_RETRY_MINUTE_30, TS_DAILY_POST_EVENING_RETRY_MINUTE_00, TS_DAILY_POST_MORNING_CATCHUP_0630, TS_DAILY_POST_MORNING_CATCHUP_0700 } from '../../common/function-schedules';

import { createLogger, hr, hrBlank, getMarketClosureInfo, RefreshLogComponent } from '../../utils/utils';
import { resolveFirestorePath, getRefreshEventDocId } from '../../utils/firestore-utils';
import { getSymbolTimeSeriesDocPath } from '../../common/firestore/firestore-paths';
import { refreshLogger } from '../../services/refresh-logger.service';
import { enqueueDataReadyInternal } from '../../partner/data-ready.handler';
import type { DataReadyPayloadV1 } from '../../partner/schemas/data-ready.schema';
import { INTERNAL_PUBLISHER_AUDIT_EMAIL, PartnerPhase, PartnerRunType } from '../../partner/constants';
import { HealthMetricsService } from '../../health-metrics/health-metrics.service';
import { TradingPhase } from '@shared/health-metrics';

// Structured logger (shared)
const log = createLogger('av.refresh');
const healthMetricsService = new HealthMetricsService();

// Stats collected per endpoint for clearer summaries
interface EndpointStats {
  endpointId: string;
  endpointName: string;
  checked: number;
  refreshed: number;
  skippedFresh: number;
  skippedNoPath: number;
  skippedEmpty: number;
  failures: number;
}

// Compute next refresh start time as RFC3339 UTC string for header UI
function computeNextRefreshAtUtc(phase: TradingPhase): string | undefined {
  try {
    const tz = 'America/New_York';
    const now = new Date();

    // Helper to create a Date interpreted in ET, then return to UTC ISO string
    function etToUtcIso(y: number, m: number, d: number, hh: number, mm: number): string {
      // Build an ET-localized time by formatting and reparsing is unreliable; instead use Intl to get parts
      const etNow = new Date(now.toLocaleString('en-US', { timeZone: tz }));
      etNow.setFullYear(y);
      etNow.setMonth(m - 1);
      etNow.setDate(d);
      etNow.setHours(hh, mm, 0, 0);
      return new Date(etNow.getTime()).toISOString();
    }

    const etNow = new Date(now.toLocaleString('en-US', { timeZone: tz }));
    const y = etNow.getFullYear();
    const m = etNow.getMonth() + 1;
    const d = etNow.getDate();
    const h = etNow.getHours();
    const min = etNow.getMinutes();

    // Next weekday date in ET (naive: skips Sat/Sun)
    function nextWeekdayEt(): { y: number; m: number; d: number } {
      const t = new Date(etNow);
      t.setDate(t.getDate() + 1);
      const dow = t.getDay();
      if (dow === 6) t.setDate(t.getDate() + 2);
      if (dow === 0) t.setDate(t.getDate() + 1);
      return { y: t.getFullYear(), m: t.getMonth() + 1, d: t.getDate() };
    }

    // Schedule-driven calculation aligned with cron windows
    // PRE: hourly 10:00–15:00 ET (TS_DAILY_INTRADAY_HOURLY_SCHEDULE) + pre-close 15:30 (TS_DAILY_PRE_CLOSE_SCHEDULE)
    // POST: next weekday 10:00 ET (handoff to next intraday window)
    if (phase === TradingPhase.PRE) {
      const preEtEvents: Array<{ hh: number; mm: number }> = [
        { hh: 10, mm: 0 },
        { hh: 11, mm: 0 },
        { hh: 12, mm: 0 },
        { hh: 13, mm: 0 },
        { hh: 14, mm: 0 },
        { hh: 15, mm: 0 },
        { hh: 15, mm: 30 }, // pre-close snapshot
      ];

      // Find first event at or after current ET time
      for (const ev of preEtEvents) {
        if (h < ev.hh || (h === ev.hh && min <= ev.mm)) {
          return etToUtcIso(y, m, d, ev.hh, ev.mm);
        }
      }
      // If all PRE events have passed, next is post-close completion (16:35 ET)
      return etToUtcIso(y, m, d, 16, 35);
    }

    // POST: choose from same-day evening retries, else next weekday morning catch-ups, else next weekday 10:00
    const postEtEventsToday: Array<{ hh: number; mm: number }> = [
      { hh: 16, mm: 35 },
      { hh: 19, mm: 0 },
      { hh: 20, mm: 0 },
      { hh: 21, mm: 0 },
    ];
    for (const ev of postEtEventsToday) {
      if (h < ev.hh || (h === ev.hh && min <= ev.mm)) {
        return etToUtcIso(y, m, d, ev.hh, ev.mm);
      }
    }
    // Otherwise, pick from next weekday morning catch-ups, then 10:00
    const n = nextWeekdayEt();
    const postMorning: Array<{ hh: number; mm: number }> = [
      { hh: 7, mm: 0 },
      { hh: 10, mm: 0 },
    ];
    return etToUtcIso(n.y, n.m, n.d, postMorning[0].hh, postMorning[0].mm) || etToUtcIso(n.y, n.m, n.d, 10, 0);
  } catch {
    return undefined;
  }
}

// Determine trading phase automatically using Eastern Time.
function getAutoPhaseAndMarketDate(): { phase: PartnerPhase; marketDate: string } {
  // Use Intl with America/New_York to avoid extra deps.
  const tz = 'America/New_York';
  const now = new Date();
  const fmtDate = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' });
  const parts = fmtDate.format(now); // YYYY-MM-DD (en-CA)
  const marketDate = parts; // already YYYY-MM-DD
  const hour = Number(new Intl.DateTimeFormat('en-US', { timeZone: tz, hour: '2-digit', hour12: false }).format(now));
  // Consider POST after 16:00 ET, else PRE
  const phase: PartnerPhase = hour >= 16 ? PartnerPhase.POST : PartnerPhase.PRE;
  return { phase, marketDate };
}

// Helper: is this endpoint one of our AV time-series endpoints?
function isTimeSeriesEndpoint(endpoint: AlphaVantageEndpoint): boolean {
  return !!(AV_TIME_SERIES_ENDPOINT_CONFIGS as any)[endpoint];
}

// Helper: history path from a concrete doc path
function getHistoryPathFor(docPath: string): string {
  return `${docPath}/${FirestoreCollection.REFRESH_HISTORY}`;
}

/**
 * Run the Alpha Vantage refresh cycle once and return minimal stats.
 * Supports non-time series endpoint only.  Time series endpoints are
 * refreshed separately.
 * Exported so HTTP wrapper can invoke the same logic as the scheduler.
 */
export async function runRefreshAlphaVantageDataV2(options: { force?: boolean } = {}): Promise<{ durationMs: number; symbolsUpdatedCount: number; symbolsChecked: number; freshCount: number; staleCount: number; force: boolean }> {
  // Market-closure guard (ET): weekend/holiday
  const mc1 = getMarketClosureInfo();
  if (mc1.closed) {
    // Log exactly once so operators can confirm the skip
    log.info('market.closed_skip', { reason: mc1.reason, etDate: mc1.etDate, component: RefreshLogComponent.RunManager });
    return { durationMs: 0, symbolsUpdatedCount: 0, symbolsChecked: 0, freshCount: 0, staleCount: 0, force: !!options.force };
  }
  hr('av.refresh', '=========== AV Refresh Cycle START ===========' );
  log.info('refresh.start');
  const batchStart = Date.now();
  // Track unique symbols actually updated during this cycle
  const updatedSymbols = new Set<string>();
  let freshCount = 0;
  let staleCount = 0;

  // Per-endpoint stats map
  const endpointStatsMap = new Map<string, EndpointStats>();

  // 1. Get all tracked symbols
  const symbolsSnap = await db.collection(FirestoreCollection.TRACKED_SYMBOLS).get();
  const symbols = symbolsSnap.docs.map(doc => doc.id);
  // Build a quick lookup of symbol -> type (e.g., Equity, ETF, Crypto) if present
  const symbolTypes = new Map<string, string>();
  for (const d of symbolsSnap.docs) {
    const t = (d.data() as any)?.type as string | undefined;
    if (t) symbolTypes.set(d.id, t);
  }
  log.info('symbols.loaded', { symbolsCount: symbols.length, symbols });
  const symbolsChecked = symbols.length;
  const force = !!options.force;
  if (force) {
    log.info('refresh.options', { force });
  }

  // 2. For each implemented AV endpoint
  for (const endpoint of Array.from(AV_IMPLEMENTED_ENDPOINTS)) {
    // Per updated plan: GLOBAL_QUOTE is handled by dedicated schedules (pre/post close, boundaries)
    // Avoid per-symbol warnings about missing Firestore path and skip entirely here.
    if (endpoint === AlphaVantageEndpoint.GLOBAL_QUOTE) {
      log.info('endpoint.skip', { endpointId: endpoint, reason: 'handled_by_scheduled_updaters' });
      hr('av.refresh', `skip endpoint [${endpoint}] handled by scheduled updaters`);
      hr('av.refresh', `=========== END ENDPOINT [${endpoint}] ===========`);
      hrBlank(3);
      continue;
    }

    // IMPORTANT: Skip all time-series endpoints here. They are handled exclusively by
    // the dedicated pre/post-close schedulers to avoid off-hours writes.
    if (isTimeSeriesEndpoint(endpoint)) {
      log.info('endpoint.skip', { endpointId: endpoint, reason: 'handled_by_pre_post_close_schedulers' });
      hr('av.refresh', `skip endpoint [${endpoint}] handled by pre/post-close schedulers`);
      hr('av.refresh', `=========== END ENDPOINT [${endpoint}] ===========`);
      hrBlank(3);
      continue;
    }

    // TEMP: Skip historical options until sharded/GCS storage migration is implemented
    // # Reason: Options chains regularly exceed Firestore's 1MB document limit
    // TODO(pubsub-followup): Re-enable HISTORICAL_OPTIONS after migrating to sharded Firestore writes or GCS storage
    if (endpoint === AlphaVantageEndpoint.HISTORICAL_OPTIONS) {
      log.info('endpoint.skip', { endpointId: endpoint, reason: 'historical_options_migration' });
      continue;
    }
    console.log('')
    console.log('')
    console.log('')
    hr('av.refresh', `=========== START ENDPOINT [${endpoint}] ===========`);
    log.info('endpoint.start', { endpointId: endpoint });

    const endpointConfig = (AV_ENDPOINT_CONFIGS as any)[endpoint] || (AV_TIME_SERIES_ENDPOINT_CONFIGS as any)[endpoint];
    if (!endpointConfig) {
      log.warn('endpoint.missing_config', { endpointId: endpoint });
      continue;
    }
    const endpointName = endpointConfig.name;
    const ttl = endpointConfig.ttl;
    log.info('endpoint.meta', { endpointId: endpoint, endpointName, ttlSeconds: ttl });

    // Initialize stats for this endpoint
    const eStats: EndpointStats = {
      endpointId: endpoint,
      endpointName,
      checked: 0,
      refreshed: 0,
      skippedFresh: 0,
      skippedNoPath: 0,
      skippedEmpty: 0,
      failures: 0,
    };
    endpointStatsMap.set(endpoint, eStats);

    const endpointAttemptStart = Date.now();

    // 3. For each symbol
    for (const symbol of symbols) {
      // Guard: Skip Company Overview for non-company symbols (e.g., ETFs, Crypto, Indexes)
      if (endpoint === AlphaVantageEndpoint.OVERVIEW) {
        const rawType = symbolTypes.get(symbol) || '';
        const type = rawType.toLowerCase();
        const isEquity = type.includes('equity') || type.includes('stock') || type.includes('common');
        if (type && !isEquity) {
          hr('av.refresh', `skip: non-company symbol for OVERVIEW (${symbol} type=${rawType})`);
          log.info('symbol.skip', { endpointId: endpoint, symbol, reason: 'non_company_symbol', type: rawType });
          continue;
        }
      }
      console.log('')
      console.log('')
      console.log('')
      hr('av.refresh', `--- SYMBOL START: ${symbol} ---`);
      log.info('symbol.start', { endpointId: endpoint, endpointName, symbol });
      // Compute target Firestore docPath (non-time-series only). Time-series handlers manage their own writes.
      let docPath: string | null = null;
      if (isTimeSeriesEndpoint(endpoint)) {
        // For time-series, we still derive the canonical doc path to read freshness metadata below.
        docPath = getSymbolTimeSeriesDocPath(symbol, endpoint, ApiProvider.ALPHA_VANTAGE);
      } else {
        if (!endpointConfig.firestorePath) {
          log.warn('symbol.skip', { endpointId: endpoint, symbol, reason: 'missing_firestore_path' });
          eStats.skippedNoPath++;
          continue;
        }
        docPath = resolveFirestorePath({
          firestorePath: endpointConfig.firestorePath,
          symbolUsage: endpointConfig.symbolUsage,
          endpointName: endpoint
        }, symbol);
      }
      hr('av.refresh', `docPath: ${docPath}`);
      const docRef = db.doc(docPath);
      const docSnap = await docRef.get();
      const now = Timestamp.now();
      let needsRefresh = false;
      eStats.checked++;

      // Check if we need to refresh this symbol
      if (isTimeSeriesEndpoint(endpoint)) {
        needsRefresh = true;
        log.info('refresh.decision', { 
          endpointId: endpoint, 
          endpointName, 
          symbol, 
          refresh: 'yes', 
          reason: 'time_series_endpoint_always_refresh' 
        });
      } else if (!docSnap.exists) {
        log.info('refresh.decision', { 
          endpointId: endpoint, 
          endpointName, 
          symbol, 
          refresh: 'yes', 
          reason: 'document_does_not_exist' 
        });
        needsRefresh = true;
        staleCount++;
      } else {
        // For non-time-series endpoints, log the current state but don't refresh by default
        const metadata = docSnap.data()?.metadata;
        const lastUpdated = metadata?.lastUpdated;
        const lastUpdatedDate = lastUpdated?.toDate ? lastUpdated.toDate() : null;
        
        log.info('refresh.decision', { 
          endpointId: endpoint, 
          endpointName, 
          symbol, 
          refresh: 'no', 
          reason: 'ttl_refresh_disabled',
          lastUpdated: lastUpdatedDate?.toISOString()
        });
        
        needsRefresh = false;
        freshCount++;
        
        // Only refresh if explicitly forced
        if (force) {
          log.info('refresh.forced', { endpointId: endpoint, endpointName, symbol });
          needsRefresh = true;
        }
      }

      if (!needsRefresh) {
        log.debug('symbol.fresh', { endpointId: endpoint, endpointName, symbol });
        hr('av.refresh', `--- SYMBOL END: ${symbol} ---`);
        hrBlank(3);
        log.info('symbol.end', { endpointId: endpoint, endpointName, symbol });
        continue;
      }

      // 4. Call Alpha Vantage API via handler factory
      const apiStart = Date.now();
      try {
        const handler = AlphaVantageHandlerFactory.createHandler(endpoint);
        const fetchParams = isTimeSeriesEndpoint(endpoint)
          ? { symbol, outputsize: 'compact', __checkWriteToggle: false }
          : { symbol };
        const apiResponse = await handler.fetch(fetchParams);
        const durationMs = Date.now() - apiStart;
        log.info('refresh.fetch', { endpointId: endpoint, endpointName, symbol, durationMs });

        // Skip saving if the provider returned an empty payload ({} or [])
        const data = (apiResponse as any)?.data;
        const isEmptyArray = Array.isArray(data) && data.length === 0;
        const isEmptyObject = !Array.isArray(data) && typeof data === 'object' && data !== null && Object.keys(data).length === 0;
        if (isEmptyArray || isEmptyObject) {
          // Log a 'skipped' event to history if possible
          const historyPath = getHistoryPathFor(docPath);
          const nowDate = new Date();
          const refreshEventId = getRefreshEventDocId(ApiProvider.ALPHA_VANTAGE, endpoint, nowDate, symbol);
          await db.collection(historyPath).doc(refreshEventId).set({
            timestamp: now,
            status: 'skipped',
            durationMs,
            error: null,
            endpoint: endpointName,
            symbol,
            vendor: ApiProvider.ALPHA_VANTAGE,
            reason: 'empty_provider_response'
          });
          log.info('history.skipped', { endpointId: endpoint, endpointName, symbol, refreshEventId });
          eStats.skippedEmpty++;
          hr('av.refresh', `skip: provider returned empty payload (${endpointName} ${symbol})`);
          hr('av.refresh', `--- SYMBOL END: ${symbol} ---`);
          hrBlank(3);
          log.info('symbol.end', { endpointId: endpoint, endpointName, symbol });
          continue;
        }

        // 5. Persist results
        if (isTimeSeriesEndpoint(endpoint)) {
          // Time-series handlers already performed sharded writes and logged refresh events.
          // Do NOT write {data, metadata} to the top-level time-series doc to avoid deprecated schema.
          eStats.refreshed++;
          updatedSymbols.add(symbol);
          log.info('refresh.persist.skip_manager_write', { endpointId: endpoint, endpointName, symbol, reason: 'handled_by_handler_sharded_writes' });
          // Log success event to unified request logs and per-symbol status
          await healthMetricsService.recordSymbolRefresh(endpoint as any, symbol, RefreshStatus.SUCCESS, durationMs, undefined, { trigger: RefreshTrigger.AV_REFRESH_MANAGER });
        } else {
          // Standard endpoints: write data + metadata and log history
          const updateData = {
            data,
            metadata: {
              lastUpdated: now,
              nextRefreshAt: Timestamp.fromDate(new Date(Date.now() + ttl * 1000)),
              ttlSeconds: ttl,
              vendor: ApiProvider.ALPHA_VANTAGE,
              endpoint: endpointName,
              symbol,
            },
            lastRefreshEvent: {
              timestamp: now,
              status: 'success',
              durationMs,
              error: null,
            },
          };
          await docRef.set(updateData, { merge: true });
          log.info('refresh.write', { endpointId: endpoint, endpointName, symbol, status: 'success', durationMs });
          eStats.refreshed++;

          if (endpointConfig.symbolUsage && symbol) {
            await refreshLogger.updateSymbolMetadata({ symbol, endpointName, now: now.toDate(), ttl });
            log.debug('symbol.meta_updated', { endpointId: endpoint, endpointName, symbol });
          }

          updatedSymbols.add(symbol);

        // 6. Log refresh event to history with human-readable doc ID
          const historyPath = getHistoryPathFor(docPath);
          const nowDate = new Date();
          const refreshEventId = getRefreshEventDocId(ApiProvider.ALPHA_VANTAGE, endpoint, nowDate, symbol);
          await db.collection(historyPath).doc(refreshEventId).set({
            ...updateData.lastRefreshEvent,
            endpoint: endpointName,
            symbol,
            vendor: ApiProvider.ALPHA_VANTAGE,
            timestamp: now,
          });
          log.debug('history.written', { endpointId: endpoint, endpointName, symbol, refreshEventId });
          // Log success event to unified request logs and per-symbol status
          await healthMetricsService.recordSymbolRefresh(endpoint as any, symbol, RefreshStatus.SUCCESS, durationMs, undefined, { trigger: RefreshTrigger.AV_REFRESH_MANAGER });
        }
      } catch (error: any) {
        const durationMs = Date.now() - apiStart;
        log.error('refresh.error', { endpointId: endpoint, endpointName, symbol, durationMs, error: String(error?.message || error) });
        eStats.failures++;
        // For time-series endpoints, handlers log their own failures; avoid duplicate history writes here.
        if (!isTimeSeriesEndpoint(endpoint)) {
          const historyPath = getHistoryPathFor(docPath);
          const nowDate = new Date();
          const refreshEventId = getRefreshEventDocId(ApiProvider.ALPHA_VANTAGE, endpoint, nowDate, symbol);
          await db.collection(historyPath).doc(refreshEventId).set({
            timestamp: now,
            status: 'failure',
            durationMs,
            error: error.message,
            endpoint: endpointName,
            symbol,
            vendor: ApiProvider.ALPHA_VANTAGE,
          });
          log.debug('history.failure_written', { endpointId: endpoint, endpointName, symbol, refreshEventId });
        }
        // Log failure event to unified request logs and per-symbol status
        await healthMetricsService.recordSymbolRefresh(endpoint as any, symbol, RefreshStatus.FAILURE, durationMs, String(error?.message || error), { trigger: RefreshTrigger.AV_REFRESH_MANAGER });
      }
      hr('av.refresh', `--- SYMBOL END: ${symbol} ---`);
      hrBlank(3);
      log.info('symbol.end', { endpointId: endpoint, endpointName, symbol });
    }
    hr('av.refresh', `=========== END ENDPOINT [${endpoint}] ===========`);
    hrBlank(3);
    log.info('endpoint.complete', { endpointId: endpoint, endpointName });
    const s = endpointStatsMap.get(endpoint)!;
    // Human-readable endpoint summary
    hr('av.refresh', `Endpoint Summary [${s.endpointName}] checked=${s.checked} refreshed=${s.refreshed} fresh-skips=${s.skippedFresh} no-path=${s.skippedNoPath} empty=${s.skippedEmpty} failures=${s.failures}`);
    // Structured endpoint summary
    log.info('endpoint.summary', { endpointId: s.endpointId, endpointName: s.endpointName, checked: s.checked, refreshed: s.refreshed, skippedFresh: s.skippedFresh, skippedNoPath: s.skippedNoPath, skippedEmpty: s.skippedEmpty, failures: s.failures });

    // Write endpoint-level health metadata so health-metrics/{endpoint} is populated immediately
    try {
      const endpointDuration = Date.now() - endpointAttemptStart;
      const status = s.failures > 0 ? RefreshStatus.FAILURE : RefreshStatus.SUCCESS;
      const errorMsg = s.failures > 0 ? `one_or_more_symbol_failures (${s.failures})` : undefined;
      await healthMetricsService.recordRefreshAttempt(endpoint as any, status, errorMsg, endpointDuration);
    } catch (e: any) {
      log.warn('endpoint.health_record_failed', { endpointId: endpoint, error: String(e?.message || e) });
    }
  }
  const duration = Date.now() - batchStart;
  log.info('refresh.complete', { durationMs: duration, symbolsUpdatedCount: updatedSymbols.size, symbolsChecked, freshCount, staleCount, force });
  // Human-readable final summary
  hr('av.refresh', `TOTAL: checked=${symbolsChecked} updated=${updatedSymbols.size} fresh=${freshCount} stale=${staleCount} force=${force}`);
  // Structured final summary
  log.info('refresh.summary', { durationMs: duration, symbolsChecked, updated: updatedSymbols.size, fresh: freshCount, stale: staleCount, force });

  // Announce data-ready internally (no HTTP/OIDC) after a successful cycle.
  try {
    const nowMs = Date.now();
    const { phase, marketDate } = getAutoPhaseAndMarketDate();
    const tz = 'America/New_York';
    const hhmm = new Intl.DateTimeFormat('en-US', { timeZone: tz, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date()).replace(':', '');
    const runId = `${marketDate}-${phase}-${hhmm}`;

    const intervals: TimeSeriesInterval[] = [TimeSeriesInterval.DAILY];
    const payload: DataReadyPayloadV1 = {
      version: 'v1',
      runId,
      phase,
      intervals,
      time: nowMs,
      marketDate,
      symbolsUpdatedCount: updatedSymbols.size,
      env: (process.env.NODE_ENV || 'dev') as string,
    };

    // Explicitly mark this as a non-time-series run for consumer filtering
    await enqueueDataReadyInternal(payload, INTERNAL_PUBLISHER_AUDIT_EMAIL, { runType: PartnerRunType.NON_TIME_SERIES });
  } catch (error: any) {
    log.error('announce.error', { error: String(error?.message || error) });
  }

  return { durationMs: Date.now() - batchStart, symbolsUpdatedCount: updatedSymbols.size, symbolsChecked, freshCount, staleCount, force };
}

/**
 * Main scheduled function for refreshing Alpha Vantage data
 * Scans all tracked symbols and endpoints, checks freshness, and refreshes as needed
 */
export const refreshAlphaVantageDataV2 = onSchedule(
  {
    schedule: AV_REFRESH_MANAGER_SCHEDULE,
    timeZone: 'America/New_York',
    secrets: ['ALPHAVANTAGE_API_KEY'],
  },
  async () => {
    await runRefreshAlphaVantageDataV2();
  }
);

/**
 * Time-series write flow (overview)
 *
 * Schedulers:
 * - refreshAvDailyTimeSeriesPreClose (pre-close) → runs DAILY_ADJUSTED with phase PRE (intraday-only write)
 * - refreshAvDailyTimeSeriesPostClose (post-close) → runs DAILY_ADJUSTED with phase POST (finalized bar write)
 * - refreshAvWeeklyMonthlyTimeSeriesPostClose (post-close) → runs WEEKLY_ADJUSTED + MONTHLY_ADJUSTED with phase POST
 *
 * Execution path:
 * onSchedule → refreshForEndpoints([endpoint...], { phase }) →
 *   AlphaVantageHandlerFactory.createHandler(endpoint).fetch({ outputsize:'compact', __checkWriteToggle:false, __phase: phase })
 *   - For PRE + DAILY: fetch best-effort intraday price (GLOBAL_QUOTE) and pass __intradayPrice/__intradayObservedAt
 *
 * Persistence (inside handler base):
 * - PRE + DAILY (compact): upsert intraday snapshot fields only (ip/io/it/ic/ipc), skip parent meta bump
 * - POST + DAILY/WEEKLY/MONTHLY (compact): upsert latest bar OHLC (+ deltas) and bump parent freshness
 * - Full/backfill (rare): saveAvTimeSeriesData(bars,...)
 *
 * Schema:
 * - Top-level provider/interval doc holds metadata + latestBarTimestamp (no large arrays)
 * - Bars are stored in CompactBar shape under sharded docs (DAILY/WEEKLY by year; MONTHLY single 'all')
 */

// Daily time series: intraday hourly PRE (daily only)
export const refreshAvDailyTimeSeriesIntradayHourly = onSchedule({
  schedule: TS_DAILY_INTRADAY_HOURLY_SCHEDULE,
  timeZone: 'America/New_York',
  secrets: ['ALPHAVANTAGE_API_KEY'],
}, async () => {
  await refreshForEndpoints(
    [AlphaVantageEndpoint.TIME_SERIES_DAILY_ADJUSTED],
    {
      phase: TradingPhase.PRE,
      trigger: RefreshTrigger.SCHEDULER,
    }
  );
});

// Daily time series: pre-close (daily only)
export const refreshAvDailyTimeSeriesPreClose = onSchedule({
  schedule: TS_DAILY_PRE_CLOSE_SCHEDULE,
  timeZone: 'America/New_York',
  secrets: ['ALPHAVANTAGE_API_KEY'],
}, async () => {
  await refreshForEndpoints(
    [AlphaVantageEndpoint.TIME_SERIES_DAILY_ADJUSTED], 
    { 
      phase: TradingPhase.PRE,
      trigger: RefreshTrigger.SCHEDULER
    }
  );
});

// Daily time series: post-close (daily only)
export const refreshAvDailyTimeSeriesPostClose = onSchedule({
  schedule: TS_DAILY_POST_CLOSE_SCHEDULE,
  timeZone: 'America/New_York',
  secrets: ['ALPHAVANTAGE_API_KEY'],
}, async () => {
  await refreshForEndpoints(
    [AlphaVantageEndpoint.TIME_SERIES_DAILY_ADJUSTED], 
    { 
      phase: TradingPhase.POST,
      trigger: RefreshTrigger.SCHEDULER
    }
  );
});

// Weekly + Monthly time series: post-close every trading day
export const refreshAvWeeklyMonthlyTimeSeriesPostClose = onSchedule({
  schedule: TS_POST_CLOSE_SCHEDULE,
  timeZone: 'America/New_York',
  secrets: ['ALPHAVANTAGE_API_KEY'],
}, async () => {
  await refreshForEndpoints(
    [
      AlphaVantageEndpoint.TIME_SERIES_WEEKLY_ADJUSTED,
      AlphaVantageEndpoint.TIME_SERIES_MONTHLY_ADJUSTED,
    ], 
    { 
      phase: TradingPhase.POST,
      trigger: RefreshTrigger.SCHEDULER
    }
  );
});

// Daily time series: post-close evening retries (every 30 mins)
export const refreshAvDailyTimeSeriesPostEveningRetry30 = onSchedule({
  schedule: TS_DAILY_POST_EVENING_RETRY_MINUTE_30,
  timeZone: 'America/New_York',
  secrets: ['ALPHAVANTAGE_API_KEY'],
}, async () => {
  await refreshForEndpoints(
    [AlphaVantageEndpoint.TIME_SERIES_DAILY_ADJUSTED],
    {
      phase: TradingPhase.POST,
      trigger: RefreshTrigger.SCHEDULER,
    }
  );
});

export const refreshAvDailyTimeSeriesPostEveningRetry00 = onSchedule({
  schedule: TS_DAILY_POST_EVENING_RETRY_MINUTE_00,
  timeZone: 'America/New_York',
  secrets: ['ALPHAVANTAGE_API_KEY'],
}, async () => {
  await refreshForEndpoints(
    [AlphaVantageEndpoint.TIME_SERIES_DAILY_ADJUSTED],
    {
      phase: TradingPhase.POST,
      trigger: RefreshTrigger.SCHEDULER,
    }
  );
});

// Daily time series: next-morning catch-ups
export const refreshAvDailyTimeSeriesPostMorning0630 = onSchedule({
  schedule: TS_DAILY_POST_MORNING_CATCHUP_0630,
  timeZone: 'America/New_York',
  secrets: ['ALPHAVANTAGE_API_KEY'],
}, async () => {
  await refreshForEndpoints(
    [AlphaVantageEndpoint.TIME_SERIES_DAILY_ADJUSTED],
    {
      phase: TradingPhase.POST,
      trigger: RefreshTrigger.SCHEDULER,
    }
  );
});

export const refreshAvDailyTimeSeriesPostMorning0700 = onSchedule({
  schedule: TS_DAILY_POST_MORNING_CATCHUP_0700,
  timeZone: 'America/New_York',
  secrets: ['ALPHAVANTAGE_API_KEY'],
}, async () => {
  await refreshForEndpoints(
    [AlphaVantageEndpoint.TIME_SERIES_DAILY_ADJUSTED],
    {
      phase: TradingPhase.POST,
      trigger: RefreshTrigger.SCHEDULER,
    }
  );
});

/**
 * Helper used by schedulers to run specific endpoints at fixed times without freshness gating.
 * 
 * For each endpoint and symbol:
 * - Creates the appropriate handler via AlphaVantageHandlerFactory
 * - Calls handler.fetch({ outputsize:'compact', __checkWriteToggle:false })
 * - Handlers persist the latest bar (CompactBar) and record Health Metrics
 */
export async function refreshForEndpoints(
  endpoints: AlphaVantageEndpoint[], 
  options: { 
    force?: boolean; 
    phase?: TradingPhase;
    trigger?: RefreshTrigger;
  } = {}
) {
  // Market-closure guard (ET): weekend/holiday
  const mc2 = getMarketClosureInfo();
  if (mc2.closed) {
    // Use top-level logger to avoid constructing per-run logger when skipping
    log.info('market.closed_skip', { reason: mc2.reason, etDate: mc2.etDate, component: RefreshLogComponent.RefreshForEndpoints });
    return; // Silent no-op beyond the single structured log
  }
  const { force = false, phase, trigger = RefreshTrigger.SCHEDULER } = options;
  const startTime = Date.now();
  const logger = createLogger('av.refresh.scheduled');
  
  // Derive ET market date and DOW once for this invocation
  const tz = 'America/New_York';
  const now = new Date();
  const fmtDate = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' });
  const marketDate = fmtDate.format(now); // YYYY-MM-DD
  const dowIdx = Number(new Date(now.toLocaleString('en-US', { timeZone: tz })).getDay());
  const DOW_ENUM: DayOfWeek[] = [DayOfWeek.Sun, DayOfWeek.Mon, DayOfWeek.Tue, DayOfWeek.Wed, DayOfWeek.Thu, DayOfWeek.Fri, DayOfWeek.Sat];
  const dowEnum: DayOfWeek = DOW_ENUM[dowIdx];
  const dowStr = String(dowEnum).toUpperCase(); // For human-readable runId
  const phaseFinal: TradingPhase = phase ?? TradingPhase.POST;
  const phaseStrUpper = String(phaseFinal).toUpperCase();

  logger.info('refresh.start', { 
    endpoints, 
    force,
    phase: phaseFinal,
    trigger,
    marketDate,
    dow: dowEnum
  });

  // BEGIN message (time-series only, limited to DAILY intraday/pre/post runs)
  try {
    const phasePartner: PartnerPhase = (phaseFinal === TradingPhase.PRE ? PartnerPhase.PRE : PartnerPhase.POST);
    const hhmm = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date()).replace(':', '');
    const runId = `${marketDate}-${phasePartner}-${hhmm}`;

    // Determine if any DAILY interval present; we only emit for DAILY in this scope
    const includesDaily = endpoints.some((e) => e === AlphaVantageEndpoint.TIME_SERIES_DAILY_ADJUSTED);
    if (includesDaily) {
      const payload: DataReadyPayloadV1 = {
        version: 'v1',
        runId,
        phase: phasePartner,
        intervals: [TimeSeriesInterval.DAILY],
        time: Date.now(),
        marketDate,
        env: (process.env.NODE_ENV || 'dev') as string,
        status: 'begin',
        runStatus: 'processing',
      };
      const runType = (phasePartner === PartnerPhase.PRE) ? PartnerRunType.TS_DAILY_PRE : PartnerRunType.TS_DAILY_POST;
      await enqueueDataReadyInternal(payload, INTERNAL_PUBLISHER_AUDIT_EMAIL, { runType });
    }
  } catch (e) {
    logger.error('announce.begin_failed', { error: e && typeof e === 'object' && 'message' in (e as any) ? String((e as any).message) : String(e) });
  }

  try {
    const healthMetricsService = new HealthMetricsService();
    
    // Load tracked symbols and types
    const symbolsSnap = await db.collection(FirestoreCollection.TRACKED_SYMBOLS).get();
    const symbols = symbolsSnap.docs.map(d => d.id);
    
    // For time series endpoints, we'll process each symbol
    for (const endpoint of endpoints) {
      const endpointName = AlphaVantageEndpoint[endpoint];
      const endpointConfig = AV_TIME_SERIES_ENDPOINT_CONFIGS[endpointName] || AV_ENDPOINT_CONFIGS[endpointName];
      
      if (!endpointConfig) {
        logger.warn('refresh.skipped', { endpoint, reason: 'no_config' });
        continue;
      }

      // Build a human-readable run id and context for this endpoint
      const runId = `${marketDate}_${dowStr}_${phaseStrUpper}_${endpoint}`;
      const endpointShort = (() => {
        // Shorthand mapping for readability in headers; keep simple and explicit
        if (endpoint === AlphaVantageEndpoint.TIME_SERIES_DAILY_ADJUSTED) return 'TS_DAILY_ADJ';
        if (endpoint === AlphaVantageEndpoint.TIME_SERIES_WEEKLY_ADJUSTED) return 'TS_WEEKLY_ADJ';
        if (endpoint === AlphaVantageEndpoint.TIME_SERIES_MONTHLY_ADJUSTED) return 'TS_MONTHLY_ADJ';
        return String(endpoint).toUpperCase();
      })();
      const run = { id: runId, date: marketDate, dow: dowEnum, phase: phaseFinal, endpointId: endpoint, endpointShort, trigger };
      
      for (const symbol of symbols) {
        try {
          const handler = AlphaVantageHandlerFactory.createHandler(endpoint);
          const baseParams: any = { 
            symbol, 
            outputsize: 'compact', 
            __checkWriteToggle: false, 
            __phase: phaseFinal,
            __run: run,
          };
          
          await handler.fetch(baseParams);
          
          // Record successful refresh with run context
          await healthMetricsService.recordSymbolRefresh(
            endpoint,
            symbol,
            RefreshStatus.SUCCESS,
            Date.now() - startTime,
            undefined,
            { trigger, runId, run }
          );
          
          logger.info('refresh.success', { 
            endpoint,
            symbol,
            phase: phaseFinal,
            trigger,
            runId,
            durationMs: Date.now() - startTime
          });
          
        } catch (error) {
          // Record failed refresh with run context
          await healthMetricsService.recordSymbolRefresh(
            endpoint,
            symbol,
            RefreshStatus.FAILURE,
            0,
            error && typeof error === 'object' && 'message' in error ? String((error as any).message) : String(error),
            { trigger, runId, run }
          );
          
          logger.error('refresh.error', { 
            endpoint, 
            symbol,
            phase: phaseFinal,
            trigger,
            runId,
            error: error && typeof error === 'object' && 'message' in (error as any) ? String((error as any).message) : String(error),
            durationMs: Date.now() - startTime
          });
        }
      }
    }
  } catch (error) {
    logger.error('refresh.fatal', { 
      error: error && typeof error === 'object' && 'message' in (error as any) ? String((error as any).message) : String(error),
      durationMs: Date.now() - startTime
    });
    throw error;
  } finally {
    // After all endpoints and symbols are processed, announce data is ready
    // but only for time series endpoints
    const timeSeriesEndpoints = endpoints.filter(isTimeSeriesEndpoint);
    if (timeSeriesEndpoints.length > 0) {
      try {
        await announceDataReady(timeSeriesEndpoints, { 
          phase: phase ?? TradingPhase.POST // Default to POST if phase not specified
        });
      } catch (announceError) {
        logger.error('announce.failed', {
          error: announceError && typeof announceError === 'object' && 'message' in (announceError as any) 
            ? String((announceError as any).message) 
            : String(announceError)
        });
        // Don't rethrow to avoid masking original error if there was one
      }
    }
    
    logger.info('refresh.complete', { 
      durationMs: Date.now() - startTime,
      endpoints: endpoints.join(','),
      phase: phaseFinal,
      trigger: trigger
    });
  }
}

/**
 * After all endpoints and symbols processed, announce data is ready
 */
async function announceDataReady(
  endpoints: AlphaVantageEndpoint[], 
  options: { 
    phase: TradingPhase;
  }
) {
  try {
    const tz = 'America/New_York';
    const now = new Date();
    const fmtDate = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' });
    const marketDate = fmtDate.format(now); // YYYY-MM-DD

    // Map endpoints -> intervals
    const intervals = Array.from(new Set(endpoints.map((e) => {
      if (e === AlphaVantageEndpoint.TIME_SERIES_DAILY_ADJUSTED) return TimeSeriesInterval.DAILY;
      if (e === AlphaVantageEndpoint.TIME_SERIES_WEEKLY_ADJUSTED) return TimeSeriesInterval.WEEKLY;
      if (e === AlphaVantageEndpoint.TIME_SERIES_MONTHLY_ADJUSTED) return TimeSeriesInterval.MONTHLY;
      return null as any;
    }).filter(Boolean))) as TimeSeriesInterval[];

    const phase: PartnerPhase = (options.phase === TradingPhase.PRE ? PartnerPhase.PRE : PartnerPhase.POST);
    const hhmm = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date()).replace(':', '');
    const runId = `${marketDate}-${phase}-${hhmm}`;

    // Emit one message per interval with explicit runType to minimize consumer-side filtering
    for (const interval of intervals) {
      const payload: DataReadyPayloadV1 = {
        version: 'v1',
        runId,
        phase,
        intervals: [interval],
        time: Date.now(),
        marketDate,
        env: (process.env.NODE_ENV || 'dev') as string,
        status: 'end',
        runStatus: 'completed',
        endTimeUTC: new Date().toISOString(),
        nextRefreshAtUTC: computeNextRefreshAtUtc(options.phase),
      };

      let runType: PartnerRunType = PartnerRunType.NON_TIME_SERIES; // default not used below
      if (interval === TimeSeriesInterval.DAILY && phase === PartnerPhase.PRE) runType = PartnerRunType.TS_DAILY_PRE;
      else if (interval === TimeSeriesInterval.DAILY && phase === PartnerPhase.POST) runType = PartnerRunType.TS_DAILY_POST;
      else if (interval === TimeSeriesInterval.WEEKLY && phase === PartnerPhase.POST) runType = PartnerRunType.TS_WEEKLY_POST;
      else if (interval === TimeSeriesInterval.MONTHLY && phase === PartnerPhase.POST) runType = PartnerRunType.TS_MONTHLY_POST;

      await enqueueDataReadyInternal(payload, INTERNAL_PUBLISHER_AUDIT_EMAIL, { runType });
    }
  } catch (e: any) {
    console.error('Failed to enqueue data-ready after time-series run', e?.message || e);
  }
}
