// =======================================
// DATA MANAGER: Alpha Vantage-Only Refresher
// VERSION: 1.2.0 (auto phase, internal announce, real symbolsUpdatedCount)
// =======================================

import { db } from '../../../firebase-admin-init';
import { Timestamp } from 'firebase-admin/firestore';
import { onSchedule } from 'firebase-functions/v2/scheduler';

import { AlphaVantageHandlerFactory } from '../../alpha-vantage/alpha-vantage-factory';

import { AV_ENDPOINT_CONFIGS, AV_IMPLEMENTED_ENDPOINTS, AV_TIME_SERIES_ENDPOINT_CONFIGS, TimeSeriesInterval, AlphaVantageEndpoint, DayOfWeek, OutputSize } from '@shared/alpha-vantage';
import { ApiProvider } from '@shared/core';
import { FirestoreCollection, RefreshStatus, RefreshTrigger } from '@shared/firestore';

import { AV_REFRESH_MANAGER_SCHEDULE, TS_DAILY_PRE_CLOSE_SCHEDULE, TS_DAILY_POST_CLOSE_SCHEDULE, TS_POST_CLOSE_SCHEDULE, TS_DAILY_INTRADAY_HOURLY_SCHEDULE, TS_DAILY_POST_EVENING_RETRY_MINUTE_30, TS_DAILY_POST_EVENING_RETRY_MINUTE_00, TS_DAILY_POST_MORNING_CATCHUP_0630, TS_DAILY_POST_MORNING_CATCHUP_0700 } from '../../common/function-schedules';

