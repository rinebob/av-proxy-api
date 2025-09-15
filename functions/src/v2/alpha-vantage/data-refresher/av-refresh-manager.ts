// =======================================
// DATA MANAGER: Alpha Vantage-Only Refresher
// VERSION: 1.2.0 (auto phase, internal announce, real symbolsUpdatedCount)
// =======================================

import { db } from '../../../firebase-admin-init';
import { Timestamp } from 'firebase-admin/firestore';
import { onSchedule } from 'firebase-functions/v2/scheduler';

import { AlphaVantageHandlerFactory } from '../../alpha-vantage/alpha-vantage-factory';

import { AV_ENDPOINT_CONFIGS, AV_IMPLEMENTED_ENDPOINTS, AV_TIME_SERIES_ENDPOINT_CONFIGS, TimeSeriesInterval } from '@shared/alpha-vantage';
import { ApiProvider } from '@shared/core';
import { FirestoreCollection } from '@shared/firestore';

import { AV_REFRESH_MANAGER_SCHEDULE } from '../../common/function-schedules';

import { formatPST } from '../../utils/utils';
import { resolveFirestorePath, getRefreshEventDocId } from '../../utils/firestore-utils';
import { getSymbolTimeSeriesDocPath } from '../../common/firestore/firestore-paths';
import { refreshLogger } from '../../services/refresh-logger.service';
import { enqueueDataReadyInternal } from '../../partner/data-ready.handler';
import type { DataReadyPayloadV1 } from '../../partner/schemas/data-ready.schema';
import { INTERNAL_PUBLISHER_AUDIT_EMAIL, PartnerPhase } from '../../partner/constants';

