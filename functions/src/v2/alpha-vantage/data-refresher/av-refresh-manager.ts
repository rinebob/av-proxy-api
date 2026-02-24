// =======================================
// DATA MANAGER: Alpha Vantage-Only Refresher
// VERSION: 1.2.0 (auto phase, internal announce, real symbolsUpdatedCount)
// =======================================

import { db } from '../../../firebase-admin-init';
import { Timestamp, FieldValue } from 'firebase-admin/firestore';
import { getFunctions } from 'firebase-admin/functions';
import { onSchedule } from 'firebase-functions/v2/scheduler';

import { AlphaVantageHandlerFactory } from '../../alpha-vantage/alpha-vantage-factory';

import { AV_ENDPOINT_CONFIGS, AV_IMPLEMENTED_ENDPOINTS, AV_TIME_SERIES_ENDPOINT_CONFIGS, TimeSeriesInterval, AlphaVantageEndpoint, DayOfWeek, OutputSize } from '@shared/alpha-vantage';
import { ApiProvider } from '@shared/core';
import { FirestoreCollection, RefreshStatus, RefreshTrigger } from '@shared/firestore';
import { AV_REFRESH_MANAGER_SCHEDULE, TS_INTRADAY_RTH_CLOSE_1615 } from '../../common/function-schedules';
import { resolveFirestorePath, getRefreshEventDocId } from '../../utils/firestore-utils';
import { createLogger, hr, hrBlank, getMarketClosureInfo, RefreshLogComponent, betterLogger, type BetterLogPayload } from '../../utils/utils';
import { getSymbolTimeSeriesDocPath } from '../../common/firestore/firestore-paths';
import { getSymbolTimeSeriesYearDocPath, getYearFromEpochMillis, getTimeSeriesJobDocPath } from '../../common/firestore/firestore-paths';
import { refreshLogger } from '../../services/refresh-logger.service';
import { enqueueDataReadyInternal } from '../../partner/data-ready.handler';
import type { DataReadyPayloadV1 } from '../../partner/schemas/data-ready.schema';
import { INTERNAL_PUBLISHER_AUDIT_EMAIL, PartnerPhase, PartnerRunType, PartnerRunStatus, PartnerPublishStatus } from '../../partner/constants';
import { HealthMetricsService } from '../../health-metrics/health-metrics.service';
import { TIME_SERIES_BASELINE_ETFS } from '../data/ts-master-order';
import { parseAvEtTimestampMs } from '../../alpha-vantage/utils/date-utils';
import { upsertAvDailyBar } from '../../alpha-vantage/firestore/av-firestore-helper';
import { TradingPhase } from '@shared/health-metrics';
import { runDailyValidation } from '../../partner/daily-validation.service';
import { TimeSeriesJobStatus } from '../jobs/time-series-jobs.model';
import { CloudTask } from '../../common/constants';

// Structured logger (shared)
const log = createLogger('av.refresh');
// Human-readable logger for time-series job scheduler pipeline (abbrev: aVRM)
const tsJobLogger = betterLogger('aVRM');
const healthMetricsService = new HealthMetricsService();

// Use shared time-series helpers from dedicated manager file
import { orderTrackedSymbols } from './av-time-series-refresh-manager';

/**
 * =======================================
 * Time-Series Job Pipeline Feature Flags
 * =======================================
 * These flags are wired for a phased migration to the job-based
 * pipeline described in `docs/time-series-job-pipeline-plan.md`.
 * Initial deployments must preserve existing behavior; all guards
 * should default to the current monolithic scheduler until explicitly
 * enabled.
 */

