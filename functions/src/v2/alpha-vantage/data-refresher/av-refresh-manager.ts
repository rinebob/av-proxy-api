// =======================================
// DATA MANAGER: Alpha Vantage-Only Refresher
// VERSION: 1.2.0 (auto phase, internal announce, real symbolsUpdatedCount)
// =======================================

import { db } from '../../../firebase-admin-init';
import { Timestamp } from 'firebase-admin/firestore';
import { onSchedule } from 'firebase-functions/v2/scheduler';

import { AlphaVantageHandlerFactory } from '../../alpha-vantage/alpha-vantage-factory';

import { AV_ENDPOINT_CONFIGS, AV_IMPLEMENTED_ENDPOINTS, AV_TIME_SERIES_ENDPOINT_CONFIGS, TimeSeriesInterval, AlphaVantageEndpoint } from '@shared/alpha-vantage';
import { ApiProvider } from '@shared/core';
import { FirestoreCollection, RefreshStatus } from '@shared/firestore';

import { AV_REFRESH_MANAGER_SCHEDULE, TS_DAILY_PRE_CLOSE_SCHEDULE, TS_DAILY_POST_CLOSE_SCHEDULE, TS_POST_CLOSE_SCHEDULE } from '../../common/function-schedules';

import { createLogger, hr, hrBlank, formatPST } from '../../utils/utils';
import { resolveFirestorePath, getRefreshEventDocId } from '../../utils/firestore-utils';
import { getSymbolTimeSeriesDocPath } from '../../common/firestore/firestore-paths';
import { refreshLogger } from '../../services/refresh-logger.service';
import { enqueueDataReadyInternal } from '../../partner/data-ready.handler';
import type { DataReadyPayloadV1 } from '../../partner/schemas/data-ready.schema';
import { INTERNAL_PUBLISHER_AUDIT_EMAIL, PartnerPhase } from '../../partner/constants';
import { HealthMetricsService } from '../../health-metrics/health-metrics.service';

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
 * Exported so HTTP wrapper can invoke the same logic as the scheduler.
 */