// Logging helper
const pr = true;
function logDM(message: string, ...args: any[]) {
  if (pr) console.log(`dM rAVD: ${message}`, ...args);
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
function isTimeSeriesEndpoint(endpoint: string): boolean {
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
export async function runRefreshAlphaVantageDataV2(): Promise<{ durationMs: number; symbolsUpdatedCount: number }> {
  logDM('==============================================');
  logDM('--- Alpha Vantage Data Refresh Cycle Started ---');
  const batchStart = Date.now();

  // Track unique symbols actually updated during this cycle
  const updatedSymbols = new Set<string>();

  // 1. Get all tracked symbols (assume a collection 'tracked-symbols' exists)
  const symbolsSnap = await db.collection(FirestoreCollection.TRACKED_SYMBOLS).get();
  const symbols = symbolsSnap.docs.map(doc => doc.id);
  logDM(`aDM rAVD: Found ${symbols.length} tracked symbols:`, symbols);

  // 2. For each implemented AV endpoint
  for (const endpoint of Array.from(AV_IMPLEMENTED_ENDPOINTS)) {
    // TEMP: Skip historical options until sharded/GCS storage migration is implemented
    // # Reason: Options chains regularly exceed Firestore's 1MB document limit
    // TODO(pubsub-followup): Re-enable HISTORICAL_OPTIONS after migrating to sharded Firestore writes or GCS storage
    if (endpoint === 'HISTORICAL_OPTIONS') {
      logDM(`Skipping endpoint [${endpoint}] temporarily (pending sharded/GCS migration)`);
      continue;
    }
    logDM(`**********************************************************************************`);
    logDM(`**********************************************************************************`);
    logDM(`=========== START ENDPOINT [${endpoint}] ===================================`);

    const endpointConfig = (AV_ENDPOINT_CONFIGS as any)[endpoint] || (AV_TIME_SERIES_ENDPOINT_CONFIGS as any)[endpoint];
    if (!endpointConfig) {
      logDM(`aDM rAVD: No config found for endpoint: ${endpoint}`);
      continue;
    }
    const endpointName = endpointConfig.name;
    const ttl = endpointConfig.ttl;
    logDM(`aDM rAVD: Processing endpoint: ${endpointName} (TTL: ${ttl}s)`);

    // 3. For each symbol
    for (const symbol of symbols) {
      logDM(`**********************************************************************************`);
      logDM(`=========== START SYMBOL [${symbol}] ===================================`);
      // Compute target Firestore docPath
      let docPath: string;
      if (isTimeSeriesEndpoint(endpoint)) {
        // New canonical layout: symbol-data/{symbol}/time-series/{vendor-endpoint}
        docPath = getSymbolTimeSeriesDocPath(symbol, endpoint, ApiProvider.ALPHA_VANTAGE);
      } else {
        if (!endpointConfig.firestorePath) {
          logDM(`Skipping - no firestorePath configured for endpoint: ${endpoint}`);
          continue;
        }
        docPath = resolveFirestorePath({
          firestorePath: endpointConfig.firestorePath,
          symbolUsage: endpointConfig.symbolUsage,
          endpointName: endpoint
        }, symbol);
      }
      logDM(`aDM rAVD: docPath: ${docPath}`);
      const docRef = db.doc(docPath);
      const docSnap = await docRef.get();
      const now = Timestamp.now();
      let needsRefresh = false;

      if (!docSnap.exists) {
        logDM(`aDM rAVD: No data for ${symbol} ${endpointName}, will fetch.`);
        needsRefresh = true;
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
        logDM(`----------- aDM rAVD: START FRESHNESS CHECK FOR [${symbol} ${endpointName}] -------------`);
        const nowDate = new Date();
        const ttl = endpointConfig?.ttl || 0;
        const sinceLastRefreshMs = lastUpdatedDate ? (nowDate.getTime() - lastUpdatedDate.getTime()) : null;
        const untilNextRefreshMs = nextRefreshDate ? (nextRefreshDate.getTime() - nowDate.getTime()) : null;
        // Diagnostic debug logging
        logDM(`[DEBUG] nowDate: ${nowDate.toISOString()} (${nowDate.getTime()} ms)`);
        logDM(`[DEBUG] nextRefreshAt (raw):`, nextRefreshAt, `type: ${typeof nextRefreshAt}`);
        logDM(`[DEBUG] nextRefreshDate: ${nextRefreshDate ? nextRefreshDate.toISOString() : 'N/A'} (${nextRefreshDate ? nextRefreshDate.getTime() : 'N/A'} ms)`);
        logDM(`[DEBUG] nowDate >= nextRefreshDate?`, nextRefreshDate ? nowDate >= nextRefreshDate : 'N/A');
        // Use shared PST formatter from utils
        logDM(`aDM rAVD: [${symbol} ${endpointName}] lastUpdated: ${formatPST(lastUpdatedDate)}, nextRefreshAt: ${formatPST(nextRefreshDate)}, TTL: ${ttl}s`);
        if (sinceLastRefreshMs !== null) {
          logDM(`aDM rAVD: [${symbol} ${endpointName}] Time since last refresh: ${(sinceLastRefreshMs / 1000 / 60).toFixed(2)} min (${sinceLastRefreshMs} ms)`);
        }
        if (untilNextRefreshMs !== null) {
          logDM(`aDM rAVD: [${symbol} ${endpointName}] Time until next refresh: ${(untilNextRefreshMs / 1000 / 60).toFixed(2)} min (${untilNextRefreshMs} ms)`);
        }
        if (!nextRefreshDate || nowDate >= nextRefreshDate) {
          logDM(`aDM rAVD: [${symbol} ${endpointName}] Data is STALE or missing nextRefreshAt. Refresh should occur now.`);
          needsRefresh = true;
        } else {
          logDM(`aDM rAVD: [${symbol} ${endpointName}] Data is FRESH. No refresh needed.`);
        }
        logDM(`----------- aDM rAVD: END FRESHNESS CHECK FOR [${symbol} ${endpointName}] -------------`);
      }

      if (!needsRefresh) continue;

      // 4. Call Alpha Vantage API via handler factory
      const apiStart = Date.now();
      try {
        logDM(`----------- aDM rAVD: START REFRESH FOR ${symbol} ${endpointName} -----------------------`);
        // Use the handler factory for internal backend calls
        const handler = AlphaVantageHandlerFactory.createHandler(endpoint);
        const apiResponse = await handler.fetch({ symbol });
        const durationMs = Date.now() - apiStart;
        logDM(`aDM rAVD: Fetched data for ${symbol} ${endpointName} in ${durationMs}ms.`);
        logDM(`aDM rAVD: apiResponse: ${apiResponse}`);

        // Skip saving if the provider returned an empty payload ({} or [])
        const data = (apiResponse as any)?.data;
        const isEmptyArray = Array.isArray(data) && data.length === 0;
        const isEmptyObject = !Array.isArray(data) && typeof data === 'object' && data !== null && Object.keys(data).length === 0;
        if (isEmptyArray || isEmptyObject) {
          logDM(`aDM rAVD: Skipping save for ${symbol} ${endpointName}: empty provider response`);
          // Log a 'skipped' event to history if possible
          {
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
            logDM(`aDM rAVD: Logged skipped event for ${symbol} ${endpointName} as ${refreshEventId}.`);
          }
          // Do not mark symbol as updated for "skipped"
          continue;
        }

        // 5. Write to Firestore
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
        logDM(`----------- aDM rAVD: START WRITE TO FIRESTORE FOR ${symbol} ${endpointName} -----------------------`);
        await docRef.set(updateData, { merge: true });
        logDM(`aDM rAVD: Saved refreshed data for ${symbol} ${endpointName} to Firestore.`);
        logDM(`----------- aDM rAVD: END WRITE TO FIRESTORE FOR ${symbol} ${endpointName} -----------------------`);

        // If you need to update symbol-level metadata after writing endpoint data:
        if (endpointConfig.symbolUsage && symbol) {
          await refreshLogger.updateSymbolMetadata({
            symbol,
            endpointName,
            now: now.toDate(), // Convert Firestore Timestamp to JS Date
            ttl
          });
          logDM(`aDM rAVD: Updated minimal metadata fields for symbol ${symbol}.`);
        }

        // Mark this symbol as updated for this cycle (unique via Set)
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
        logDM(`aDM rAVD: Logged refresh event for ${symbol} ${endpointName} as ${refreshEventId}.`);
        logDM(`----------- aDM rAVD: END LOG REFRESH EVENT TO HISTORY FOR ${symbol} ${endpointName} -----------------------`);
      } catch (error: any) {
        const durationMs = Date.now() - apiStart;
        logDM(`aDM rAVD: ERROR refreshing ${symbol} ${endpointName}:`, error.message);
        // Log failure event with human-readable doc ID
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
        logDM(`aDM rAVD: Logged failure event for ${symbol} ${endpointName} as ${refreshEventId}.`);
        logDM(`----------- aDM rAVD: END LOG REFRESH EVENT TO HISTORY FOR ${symbol} ${endpointName} -----------------------`);
      }
      logDM(`=========== END SYMBOL [${symbol}] ===================================`);
      logDM(`**********************************************************************************`);
      logDM(`-`);
      logDM(`-`);
    }
    logDM(`=========== END ENDPOINT [${endpoint}] ===================================`);
    logDM(`**********************************************************************************`);
    logDM(`**********************************************************************************`);
    logDM(`-`);
    logDM(`-`);
  }
  logDM(`aDM rAVD: --- Alpha Vantage Data Refresh Cycle Complete. Duration: ${Date.now() - batchStart}ms ---`);
  logDM('==============================================');

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
    logDM(`aDM rAVD: ERROR announcing data-ready:`, error.message);
  }

  return { durationMs: Date.now() - batchStart, symbolsUpdatedCount: updatedSymbols.size };
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
