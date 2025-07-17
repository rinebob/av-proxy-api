// =======================================
// DATA MANAGER: Alpha Vantage-Only Refresher
// VERSION: 1.1.0 (with human-readable refresh event doc IDs)
// =======================================

import { db } from '../../../firebase-admin-init';
import { Timestamp } from 'firebase-admin/firestore';
import { onSchedule } from 'firebase-functions/v2/scheduler';
import { AlphaVantageHandlerFactory } from '../../alpha-vantage/alpha-vantage-factory';
import { AV_ENDPOINT_CONFIGS } from '../../alpha-vantage/config/av-endpoint-configs';
import { AV_IMPLEMENTED_ENDPOINTS } from '../../common/common-av';
import { ApiProvider } from '../../common/data-providers';
import { FirestoreCollection } from '../../common/firestore-collections';
import { formatPST } from '../../../utils/utils';
import { resolveFirestorePath, resolveRefreshHistoryPath, getRefreshEventDocId } from '../../utils/firestore-utils';
import { AV_REFRESH_MANAGER_SCHEDULE } from '../../common/function-schedules';

// Logging helper
const pr = true;
function logDM(message: string, ...args: any[]) {
  if (pr) console.log(`dM rAVD: ${message}`, ...args);
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
    logDM('==============================================');
    logDM('--- Alpha Vantage Data Refresh Cycle Started ---');
    const batchStart = Date.now();

    // 1. Get all tracked symbols (assume a collection 'tracked-symbols' exists)
    const symbolsSnap = await db.collection(FirestoreCollection.TRACKED_SYMBOLS).get();
    const symbols = symbolsSnap.docs.map(doc => doc.id);
    logDM(`aDM rAVD: Found ${symbols.length} tracked symbols:`, symbols);

    // 2. For each implemented AV endpoint
    for (const endpoint of Array.from(AV_IMPLEMENTED_ENDPOINTS)) {
      logDM(`**********************************************************************************`);
      logDM(`**********************************************************************************`);
      logDM(`=========== START ENDPOINT [${endpoint}] ===================================`);
      
      const endpointConfig = AV_ENDPOINT_CONFIGS[endpoint]; 
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
        if (!endpointConfig.firestorePath) {
          logDM(`Skipping - no firestorePath configured for endpoint: ${endpoint}`);
          continue;
        }
        const docPath = resolveFirestorePath({
          firestorePath: endpointConfig.firestorePath,
          symbolUsage: endpointConfig.symbolUsage,
          endpointName: endpoint
        }, symbol);
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

          // 5. Write to Firestore
          const updateData = {
            data: apiResponse.data,
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

          // 6. Log refresh event to history with human-readable doc ID
          if (!endpointConfig.firestorePath) {
            logDM(`Skipping history logging - no firestorePath for endpoint: ${endpoint}`);
            continue;
          }
          const historyPath = resolveRefreshHistoryPath({
            firestorePath: endpointConfig.firestorePath,
            symbolUsage: endpointConfig.symbolUsage,
            endpointName: endpoint
          }, symbol);
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
          if (!endpointConfig.firestorePath) {
            logDM(`Skipping history logging - no firestorePath for endpoint: ${endpoint}`);
            continue;
          }
          const historyPath = resolveRefreshHistoryPath({
            firestorePath: endpointConfig.firestorePath,
            symbolUsage: endpointConfig.symbolUsage,
            endpointName: endpoint
          }, symbol);
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
  }
);