export async function runRefreshAlphaVantageDataV2(options: { force?: boolean } = {}): Promise<{ durationMs: number; symbolsUpdatedCount: number; symbolsChecked: number; freshCount: number; staleCount: number; force: boolean }> {
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

      if (!docSnap.exists) {
        log.info('freshness.decision', { endpointId: endpoint, endpointName, symbol, exists: false, isFresh: false });
        needsRefresh = true;
        staleCount++;
      } else {
        const metadata = docSnap.data()?.metadata;
        const lastUpdated = metadata?.lastUpdated;
        const nextRefreshAt = metadata?.nextRefreshAt;
        let lastUpdatedDate, nextRefreshDate;
        if (lastUpdated) {
          if (typeof lastUpdated.toDate === 'function') {
            lastUpdatedDate = lastUpdated.toDate();
          } else if (typeof lastUpdated === 'number') {
            lastUpdatedDate = new Date(lastUpdated);
          } else if (typeof lastUpdated === 'string') {
            lastUpdatedDate = new Date(Number(lastUpdated));
          }
        }
        if (nextRefreshAt) {
          if (typeof nextRefreshAt.toDate === 'function') {
            nextRefreshDate = nextRefreshAt.toDate();
          } else if (typeof nextRefreshAt === 'number') {
            nextRefreshDate = new Date(nextRefreshAt);
          } else if (typeof nextRefreshAt === 'string') {
            nextRefreshDate = new Date(Number(nextRefreshAt));
          }
        }
        const nowDate = new Date();
        const sinceLastRefreshMs = lastUpdatedDate ? (nowDate.getTime() - lastUpdatedDate.getTime()) : null;
        const untilNextRefreshMs = nextRefreshDate ? (nextRefreshDate.getTime() - nowDate.getTime()) : null;
        const isFresh = !!nextRefreshDate && nowDate < nextRefreshDate;

        // Structured decision log
        log.info('freshness.decision', {
          endpointId: endpoint,
          endpointName,
          symbol,
          isFresh,
          lastUpdated: lastUpdatedDate ? lastUpdatedDate.toISOString() : null,
          nextRefreshAt: nextRefreshDate ? nextRefreshDate.toISOString() : null,
          ttlSeconds: ttl,
          sinceLastRefreshMs,
          untilNextRefreshMs,
        });

        // Concise human-readable summary
        hr('av.refresh', `[${endpointName}] ${symbol}: last=${formatPST(lastUpdatedDate)} next=${formatPST(nextRefreshDate)} ttl=${ttl}s ${isFresh ? 'FRESH' : 'STALE'}`);

        if (isFresh) freshCount++; else staleCount++;

        if (force || !nextRefreshDate || nowDate >= nextRefreshDate) {
          needsRefresh = true;
        } else {
          eStats.skippedFresh++;
          // If still fresh, no action needed for this symbol
          hr('av.refresh', `skip: fresh (next=${formatPST(nextRefreshDate)})`);
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
          await healthMetricsService.recordSymbolRefresh(endpoint as any, symbol, RefreshStatus.SUCCESS, durationMs);
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
          await healthMetricsService.recordSymbolRefresh(endpoint as any, symbol, RefreshStatus.SUCCESS, durationMs);
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
        await healthMetricsService.recordSymbolRefresh(endpoint as any, symbol, RefreshStatus.FAILURE, durationMs, String(error?.message || error));
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
    const runId = `${marketDate}-${phase}`;

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

    await enqueueDataReadyInternal(payload, INTERNAL_PUBLISHER_AUDIT_EMAIL);
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
    secrets: ['ALPHAVANTAGE_API_KEY'],
  },
  async () => {
    await runRefreshAlphaVantageDataV2();
  }
);

// ===============================
// Option A: Explicit scheduled wrappers by cadence
// ===============================

async function refreshForEndpoints(endpoints: AlphaVantageEndpoint[], options: { force?: boolean } = {}) {
  // Load tracked symbols and types
  const symbolsSnap = await db.collection(FirestoreCollection.TRACKED_SYMBOLS).get();
  const symbols = symbolsSnap.docs.map(d => d.id);
  const symbolTypes = new Map<string, string>();
  for (const d of symbolsSnap.docs) {
    const t = (d.data() as any)?.type as string | undefined;
    if (t) symbolTypes.set(d.id, t);
  }

  for (const endpoint of endpoints) {
    const endpointConfig = (AV_ENDPOINT_CONFIGS as any)[endpoint] || (AV_TIME_SERIES_ENDPOINT_CONFIGS as any)[endpoint];
    if (!endpointConfig) continue;
    const endpointName = endpointConfig.name;

    for (const symbol of symbols) {
      // Skip OVERVIEW for non-company symbols (parity with main refresher)
      if (endpoint === AlphaVantageEndpoint.OVERVIEW) {
        const rawType = symbolTypes.get(symbol) || '';
        const type = rawType.toLowerCase();
        const isEquity = type.includes('equity') || type.includes('stock') || type.includes('common');
        if (type && !isEquity) continue;
      }

      // Compute doc path for time-series endpoints (top-level metadata doc)
      const docPath = getSymbolTimeSeriesDocPath(symbol, endpoint, ApiProvider.ALPHA_VANTAGE);
      const docRef = db.doc(docPath);
      const docSnap = await docRef.get();
      let needsRefresh = false;

      if (!docSnap.exists) {
        needsRefresh = true;
      } else {
        const metadata = docSnap.data()?.metadata;
        const nextRefreshAt = metadata?.nextRefreshAt;
        let nextRefreshDate: Date | null = null;
        if (nextRefreshAt) {
          if (typeof nextRefreshAt.toDate === 'function') nextRefreshDate = nextRefreshAt.toDate();
          else if (typeof nextRefreshAt === 'number') nextRefreshDate = new Date(nextRefreshAt);
          else if (typeof nextRefreshAt === 'string') nextRefreshDate = new Date(Number(nextRefreshAt));
        }
        const nowDate = new Date();
        needsRefresh = options.force || !nextRefreshDate || nowDate >= nextRefreshDate;
      }

      if (!needsRefresh) continue;

      try {
        const handler = AlphaVantageHandlerFactory.createHandler(endpoint as any);
        await handler.fetch({ symbol, outputsize: 'compact', __checkWriteToggle: false });
        // Handlers perform sharded writes and set nextRefreshAt based on TTL
      } catch (error) {
        // swallow per-symbol errors here; main refresher has richer history writes
        console.error('OptionA refresh error', endpointName, symbol, String((error as any)?.message || error));
      }
    }
  }
}

// Daily time series: pre-close (daily only)
export const refreshAvDailyTimeSeriesPreClose = onSchedule({
  schedule: TS_DAILY_PRE_CLOSE_SCHEDULE,
  secrets: ['ALPHAVANTAGE_API_KEY'],
}, async () => {
  await refreshForEndpoints([AlphaVantageEndpoint.TIME_SERIES_DAILY_ADJUSTED]);
});

// Daily time series: post-close (daily only)
export const refreshAvDailyTimeSeriesPostClose = onSchedule({
  schedule: TS_DAILY_POST_CLOSE_SCHEDULE,
  secrets: ['ALPHAVANTAGE_API_KEY'],
}, async () => {
  await refreshForEndpoints([AlphaVantageEndpoint.TIME_SERIES_DAILY_ADJUSTED]);
});

// Weekly + Monthly time series: post-close every trading day
export const refreshAvWeeklyMonthlyTimeSeriesPostClose = onSchedule({
  schedule: TS_POST_CLOSE_SCHEDULE,
  secrets: ['ALPHAVANTAGE_API_KEY'],
}, async () => {
  await refreshForEndpoints([
    AlphaVantageEndpoint.TIME_SERIES_WEEKLY_ADJUSTED,
    AlphaVantageEndpoint.TIME_SERIES_MONTHLY_ADJUSTED,
  ]);
});