import { createLogger, hr, hrBlank, getMarketClosureInfo, RefreshLogComponent } from '../../utils/utils';
import { resolveFirestorePath, getRefreshEventDocId } from '../../utils/firestore-utils';
import { getSymbolTimeSeriesDocPath } from '../../common/firestore/firestore-paths';
import { getSymbolTimeSeriesYearDocPath, getYearFromEpochMillis } from '../../common/firestore/firestore-paths';
import { refreshLogger } from '../../services/refresh-logger.service';
import { enqueueDataReadyInternal } from '../../partner/data-ready.handler';
import type { DataReadyPayloadV1 } from '../../partner/schemas/data-ready.schema';
import { INTERNAL_PUBLISHER_AUDIT_EMAIL, PartnerPhase, PartnerRunType, PartnerRunStatus, PartnerPublishStatus } from '../../partner/constants';
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

    // Convert an ET wall time to a UTC ISO string using EST/EDT fixed offsets
    function etToUtcIso(y: number, m: number, d: number, hh: number, mm: number): string {
      const etDate = new Date(new Date(Date.UTC(y, m - 1, d, hh, mm, 0, 0)).toLocaleString('en-US', { timeZone: tz }));
      const tzName = new Intl.DateTimeFormat('en-US', { timeZone: tz, timeZoneName: 'short' }).format(etDate);
      const isEDT = tzName.includes('EDT');
      const offset = isEDT ? '-04:00' : '-05:00';
      const mmStr = String(m).padStart(2, '0');
      const ddStr = String(d).padStart(2, '0');
      const hhStr = String(hh).padStart(2, '0');
      const minStr = String(mm).padStart(2, '0');
      const isoEt = `${y}-${mmStr}-${ddStr}T${hhStr}:${minStr}:00${offset}`;
      return new Date(isoEt).toISOString();
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

      // Find first event strictly after current ET time
      for (const ev of preEtEvents) {
        if (h < ev.hh || (h === ev.hh && min < ev.mm)) {
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
      if (h < ev.hh || (h === ev.hh && min < ev.mm)) {
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
    const isManual = (((options as any)?.trigger === RefreshTrigger.MANUAL) || (process.env.FUNCTIONS_EMULATOR === 'true'));
    const runId = isManual ? `${marketDate}-${hhmm}-${phase}-manual` : `${marketDate}-${hhmm}-${phase}`;

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

  // Optional per-symbol update logging to system/time-series-status for analysis
  // Enable by setting env var TS_STATUS_UPDATELOG=on
  const enableUpdateLog = String(process.env.TS_STATUS_UPDATELOG || '').toLowerCase() === 'on';
  // Local guard to avoid further writes in this run once cap is reached
  let updateLogCapped = false;

  // BEGIN message (time-series only, limited to DAILY intraday/pre/post runs)
  // Hoist runId so END uses the same ID
  let beginRunId: string | null = null;
  let beginStartIso: string | null = null;
  try {
    const phasePartner: PartnerPhase = (phaseFinal === TradingPhase.PRE ? PartnerPhase.PRE : PartnerPhase.POST);
    const hhmm = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date()).replace(':', '');
    const isManual = (trigger === RefreshTrigger.MANUAL) || (process.env.FUNCTIONS_EMULATOR === 'true');
    const runId = isManual ? `${marketDate}-${hhmm}-${phasePartner}-manual` : `${marketDate}-${hhmm}-${phasePartner}`;
    beginRunId = runId;
    beginStartIso = new Date().toISOString();

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
        status: PartnerPublishStatus.BEGIN,
        runStatus: PartnerRunStatus.PROCESSING,
      };
      const runType = (phasePartner === PartnerPhase.PRE) ? PartnerRunType.TS_DAILY_PRE : PartnerRunType.TS_DAILY_POST;
      await enqueueDataReadyInternal(payload, INTERNAL_PUBLISHER_AUDIT_EMAIL, { runType });

      // Persist system-level status (BEGIN)
      try {
        const statusDocPath = `${FirestoreCollection.SYSTEM}/${FirestoreCollection.TIME_SERIES_STATUS}/${FirestoreCollection.DAILY_ADJUSTED}/${marketDate}`;
        await db.doc(statusDocPath).set({
          currentRun: {
            runId,
            phase: phasePartner,
            runType,
            status: PartnerPublishStatus.BEGIN,
            runStatus: PartnerRunStatus.PROCESSING,
            startTimeUTC: beginStartIso,
          },
          counts: {
            totalSymbols: null,
            finalizedCountTotal: 0,
            pendingCount: null,
            deltaCount: 0,
          },
          marketDate,
          endpoint: String(FirestoreCollection.DAILY_ADJUSTED),
          source: 'av-refresh-manager',
          timing: { updatedAt: Timestamp.now(), createdAt: Timestamp.now() },
        }, { merge: true });
        try {
          const snap = await db.doc(statusDocPath).get();
          logger.info('status.begin.doc', { path: statusDocPath, data: snap.data() });
        } catch {}

        // Ensure the ROOT doc exists: system/time-series-status (not per-date)
        try {
          const statusRootPath = `${FirestoreCollection.SYSTEM}/${FirestoreCollection.TIME_SERIES_STATUS}`;
          const statusRootRef = db.doc(statusRootPath);
          await db.runTransaction(async (tx) => {
            const rs = await tx.get(statusRootRef);
            const prev = rs.exists ? (rs.data() as any) : {};
            const createdAt = prev?.timing?.createdAt ?? Timestamp.now();
            tx.set(statusRootRef, {
              metadata: { source: 'av-refresh-manager' },
              timing: { createdAt, updatedAt: Timestamp.now() },
            }, { merge: true });
          });
          const rSnap = await statusRootRef.get();
          logger.info('status.root.doc', { path: statusRootPath, data: rSnap.data() });
        } catch {}

        // Ensure the ROOT doc exists: system/time-series-finalization (not per-date)
        try {
          const finalRootPath = `${FirestoreCollection.SYSTEM}/${FirestoreCollection.TIME_SERIES_FINALIZATION}`;
          const finalRootRef = db.doc(finalRootPath);
          await db.runTransaction(async (tx) => {
            const rs = await tx.get(finalRootRef);
            const prev = rs.exists ? (rs.data() as any) : {};
            const createdAt = prev?.timing?.createdAt ?? Timestamp.now();
            tx.set(finalRootRef, {
              metadata: { source: 'av-refresh-manager' },
              timing: { createdAt, updatedAt: Timestamp.now() },
            }, { merge: true });
          });
          const frSnap = await finalRootRef.get();
          logger.info('finalization.root.doc', { path: finalRootPath, data: frSnap.data() });
        } catch {}

        // Pre-create the finalization doc skeleton so the UI shows the doc and metadata immediately
        try {
          const finalDocPath = `${FirestoreCollection.SYSTEM}/${FirestoreCollection.TIME_SERIES_FINALIZATION}/${FirestoreCollection.DAILY_ADJUSTED}/${marketDate}`;
          const finalRef = db.doc(finalDocPath);
          await finalRef.set({
            marketDate,
            phase: String(phasePartner),
            source: 'av-refresh-manager',
            timing: { createdAt: Timestamp.now(), updatedAt: Timestamp.now() },
          }, { merge: true });
          const fSnap = await finalRef.get();
          logger.info('finalization.begin.skeleton', { path: finalDocPath, data: fSnap.data() });
        } catch {}
      } catch {}
    }
  } catch (e) {
    logger.error('announce.begin_failed', { error: e && typeof e === 'object' && 'message' in (e as any) ? String((e as any).message) : String(e) });
  }

  // Hoisted context for finally block
  const healthMetricsService = new HealthMetricsService();
  let symbols: string[] = [];
  const finalizedBefore: Set<string> = new Set<string>();
  const deltaFinalized: Set<string> = new Set<string>();
  let targetTs: number = NaN;
  // Collect per-endpoint stats for the specific endpoints run by refreshForEndpoints (time-series only)
  const tsStats = new Map<AlphaVantageEndpoint, { refreshed: number; failures: number }>();

  try {
    // Load tracked symbols and types
    const symbolsSnap = await db.collection(FirestoreCollection.TRACKED_SYMBOLS).get();
    symbols = symbolsSnap.docs.map(d => d.id);
    
    // For time series endpoints, we'll process each symbol
    // Preflight: build finalized-before set for DAILY only
    const includesDaily = endpoints.some((e) => e === AlphaVantageEndpoint.TIME_SERIES_DAILY_ADJUSTED);
    targetTs = new Date(`${marketDate}T00:00:00.000Z`).getTime();
    if (includesDaily && Number.isFinite(targetTs)) {
      for (const s of symbols) {
        try {
          const docPath = getSymbolTimeSeriesDocPath(s, AlphaVantageEndpoint.TIME_SERIES_DAILY_ADJUSTED, ApiProvider.ALPHA_VANTAGE);
          const snap = await db.doc(docPath).get();
          const ts = snap.get('latestBarTimestamp');
          const tsMs = ts && typeof ts.toMillis === 'function' ? ts.toMillis() : (typeof ts === 'number' ? ts : null);
          if (Number.isFinite(tsMs) && tsMs === targetTs) finalizedBefore.add(s);
        } catch {}
      }
    }

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
      
      // Enforce a capped batch per run for DAILY POST to respect provider limits (scoped to this endpoint and phase)
      const isDaily = endpoint === AlphaVantageEndpoint.TIME_SERIES_DAILY_ADJUSTED;
      const isPost = (phaseFinal === TradingPhase.POST);
      const MAX_DAILY_POST_BATCH = 60;
      let processedThisRun = 0;

      for (const symbol of symbols) {
        if (isDaily && isPost && processedThisRun >= MAX_DAILY_POST_BATCH) {
          const phaseLabel = isPost ? PartnerPhase.POST : PartnerPhase.PRE;
          log.info('refresh.batch_cap_reached', { endpoint, phase: phaseLabel, cap: MAX_DAILY_POST_BATCH });
          break;
        }
        try {
          const handler = AlphaVantageHandlerFactory.createHandler(endpoint);
          const baseParams: any = { 
            symbol, 
            outputsize: OutputSize.COMPACT, 
            __checkWriteToggle: false, 
            __phase: phaseFinal,
            __run: run,
          };
          
          await handler.fetch(baseParams);
          processedThisRun++;
          // Track time-series refreshed count
          if (isTimeSeriesEndpoint(endpoint)) {
            const cur = tsStats.get(endpoint) || { refreshed: 0, failures: 0 };
            cur.refreshed++;
            tsStats.set(endpoint, cur);
          }
          
          // For DAILY, detect flip to today after handler write to compute delta
          if (endpoint === AlphaVantageEndpoint.TIME_SERIES_DAILY_ADJUSTED && Number.isFinite(targetTs)) {
            try {
              const docPath = getSymbolTimeSeriesDocPath(symbol, endpoint, ApiProvider.ALPHA_VANTAGE);
              const snapAfter = await db.doc(docPath).get();
              const ts = snapAfter.get('latestBarTimestamp');
              const tsMs = ts && typeof ts.toMillis === 'function' ? ts.toMillis() : (typeof ts === 'number' ? ts : null);
              if (!finalizedBefore.has(symbol) && Number.isFinite(tsMs) && tsMs === targetTs) {
                deltaFinalized.add(symbol);
              }
            } catch {}
          }

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

          // Append per-symbol update log entry for DAILY POST runs when enabled
          if (enableUpdateLog && !updateLogCapped && endpoint === AlphaVantageEndpoint.TIME_SERIES_DAILY_ADJUSTED && phaseFinal === TradingPhase.POST) {
            try {
              const statusDocPath = `${FirestoreCollection.SYSTEM}/${FirestoreCollection.TIME_SERIES_STATUS}/${FirestoreCollection.DAILY_ADJUSTED}/${marketDate}`;
              const ref = db.doc(statusDocPath);
              const entry: [string, number] = [symbol, Date.now()];
              const CAP = 3000;
              await db.runTransaction(async (tx) => {
                const snap = await tx.get(ref);
                const prev = snap.exists ? (snap.data() as any) : {};
                const list: any[] = Array.isArray(prev?.updateLog) ? prev.updateLog : [];
                // If cap already reached, skip write and mark capped for the remainder of this run
                if (Array.isArray(list) && list.length >= CAP) {
                  updateLogCapped = true;
                  return;
                }
                const updated = [...list, entry];
                const capped = updated.length > CAP ? updated.slice(updated.length - CAP) : updated;
                if (capped.length >= CAP) {
                  updateLogCapped = true;
                }
                tx.set(ref, { updateLog: capped, timing: { updatedAt: Timestamp.now(), createdAt: prev?.timing?.createdAt ?? Timestamp.now() } }, { merge: true });
              });
            } catch {}
          }
          
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
      // Near-complete acceleration pass: when only a small number remain, try a short second pass on a tiny subset
      if (isDaily && isPost && Number.isFinite(targetTs)) {
        const total = Array.isArray(symbols) ? symbols.length : 0;
        const finalizedTotal = finalizedBefore.size + deltaFinalized.size;
        const pendingCount = Math.max(0, total - finalizedTotal);
        const NEAR_COMPLETE_THRESHOLD = 10;
        if (pendingCount > 0 && pendingCount <= NEAR_COMPLETE_THRESHOLD) {
          log.info('acceleration.start', { endpoint, pendingCount, threshold: NEAR_COMPLETE_THRESHOLD });
          const ACCELERATION_LIMIT = 20;
          let accelerated = 0;
          for (const s of symbols) {
            if (accelerated >= ACCELERATION_LIMIT) break;
            if (finalizedBefore.has(s) || deltaFinalized.has(s)) continue;
            try {
              const handler = AlphaVantageHandlerFactory.createHandler(endpoint);
              const baseParams: any = { 
                symbol: s, 
                outputsize: OutputSize.COMPACT, 
                __checkWriteToggle: false, 
                __phase: phaseFinal,
                __run: { id: `${marketDate}_${dowStr}_${phaseStrUpper}_${endpoint}`, date: marketDate, dow: dowEnum, phase: phaseFinal, endpointId: endpoint, endpointShort: 'TS_DAILY_ADJ', trigger }
              };
              await handler.fetch(baseParams);
              accelerated++;
              // Check flip
              const docPath = getSymbolTimeSeriesDocPath(s, endpoint, ApiProvider.ALPHA_VANTAGE);
              const snapAfter = await db.doc(docPath).get();
              const ts = snapAfter.get('latestBarTimestamp');
              const tsMs = ts && typeof ts.toMillis === 'function' ? ts.toMillis() : (typeof ts === 'number' ? ts : null);
              if (!finalizedBefore.has(s) && Number.isFinite(tsMs) && tsMs === targetTs) {
                deltaFinalized.add(s);
              }
            } catch {}
          }
          log.info('acceleration.complete', { endpoint, accelerated, pendingBefore: pendingCount, deltaNow: deltaFinalized.size });
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
    // After all endpoints and symbols are processed, announce data is ready for time-series endpoints
    const timeSeriesEndpoints = endpoints.filter(isTimeSeriesEndpoint);
    if (timeSeriesEndpoints.length > 0) {
      try {
        const phasePartner: PartnerPhase = (phaseFinal === TradingPhase.PRE ? PartnerPhase.PRE : PartnerPhase.POST);
        const hhmm = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date()).replace(':', '');
        const isManual = ((options?.trigger === RefreshTrigger.MANUAL) || (process.env.FUNCTIONS_EMULATOR === 'true'));
        const runId = beginRunId || (isManual ? `${marketDate}-${hhmm}-${phasePartner}-manual` : `${marketDate}-${hhmm}-${phasePartner}`);

        // Map endpoints -> intervals
        const intervals = Array.from(new Set(timeSeriesEndpoints.map((e) => {
          if (e === AlphaVantageEndpoint.TIME_SERIES_DAILY_ADJUSTED) return TimeSeriesInterval.DAILY;
          if (e === AlphaVantageEndpoint.TIME_SERIES_WEEKLY_ADJUSTED) return TimeSeriesInterval.WEEKLY;
          if (e === AlphaVantageEndpoint.TIME_SERIES_MONTHLY_ADJUSTED) return TimeSeriesInterval.MONTHLY;
          return null as any;
        }).filter(Boolean))) as TimeSeriesInterval[];

        for (const interval of intervals) {
          // Compute aggregate successes/failures for endpoints that map to this interval
          const endpointsForInterval = timeSeriesEndpoints.filter((e) => {
            if (interval === TimeSeriesInterval.DAILY) return e === AlphaVantageEndpoint.TIME_SERIES_DAILY_ADJUSTED;
            if (interval === TimeSeriesInterval.WEEKLY) return e === AlphaVantageEndpoint.TIME_SERIES_WEEKLY_ADJUSTED;
            if (interval === TimeSeriesInterval.MONTHLY) return e === AlphaVantageEndpoint.TIME_SERIES_MONTHLY_ADJUSTED;
            return false;
          });
          let failures = 0;
          let successes = 0;
          for (const ep of endpointsForInterval) {
            const s = tsStats.get(ep as AlphaVantageEndpoint);
            if (s) {
              failures += (s.failures || 0);
              successes += (s.refreshed || 0);
            }
          }
          const payload: DataReadyPayloadV1 = {
            version: 'v1',
            runId,
            phase: phasePartner,
            intervals: [interval],
            time: Date.now(),
            marketDate,
            env: (process.env.NODE_ENV || 'dev') as string,
            status: PartnerPublishStatus.END,
            runStatus: PartnerRunStatus.COMPLETED,
            endTimeUTC: new Date().toISOString(),
            nextRefreshAtUTC: computeNextRefreshAtUtc(phaseFinal),
          };

          // Align symbolsUpdated with successes for END publishes
          payload.symbolsUpdatedCount = successes;

          // DAILY-specific pending/delta computation (POST only)
          if (interval === TimeSeriesInterval.DAILY && phaseFinal === TradingPhase.POST && Number.isFinite(targetTs)) {
            const total = Array.isArray(symbols) ? symbols.length : 0;
            const finalizedTotal = finalizedBefore.size + deltaFinalized.size;
            const pendingCount = Math.max(0, total - finalizedTotal);
            const deltaList = Array.from(deltaFinalized);
            const MAX_DELTA = 500;
            const deltaTruncated = deltaList.length > MAX_DELTA;
            const deltaFinalizedSymbols = deltaTruncated ? deltaList.slice(0, MAX_DELTA) : deltaList;

            payload.pendingCount = pendingCount;
            payload.deltaFinalizedSymbols = deltaFinalizedSymbols;
            if (deltaTruncated) payload.deltaTruncated = true;
            payload.finalizedCountTotal = finalizedTotal;
            payload.runStatus = (pendingCount === 0 ? PartnerRunStatus.COMPLETED : PartnerRunStatus.PROCESSING);

            // Announce END with concise metrics
            try {
              log.info('announce.end', { pendingCount, finalizedCountTotal: finalizedTotal, deltaCount: deltaFinalizedSymbols.length, runId });
            } catch {}

            // Morning-first: include a small remaining sample (heuristic: ET hour <= 8)
            const etNow = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/New_York' }));
            const etHour = etNow.getHours();
            if (pendingCount > 0 && etHour <= 8) {
              const remaining: string[] = [];
              for (const s of symbols) {
                if (remaining.length >= 50) break;
                if (!finalizedBefore.has(s) && !deltaFinalized.has(s)) remaining.push(s);
              }
              payload.remainingSymbols = remaining;
              if (pendingCount > remaining.length) payload.remainingSampleTruncated = true;
            }

            // finalizedAtUTC: set only when all symbols are finalized (pendingCount===0).
            // Use the latest fz (last symbol to finalize) as the timestamp for the day.
            if (pendingCount === 0) {
              try {
                const finalizedSymbols = Array.from(new Set<string>([...finalizedBefore, ...deltaFinalized]));
                const sample = finalizedSymbols.slice(0, 25);
                const y = getYearFromEpochMillis(Number(targetTs));
                let maxFz: number | null = null;
                for (const s of sample) {
                  const yearDocPath = getSymbolTimeSeriesYearDocPath(s, AlphaVantageEndpoint.TIME_SERIES_DAILY_ADJUSTED, ApiProvider.ALPHA_VANTAGE, y);
                  const snap = await db.doc(yearDocPath).get();
                  const bars = (snap.get('bars') ?? []) as Array<any>;
                  const b = bars.find((bb) => Number(bb?.t) === Number(targetTs));
                  const fz = b?.fz != null ? Number(b.fz) : null;
                  if (Number.isFinite(fz)) {
                    maxFz = (maxFz == null) ? fz : Math.max(maxFz, fz as number);
                  }
                }
                if (maxFz != null) {
                  const finalizedIso = new Date(maxFz).toISOString();
                  payload.finalizedAtUTC = finalizedIso;
                  try {
                    // Persist a day-level marker for UI/partners (use enum-based segments)
                    const docPath = `${FirestoreCollection.SYSTEM}/${FirestoreCollection.TIME_SERIES_FINALIZATION}/${FirestoreCollection.DAILY_ADJUSTED}/${marketDate}`;
                    const docRef = db.doc(docPath);
                    const tz = 'America/New_York';
                    const finalizedAtET = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' }).format(new Date(maxFz)).replace(',', '');
                    await db.runTransaction(async (tx) => {
                      const snap = await tx.get(docRef);
                      const prev = snap.exists ? (snap.data() as any) : {};
                      const createdAt = prev?.createdAt ?? Timestamp.now();
                      tx.set(docRef, {
                        marketDate,
                        finalizedAtUTC: finalizedIso,
                        finalizedAtET,
                        totalSymbols: Array.isArray(symbols) ? symbols.length : 0,
                        finalizedCountTotal: finalizedTotal,
                        phase: String(phasePartner),
                        source: 'av-refresh-manager',
                        timing: { createdAt, updatedAt: Timestamp.now() },
                      }, { merge: true });
                    });
                    try {
                      const snapNow = await docRef.get();
                      logger.info('finalization.doc', { path: docPath, data: snapNow.data() });
                    } catch {}
                  } catch {}
                }
              } catch {}
            }

            // Persist system-level status (END) with counts and run outcome
            try {
              const statusDocPath = `${FirestoreCollection.SYSTEM}/${FirestoreCollection.TIME_SERIES_STATUS}/${FirestoreCollection.DAILY_ADJUSTED}/${marketDate}`;
              const endIso = new Date().toISOString();
              const endRunStatus = (pendingCount === 0 ? PartnerRunStatus.COMPLETED : PartnerRunStatus.PROCESSING);
              await db.runTransaction(async (tx) => {
                const ref = db.doc(statusDocPath);
                const snap = await tx.get(ref);
                const prev = snap.exists ? snap.data() as any : {};
                const prevRuns: any[] = Array.isArray(prev?.runs) ? prev.runs : [];
                const startTimeUTC = (prev?.currentRun?.runId === runId && prev?.currentRun?.startTimeUTC) ? prev.currentRun.startTimeUTC : beginStartIso;
                const updatedRuns = [...prevRuns, {
                  runId,
                  status: PartnerPublishStatus.END,
                  runStatus: endRunStatus,
                  startTimeUTC: startTimeUTC ?? null,
                  endTimeUTC: endIso,
                  pendingCount,
                  finalizedCountTotal: finalizedTotal,
                  deltaCount: deltaFinalizedSymbols.length,
                }];
                const capped = updatedRuns.slice(-30);
                tx.set(ref, {
                  currentRun: {
                    runId,
                    phase: phasePartner,
                    runType: (phasePartner === PartnerPhase.PRE) ? PartnerRunType.TS_DAILY_PRE : PartnerRunType.TS_DAILY_POST,
                    status: PartnerPublishStatus.END,
                    runStatus: endRunStatus,
                    endTimeUTC: endIso,
                  },
                  counts: {
                    totalSymbols: total,
                    finalizedCountTotal: finalizedTotal,
                    pendingCount,
                    deltaCount: deltaFinalizedSymbols.length,
                  },
                  marketDate,
                  endpoint: String(FirestoreCollection.DAILY_ADJUSTED),
                  source: 'av-refresh-manager',
                  timing: { updatedAt: Timestamp.now(), createdAt: prev?.timing?.createdAt ?? Timestamp.now() },
                  runs: capped,
                }, { merge: true });
              });
              try {
                const snap = await db.doc(statusDocPath).get();
                logger.info('status.end.doc', { path: statusDocPath, data: snap.data() });
              } catch {}
            } catch {}
          }

          // Emit END
          await enqueueDataReadyInternal(payload, INTERNAL_PUBLISHER_AUDIT_EMAIL, { 
            runType: (interval === TimeSeriesInterval.DAILY && phasePartner === PartnerPhase.PRE) ? PartnerRunType.TS_DAILY_PRE
              : (interval === TimeSeriesInterval.DAILY && phasePartner === PartnerPhase.POST) ? PartnerRunType.TS_DAILY_POST
              : (interval === TimeSeriesInterval.WEEKLY && phasePartner === PartnerPhase.POST) ? PartnerRunType.TS_WEEKLY_POST
              : (interval === TimeSeriesInterval.MONTHLY && phasePartner === PartnerPhase.POST) ? PartnerRunType.TS_MONTHLY_POST
              : PartnerRunType.NON_TIME_SERIES,
            failures: String(failures),
            successes: String(successes)
          });
        }
      } catch (announceError) {
        logger.error('announce.failed', {
          error: announceError && typeof announceError === 'object' && 'message' in (announceError as any) 
            ? String((announceError as any).message) 
            : String(announceError)
        });
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