// When true, DAILY POST schedulers will eventually create/enqueue jobs
// for the job worker. In the initial rollout, legacy behavior remains
// active even when this flag is on; we will gate behavioral changes
// behind additional checks.
const TS_JOB_PIPELINE_ENABLED_DAILY_POST =
  String(process.env.TS_JOB_PIPELINE_ENABLED_DAILY_POST || '').toLowerCase() === 'true';

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
export function computeNextRefreshAtUtc(phase: TradingPhase): string | undefined {
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

      // Check if we need to refresh this symbol (non-time-series endpoints only).
      // Time-series endpoints are already skipped earlier in the loop.
      if (!docSnap.exists) {
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
        // For non-time-series endpoints, always refresh on each scheduled run.
        const metadata = docSnap.data()?.metadata;
        const lastUpdated = metadata?.lastUpdated;
        const lastUpdatedDate = lastUpdated?.toDate ? lastUpdated.toDate() : null;

        log.info('refresh.decision', { 
          endpointId: endpoint, 
          endpointName, 
          symbol, 
          refresh: 'yes', 
          reason: 'non_time_series_always_refresh',
          lastUpdated: lastUpdatedDate?.toISOString()
        });

        needsRefresh = true;
        freshCount++;
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
          ? { symbol, outputsize: 'compact' }
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
          const nowDateMs = Date.now();
          const nextTs = Timestamp.fromDate(new Date(nowDateMs + ttl * 1000));

          const lastUpdatedHr = new Intl.DateTimeFormat('en-US', {
            dateStyle: 'medium',
            timeStyle: 'short',
            timeZone: 'America/Los_Angeles',
          }).format(now.toDate());
          const nextUpdateHr = new Intl.DateTimeFormat('en-US', {
            dateStyle: 'medium',
            timeStyle: 'short',
            timeZone: 'America/Los_Angeles',
          }).format(nextTs.toDate());

          const updateData = {
            data,
            metadata: {
              lastUpdated: now,
              lastUpdatedHr,
              nextUpdate: nextTs,
              nextUpdateHr,
              // Remove legacy field from older schema so metadata is not confusing
              nextRefreshAt: FieldValue.delete(),
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

// Intraday 1-min snapshot at 16:15 ET capturing the 16:00:00 ET RTH close
export const refreshAvIntradayRthClose1615Pre = onSchedule({
  schedule: TS_INTRADAY_RTH_CLOSE_1615,
  timeZone: 'America/New_York',
  secrets: ['ALPHAVANTAGE_API_KEY'],
}, async () => {
  const tz = 'America/New_York';
  const now = new Date();
  const marketDate = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
  const hhmm = new Intl.DateTimeFormat('en-US', { timeZone: tz, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(now).replace(':', '');
  const runId = `${marketDate}-${hhmm}-${PartnerPhase.PRE}`;

  const symbolsSnap = await db.collection(FirestoreCollection.TRACKED_SYMBOLS).get();
  const symbols = symbolsSnap.docs.map(d => d.id);

  let successes = 0;
  let failures = 0;

  for (const symbol of symbols) {
    try {
      const handler: any = AlphaVantageHandlerFactory.createHandler(AlphaVantageEndpoint.TIME_SERIES_INTRADAY);
      const resp = await handler.fetch({ symbol, interval: '1min' });
      const raw = resp?.data;
      const series: Record<string, any> | undefined = raw && (raw['Time Series (1min)'] as any);
      if (!series || typeof series !== 'object') throw new Error('No intraday series (1min)');

      const entries = Object.entries(series) as Array<[string, any]>;
      const etBars = entries.map(([ts, v]) => {
        const msEt = parseAvEtTimestampMs(ts);
        const dateEt = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(msEt));
        const timeEt = new Intl.DateTimeFormat('en-US', { timeZone: tz, hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }).format(new Date(msEt));
        return { ts, msEt, dateEt, timeEt, v };
      }).filter(b => b.dateEt === marketDate);

      const closeBar = etBars.find(b => b.timeEt === '16:00:00');
      if (!closeBar) throw new Error('16:00:00 ET bar not found');

      const o = Number(closeBar.v['1. open'] ?? 0);
      const h = Number(closeBar.v['2. high'] ?? 0);
      const l = Number(closeBar.v['3. low'] ?? 0);
      const c = Number(closeBar.v['4. close'] ?? 0);
      const v = Number(closeBar.v['5. volume'] ?? 0);

      await upsertAvDailyBar({
        symbol,
        date: marketDate,
        patch: { o, h, l, c, v, io: Date.now() },
        skipParentMetaBump: true,
      });

      successes++;
      log.info('pre1615.persist.ok', { symbol, marketDate, o, h, l, c, v });
    } catch (e: any) {
      failures++;
      log.error('pre1615.persist.err', { symbol, marketDate, error: String(e?.message || e) });
    }
  }

  const endRunStatus = failures > 0 ? PartnerRunStatus.COMPLETED_WITH_ERRORS : PartnerRunStatus.COMPLETED;
  await enqueueDataReadyInternal({
    version: 'v1',
    runId,
    phase: PartnerPhase.PRE,
    intervals: [TimeSeriesInterval.DAILY],
    time: Date.now(),
    marketDate,
    env: (process.env.NODE_ENV || 'dev') as string,
    status: PartnerPublishStatus.END,
    runStatus: endRunStatus,
  }, undefined, {
    runType: PartnerRunType.TS_DAILY_PRE,
    successes: String(successes),
    failures: String(failures),
  });

  log.info('pre1615.publish.end', { runId, marketDate, successes, failures });
});

export async function refreshForEndpoints(
  endpoints: AlphaVantageEndpoint[], 
  options: { 
    force?: boolean; 
    phase?: TradingPhase;
    trigger?: RefreshTrigger;
    marketDate?: string; // Optional manual target market date (YYYY-MM-DD)
  } = {}
) {
  // Destructure options early to honor force during market-closure guard
  const { force = false, phase, trigger = RefreshTrigger.SCHEDULER, marketDate: marketDateOverride } = options;
  // Market-closure guard (ET): weekend/holiday; allow override with force=true.
  // In the Functions emulator we deliberately **disable** this guard so that
  // weekend/holiday testing does not require fiddling with the system date.
  const isEmulator = process.env.FUNCTIONS_EMULATOR === 'true';
  const mc2 = getMarketClosureInfo();
  if (!isEmulator && mc2.closed && !force) {
    // Use top-level logger to avoid constructing per-run logger when skipping
    log.info('market.closed_skip', { reason: mc2.reason, etDate: mc2.etDate, component: RefreshLogComponent.RefreshForEndpoints });
    return; // Silent no-op beyond the single structured log
  } else if (!isEmulator && mc2.closed && force) {
    log.info('market.closed_force_continue', { reason: mc2.reason, etDate: mc2.etDate, component: RefreshLogComponent.RefreshForEndpoints });
  }
  const startTime = Date.now();
  const logger = createLogger('av.refresh.scheduled');
  
  // Derive ET market date and DOW once for this invocation (allow override)
  const tz = 'America/New_York';
  let now = new Date();
  let marketDate = '';
  if (typeof marketDateOverride === 'string' && /\d{4}-\d{2}-\d{2}/.test(marketDateOverride)) {
    marketDate = marketDateOverride;
    // Use 12:00 ET on override date to compute DOW consistently
    const dateParts = marketDateOverride.split('-').map((s) => Number(s));
    const [y, m, d] = dateParts as [number, number, number];
    // Construct an ET-local date by formatting from UTC noon then interpreting in ET for DOW
    now = new Date(Date.UTC(y, (m - 1), d, 12, 0, 0));
  } else {
    const fmtDate = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' });
    marketDate = fmtDate.format(now); // YYYY-MM-DD
  }
  const dowIdx = Number(new Date(now.toLocaleString('en-US', { timeZone: tz })).getDay());
  const DOW_ENUM: DayOfWeek[] = [DayOfWeek.Sun, DayOfWeek.Mon, DayOfWeek.Tue, DayOfWeek.Wed, DayOfWeek.Thu, DayOfWeek.Fri, DayOfWeek.Sat];
  const dowEnum: DayOfWeek = DOW_ENUM[dowIdx];
  const dowStr = String(dowEnum).toUpperCase(); // For human-readable runId
  const phaseFinal: TradingPhase = phase ?? TradingPhase.POST;
  const phaseStrUpper = String(phaseFinal).toUpperCase();

  // Optional guard: when AV_REFRESH_TIMESERIES_ONLY is enabled, disable all
  // non-time-series work by filtering endpoints down to the time-series set.
  // This is a temporary, easily reversible switch while we focus on the
  // time-series job pipeline.
  const tsOnlyEnv = String(process.env.AV_REFRESH_TIMESERIES_ONLY || '').toLowerCase();
  const tsOnlyMode = tsOnlyEnv === 'true' || tsOnlyEnv === '1' || tsOnlyEnv === 'on';
  if (tsOnlyMode) {
    const originalEndpoints = endpoints;
    const tsEndpoints = originalEndpoints.filter((e) => isTimeSeriesEndpoint(e));
    if (tsEndpoints.length === 0) {
      logger.info('refresh.skip_non_timeseries_only', {
        endpoints: originalEndpoints,
        phase: phaseFinal,
        marketDate,
        reason: 'AV_REFRESH_TIMESERIES_ONLY',
      });
      return;
    }
    if (tsEndpoints.length !== originalEndpoints.length) {
      logger.info('refresh.filter_non_timeseries', {
        endpointsOriginal: originalEndpoints,
        endpointsFiltered: tsEndpoints,
        phase: phaseFinal,
        marketDate,
      });
    }
    // Narrow the endpoints array for the remainder of this invocation.
    // eslint-disable-next-line no-param-reassign
    endpoints = tsEndpoints;
  }

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
  // Hoist runId so END uses the same ID and reuse computed nextRefreshAtUTC
  let beginRunId: string | null = null;
  let beginStartIso: string | null = null;
  let beginNextRefreshAtUtc: string | undefined;
  try {
    const phasePartner: PartnerPhase = (phaseFinal === TradingPhase.PRE ? PartnerPhase.PRE : PartnerPhase.POST);
    const hhmm = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date()).replace(':', '');
    const isManual = (trigger === RefreshTrigger.MANUAL) || (process.env.FUNCTIONS_EMULATOR === 'true');
    const runId = isManual ? `${marketDate}-${hhmm}-${phasePartner}-manual` : `${marketDate}-${hhmm}-${phasePartner}`;
    beginRunId = runId;
    beginStartIso = new Date().toISOString();
    beginNextRefreshAtUtc = computeNextRefreshAtUtc(phaseFinal);

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
        nextRefreshAtUTC: beginNextRefreshAtUtc,
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
  // Track, per-endpoint, which symbols had POST time-series jobs created/updated in this invocation
  const createdSymbolsThisRun = new Map<AlphaVantageEndpoint, Set<string>>();

  try {
    // Load tracked symbols and types
    const symbolsSnap = await db.collection(FirestoreCollection.TRACKED_SYMBOLS).get();
    const allTracked = symbolsSnap.docs.map(d => d.id);
    symbols = orderTrackedSymbols(allTracked);

    // Emulator convenience: always run baselines plus any extra symbols
    // provided via a comma-separated env var. This lets us tweak the exact
    // symbol list from the terminal without code changes while keeping prod
    // behavior unchanged.
    const isEmulator = process.env.FUNCTIONS_EMULATOR === 'true';
    if (isEmulator) {
      const baselinesInTracked = TIME_SERIES_BASELINE_ETFS.filter((s) => symbols.includes(s));

      const rawExtra = process.env.TS_JOB_EMULATOR_SYMBOLS; // comma-separated symbols
      const extraTargets: string[] = [];
      if (rawExtra && rawExtra.length > 0) {
        for (const token of rawExtra.split(',')) {
          const sym = token.trim().toUpperCase();
          if (!sym) continue;
          if (baselinesInTracked.includes(sym)) continue; // don't duplicate baselines
          if (!extraTargets.includes(sym)) extraTargets.push(sym);
        }
      }

      symbols = [...baselinesInTracked, ...extraTargets];
      logger.info(
        `refresh.symbols.emulator_default count=${symbols.length} symbols=${symbols.join(',')}`,
        {
          count: symbols.length,
          baselines: baselinesInTracked,
          extraTargets,
          rawExtra,
          symbols,
        },
      );
    }
    
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
        logger.warn(`refresh.skipped endpoint=${endpointName} reason=no_config`, { endpoint, endpointName, reason: 'no_config' });
        continue;
      }

      // Log endpoint config lookup for debugging (especially for MONTHLY)
      const configSource = AV_TIME_SERIES_ENDPOINT_CONFIGS[endpointName] ? 'AV_TIME_SERIES_ENDPOINT_CONFIGS' : 'AV_ENDPOINT_CONFIGS';
      logger.info(`refresh.endpoint_config endpoint=${endpointName} source=${configSource}`, { 
        endpoint, 
        endpointName, 
        configSource,
        hasTtl: !!endpointConfig.ttl,
        hasFirestorePath: !!endpointConfig.firestorePath
      });

      // Build a human-readable run id and context for this endpoint using the
      // new dashed format: YYYY-MM-DD-DOW-PHASE-ENDPOINT-LIVE|MANUAL
      const isManualRun = (trigger === RefreshTrigger.MANUAL) || (process.env.FUNCTIONS_EMULATOR === 'true');
      const liveManualSuffix = isManualRun ? 'MANUAL' : 'LIVE';
      const runId = `${marketDate}-${dowStr}-${phaseStrUpper}-${endpoint}-${liveManualSuffix}`;
      const endpointShort = (() => {
        // Shorthand mapping for readability in headers; keep simple and explicit
        if (endpoint === AlphaVantageEndpoint.TIME_SERIES_DAILY_ADJUSTED) return 'TS_DAILY_ADJ';
        if (endpoint === AlphaVantageEndpoint.TIME_SERIES_WEEKLY_ADJUSTED) return 'TS_WEEKLY_ADJ';
        if (endpoint === AlphaVantageEndpoint.TIME_SERIES_MONTHLY_ADJUSTED) return 'TS_MONTHLY_ADJ';
        return String(endpoint).toUpperCase();
      })();
      const run = { id: runId, date: marketDate, dow: dowEnum, phase: phaseFinal, endpointId: endpoint, endpointShort, trigger };
      const intervalForEndpoint: string =
        endpoint === AlphaVantageEndpoint.TIME_SERIES_DAILY_ADJUSTED
          ? TimeSeriesInterval.DAILY
          : endpoint === AlphaVantageEndpoint.TIME_SERIES_WEEKLY_ADJUSTED
            ? TimeSeriesInterval.WEEKLY
            : endpoint === AlphaVantageEndpoint.TIME_SERIES_MONTHLY_ADJUSTED
              ? TimeSeriesInterval.MONTHLY
              : '';

      const isPostTimeSeriesEndpoint =
        endpoint === AlphaVantageEndpoint.TIME_SERIES_DAILY_ADJUSTED ||
        endpoint === AlphaVantageEndpoint.TIME_SERIES_WEEKLY_ADJUSTED ||
        endpoint === AlphaVantageEndpoint.TIME_SERIES_MONTHLY_ADJUSTED;

      // Track a deduped set of symbols for which we created/updated POST time-series jobs
      const createdSymbolsThisEndpoint = new Set<string>();

      for (const symbol of symbols) {
        try {
          const symbolUpper = symbol.toUpperCase();

          // Per-symbol scheduler logs: explicit START marker so we can see when
          // the scheduler begins processing work for this symbol/endpoint.
          try {
            tsJobLogger.start('ts.jobs.scheduler', {
              function: 'rFE',
              symbol: symbolUpper,
              marketDate,
              interval: intervalForEndpoint,
              endpoint: endpointName,
            } as BetterLogPayload);
          } catch {}

          // Job creation for time-series POST runs (job pipeline migration)
          // NOTE: Decoupled from TS_LEGACY_DAILY_POST_ENABLED so that jobs
          // continue to be created even after legacy inline writes are
          // disabled. Legacy handler calls are controlled separately below.
          if (
            TS_JOB_PIPELINE_ENABLED_DAILY_POST &&
            isPostTimeSeriesEndpoint &&
            phaseFinal === TradingPhase.POST
          ) {
            tsJobLogger.info('ts.jobs.create', {
              function: 'rFE',
              symbol: symbolUpper,
              marketDate,
              interval: intervalForEndpoint,
              endpoint: endpointName,
            } as BetterLogPayload);
            let shouldEnqueueTask = false;
            let createdNewJob = false;
            let updatedJob = false;
            try {
              const jobPath = getTimeSeriesJobDocPath(marketDate, symbol, endpoint, phaseFinal);
              const jobRef = db.doc(jobPath);
              const dateRef = db.doc(`${FirestoreCollection.TIME_SERIES_JOBS}/${marketDate}`);
              await db.runTransaction(async (tx) => {
                const snap = await tx.get(jobRef);
                const dateSnap = await tx.get(dateRef);
                const interval =
                  endpoint === AlphaVantageEndpoint.TIME_SERIES_DAILY_ADJUSTED
                    ? TimeSeriesInterval.DAILY
                    : endpoint === AlphaVantageEndpoint.TIME_SERIES_WEEKLY_ADJUSTED
                      ? TimeSeriesInterval.WEEKLY
                      : TimeSeriesInterval.MONTHLY;

                if (!snap.exists) {
                  // Initialize the job document.
                  tx.set(jobRef, {
                    symbol,
                    endpoint,
                    interval,
                    phase: phaseFinal,
                    status: TimeSeriesJobStatus.Pending,
                    attempts: 0,
                    createdAt: Timestamp.now(),
                    updatedAt: Timestamp.now(),
                  });

                  // Initialize or increment the parent date-level aggregator doc
                  // so onTimeSeriesJobTerminal has a document to update.
                  const existingDate = dateSnap.exists ? (dateSnap.data() as any) : {};
                  const currentTotalJobs = typeof existingDate.totalJobs === 'number' ? existingDate.totalJobs : 0;
                  const nextTotalJobs = currentTotalJobs + 1;
                  const phaseStr = String(phaseFinal).toLowerCase();
                  tx.set(dateRef, {
                    marketDate,
                    phase: existingDate.phase || phaseStr,
                    totalJobs: nextTotalJobs,
                    runId: existingDate.runId || runId || null,
                  }, { merge: true });

                  shouldEnqueueTask = true;
                  createdNewJob = true;
                  return;
                }

                const data = snap.data() as any;
                const status: TimeSeriesJobStatus | undefined = data?.status;
                // Do not overwrite terminal states; they indicate that this
                // symbol/date has already been processed for DAILY POST.
                if (
                  status === TimeSeriesJobStatus.Success ||
                  status === TimeSeriesJobStatus.PermanentFailure
                ) {
                  return;
                }

                tx.set(jobRef, {
                  symbol,
                  endpoint,
                  interval,
                  phase: phaseFinal,
                  status: status ?? TimeSeriesJobStatus.Pending,
                  attempts: typeof data?.attempts === 'number' ? data.attempts : 0,
                  updatedAt: Timestamp.now(),
                }, { merge: true });
                shouldEnqueueTask = true;
                updatedJob = true;
              });

              // Enqueue Cloud Task only when the explicit feature flag is
              // enabled. This allows us to turn task-based processing on
              // per-environment without impacting legacy behavior.
              const tasksEnabled = String(process.env.TS_TIME_SERIES_TASKS_ENABLED || '').toLowerCase() === 'true';
              if (shouldEnqueueTask && tasksEnabled) {
                try {
                  const queue = getFunctions().taskQueue(CloudTask.TIME_SERIES_JOB);
                  await queue.enqueue({
                    marketDate,
                    symbol,
                    endpoint,
                    phase: phaseFinal,
                  });
                  tsJobLogger.info('job.enqueue_success', {
                    function: 'rFE',
                    symbol: symbolUpper,
                    marketDate,
                    interval: intervalForEndpoint,
                    endpoint: endpointName,
                  } as BetterLogPayload);
                } catch (e: any) {
                  tsJobLogger.warn('job.enqueue_failed', {
                    function: 'rFE',
                    symbol: symbolUpper,
                    marketDate,
                    interval: intervalForEndpoint,
                    endpoint: endpointName,
                  } as BetterLogPayload);
                }
              }

              // Record that this symbol had a job created/updated for this endpoint in this run
              if (shouldEnqueueTask) {
                createdSymbolsThisEndpoint.add(symbolUpper);
                createdSymbolsThisRun.set(endpoint, createdSymbolsThisEndpoint);

                // Explicit pipeline-stage logs so per-symbol job writes are easy to trace
                if (createdNewJob) {
                  tsJobLogger.info('ts.jobs.write_new', {
                    function: 'rFE',
                    symbol: symbolUpper,
                    marketDate,
                    interval: intervalForEndpoint,
                    endpoint: endpointName,
                  } as BetterLogPayload);
                } else if (updatedJob) {
                  tsJobLogger.info('ts.jobs.write_update', {
                    function: 'rFE',
                    symbol: symbolUpper,
                    marketDate,
                    interval: intervalForEndpoint,
                    endpoint: endpointName,
                  } as BetterLogPayload);
                }
              }
            } catch (e: any) {
              tsJobLogger.warn('job.shadow_create_failed', {
                function: 'rFE',
                symbol: symbolUpper,
                marketDate,
                interval: intervalForEndpoint,
                endpoint: endpointName,
              } as BetterLogPayload);
            }
          }

          // For POST time-series endpoints, rely exclusively on the job
          // pipeline + Cloud Tasks worker to call Alpha Vantage. The
          // scheduler's responsibility is to enqueue one job per
          // {symbol,endpoint,phase}. This avoids per-symbol sleeps and
          // inline AV calls that cannot scale to the full universe within
          // a single function invocation.
          if (isPostTimeSeriesEndpoint && phaseFinal === TradingPhase.POST) {
            continue;
          }

          // RATE LIMITING: Add 1 second delay between AV calls to stay under
          // 75/min limit for non time-series endpoints still handled
          // directly by this function. Time-series POST endpoints now rely
          // on Cloud Tasks rate limits instead.
          const RATE_LIMIT_DELAY_MS = 1000;
          await new Promise(resolve => setTimeout(resolve, RATE_LIMIT_DELAY_MS));

          const handler = AlphaVantageHandlerFactory.createHandler(endpoint);
          const baseParams: any = { 
            symbol, 
            outputsize: OutputSize.COMPACT, 
            __phase: phaseFinal,
            __run: run,
          };
          
          await handler.fetch(baseParams);
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
              const entry: { s: string; at: number } = { s: symbol, at: Date.now() };
              const CAP = 3000;
              await db.runTransaction(async (tx) => {
                const snap = await tx.get(ref);
                const prev = snap.exists ? (snap.data() as any) : {};
                const list: any[] = Array.isArray(prev?.updateLog) ? prev.updateLog : [];
                // If cap already reached, skip write and mark capped for the remainder of this run
                if (Array.isArray(list) && list.length >= CAP) {
                  updateLogCapped = true;
                  logger.info('updateLog.skip_cap', { path: statusDocPath, length: list.length, cap: CAP });
                  return;
                }
                const updated = [...list, entry];
                const capped = updated.length > CAP ? updated.slice(updated.length - CAP) : updated;
                if (capped.length >= CAP) {
                  updateLogCapped = true;
                }
                tx.set(ref, { updateLog: capped, timing: { updatedAt: Timestamp.now(), createdAt: prev?.timing?.createdAt ?? Timestamp.now() } }, { merge: true });
                logger.info('updateLog.appended', { path: statusDocPath, symbol, length: capped.length });
              });
            } catch (e) {
              logger.error('updateLog.error', { error: String((e as any)?.message || e) });
            }
          }

          // On successful symbol processing (no throw), emit END marker for the
          // per-symbol scheduler work. We do this once we're past all symbol-level
          // logic, including optional updateLog writes.
          try {
            tsJobLogger.end('ts.jobs.scheduler', {
              function: 'rFE',
              symbol: symbol.toUpperCase(),
              marketDate,
              interval: intervalForEndpoint,
              endpoint: endpointName,
            } as BetterLogPayload);
          } catch {}

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
          try {
            tsJobLogger.end('ts.jobs.scheduler', {
              function: 'rFE',
              symbol: symbol.toUpperCase(),
              marketDate,
              interval: intervalForEndpoint,
              endpoint: endpointName,
            } as BetterLogPayload);
          } catch {}
        }
      }

      // Near-complete acceleration pass: when only a small number remain, try a short second pass on a tiny subset
      if (endpoint === AlphaVantageEndpoint.TIME_SERIES_DAILY_ADJUSTED && phaseFinal === TradingPhase.POST && Number.isFinite(targetTs)) {
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

      // Per-endpoint run summary log
      if (createdSymbolsThisRun.has(endpoint)) {
        tsJobLogger.info('ts.jobs.run_summary', {
          function: 'rFE',
          symbol: 'MULTI',
          marketDate,
          interval: intervalForEndpoint,
          endpoint: endpointName,
        } as BetterLogPayload);
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

            // finalizedAtUTC and finalization doc are set only when all symbols are finalized
            // AND the dataset passes validation. Validation runs before writing the marker.
            if (pendingCount === 0) {
              let validationPassed = false;
              try {
                let validation = await runDailyValidation(marketDate, Number(targetTs), symbols);
                validationPassed = !!validation?.passed;
                if (!validationPassed) {
                  payload.runStatus = PartnerRunStatus.COMPLETED_WITH_ERRORS;
                  log.warn('daily.validation.failed', { marketDate, failures: validation?.summary?.failures });

                  // Mark status for remediation and store failed sample
                  try {
                    const statusDocPath = `${FirestoreCollection.SYSTEM}/${FirestoreCollection.TIME_SERIES_STATUS}/${FirestoreCollection.DAILY_ADJUSTED}/${marketDate}`;
                    await db.doc(statusDocPath).set({
                      remediation: {
                        needsRemediation: true,
                        failedSymbolsSample: validation?.failures ?? [],
                        updatedAt: Timestamp.now(),
                      }
                    }, { merge: true });
                  } catch {}

                  // Inline remediation: re-fetch DAILY_ADJUSTED for failed symbols using existing handler
                  try {
                    const failedSymbols = Array.isArray(validation?.failures) ? validation.failures.map(f => f.symbol) : [];
                    if (failedSymbols.length > 0) {
                      const handler = AlphaVantageHandlerFactory.createHandler(AlphaVantageEndpoint.TIME_SERIES_DAILY_ADJUSTED);
                      for (const s of failedSymbols) {
                        try {
                          await handler.fetch({ symbol: s, outputsize: 'compact', __checkWriteToggle: false });
                        } catch (e: any) {
                          log.error('remediation.fetch.fail', { symbol: s, error: String(e?.message || e) });
                        }
                      }
                      // Re-run validation after remediation
                      validation = await runDailyValidation(marketDate, Number(targetTs), symbols);
                      validationPassed = !!validation?.passed;
                    }
                  } catch {}

                  // If passed after remediation, proceed to finalize and clear remediation flag
                  if (validationPassed) {
                    log.info('daily.validation.passed_after_remediation', { marketDate, checked: validation?.summary?.checked });
                    try {
                      const statusDocPath = `${FirestoreCollection.SYSTEM}/${FirestoreCollection.TIME_SERIES_STATUS}/${FirestoreCollection.DAILY_ADJUSTED}/${marketDate}`;
                      await db.doc(statusDocPath).set({
                        remediation: {
                          needsRemediation: false,
                          updatedAt: Timestamp.now(),
                        }
                      }, { merge: true });
                    } catch {}
                  }
                } else {
                  log.info('daily.validation.passed', { marketDate, checked: validation?.summary?.checked });
                }

                // If validation now passed (initially or after remediation), compute finalizedAtUTC and write marker
                if (validationPassed) {
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
                      const fzVal = b?.fz != null ? Number(b.fz) : null;
                      if (Number.isFinite(fzVal)) {
                        maxFz = (maxFz == null) ? (fzVal as number) : Math.max(maxFz, fzVal as number);
                      }
                    }
                    if (maxFz != null) {
                      const finalizedIso = new Date(maxFz).toISOString();
                      payload.finalizedAtUTC = finalizedIso;
                      try {
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
          // IMPORTANT: For DAILY POST, publishing is handled exclusively by the finalization onCreate trigger.
          // So skip publishing here when interval=DAILY and phase=POST.
          const isDailyPost = (interval === TimeSeriesInterval.DAILY && phasePartner === PartnerPhase.POST);
          if (!isDailyPost) {
            await enqueueDataReadyInternal(payload, INTERNAL_PUBLISHER_AUDIT_EMAIL, { 
              runType: (interval === TimeSeriesInterval.DAILY && phasePartner === PartnerPhase.PRE) ? PartnerRunType.TS_DAILY_PRE
                : (interval === TimeSeriesInterval.WEEKLY && phasePartner === PartnerPhase.POST) ? PartnerRunType.TS_WEEKLY_POST
                : (interval === TimeSeriesInterval.MONTHLY && phasePartner === PartnerPhase.POST) ? PartnerRunType.TS_MONTHLY_POST
                : PartnerRunType.NON_TIME_SERIES,
              failures: String(failures),
              successes: String(successes)
            });
          }
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

