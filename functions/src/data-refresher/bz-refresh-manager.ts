// =======================================
// DATA MANAGER: Benzinga Data Refresher
// =======================================

import { db } from '../firebase-admin-init';
import { Timestamp } from 'firebase-admin/firestore';
import { onSchedule } from 'firebase-functions/v2/scheduler';
import { ALL_BENZINGA_ENDPOINT_CONFIGS } from '../api/benzinga/config/bz-endpoint-configs';
import { ApiProvider } from '../common/data-providers';
import { FirestoreCollection } from '../common/firestore-collections';

import { BenzingaHandlerFactory } from '../api/benzinga/benzinga-factory';
import type { HandlerKey } from '../api/benzinga/benzinga-factory';


// Logging helper
const pr = true;
function logBZDM(message: string, ...args: any[]) {
  if (pr) console.log(`dM rBZD: ${message}`, ...args);
}

// Shared Firestore utility functions
import { resolveFirestorePath, resolveRefreshHistoryPath, getRefreshEventDocId } from './firestore-utils';

// Main scheduled function for refreshing Benzinga data
export const refreshBenzingaData = onSchedule(
  {
    schedule: 'every 5 minutes',
    secrets: ['BENZINGA_CALENDAR_API_KEY'],
  },
  async () => {
    logBZDM('==============================================');
    logBZDM('--- Benzinga Data Refresh Cycle Started ---');
    const batchStart = Date.now();

    // 1. Get all tracked symbols (assume a collection 'tracked-symbols' exists)
    const symbolsSnap = await db.collection(FirestoreCollection.TRACKED_SYMBOLS).get();
    const symbols = symbolsSnap.docs.map(doc => doc.id);
    logBZDM(`rBZD: Found ${symbols.length} tracked symbols:`, symbols);

    // 2. For each implemented Benzinga endpoint
    for (const [endpointName, endpointConfig] of Object.entries(ALL_BENZINGA_ENDPOINT_CONFIGS)) {
      logBZDM(`**********************************************************************************`);
      logBZDM(`**********************************************************************************`);
      logBZDM(`=========== START ENDPOINT [${endpointName}] ===================================`);
      if (!endpointConfig) {
        logBZDM(`rBZD: No config found for endpoint: ${endpointName}`);
        continue;
      }
      
      const ttl = endpointConfig.ttl;
      logBZDM(`rBZD: Processing endpoint: ${endpointName} (TTL: ${ttl}s)`);

      // 3. For each symbol (if required)
      const requiresSymbol = endpointConfig.requiresSymbol;
      const targets = requiresSymbol ? symbols : [undefined];

      for (const symbol of targets) {
        logBZDM(`**********************************************************************************`);
        logBZDM(`=========== START SYMBOL [${symbol} ${endpointName}] ===================================`);
        logBZDM(`----------- bRM rBD: START FRESHNESS CHECK FOR [${symbol} ${endpointName}] -------------`);
        const docPath = resolveFirestorePath(endpointName, symbol);
        logBZDM(`bRM rBD: docPath: ${docPath}`);
        const docRef = db.doc(docPath);
        const docSnap = await docRef.get();
        const now = Timestamp.now();
        let needsRefresh = false;

        if (!docSnap.exists) {
          logBZDM(`bRM rBD: No data for ${symbol || '(no symbol)'} ${endpointName}, will fetch.`);
          needsRefresh = true;
        } else {
          const metadata = docSnap.data()?.metadata;
          const nextRefreshAt = metadata?.nextRefreshAt;
          let nextRefreshDate;
          if (nextRefreshAt) {
            if (nextRefreshAt.toDate) {
              nextRefreshDate = nextRefreshAt.toDate();
            } else if (typeof nextRefreshAt === 'string' || typeof nextRefreshAt === 'number') {
              nextRefreshDate = new Date(Number(nextRefreshAt));
            }
          }
          // Diagnostic debug logging
          const nowDate = new Date();
          logBZDM(`bRM rBD: [DEBUG] nowDate: ${nowDate.toISOString()} (${nowDate.getTime()} ms)`);
          logBZDM(`bRM rBD: [DEBUG] nextRefreshAt (raw):`, nextRefreshAt, `type: ${typeof nextRefreshAt}`);
          logBZDM(`bRM rBD: [DEBUG] nextRefreshDate: ${nextRefreshDate ? nextRefreshDate.toISOString() : 'N/A'} (${nextRefreshDate ? nextRefreshDate.getTime() : 'N/A'} ms)`);
          logBZDM(`bRM rBD: [DEBUG] nowDate >= nextRefreshDate?`, nextRefreshDate ? nowDate >= nextRefreshDate : 'N/A');
          if (!nextRefreshDate || now.toDate() >= nextRefreshDate) {
            logBZDM(`bRM rBD: Data for ${symbol || '(no symbol)'} ${endpointName} is stale or missing nextRefreshAt.`);
            needsRefresh = true;
          } else {
            logBZDM(`bRM rBD: Data for ${symbol || '(no symbol)'} ${endpointName} is fresh (nextRefreshAt: ${nextRefreshDate})`);
          }
          logBZDM(`----------- bRM rBD: END FRESHNESS CHECK FOR [${symbol} ${endpointName}] -------------`);
        }

        if (!needsRefresh) continue;

        // 4. Call Benzinga API (pseudo-code, replace with real handler)
        const apiStart = Date.now();
        try {
          logBZDM(`----------- bRM rBD: START API CALL FOR [${symbol} ${endpointName}] -------------`);
          logBZDM(`rBZD: Refreshing ${symbol || '(no symbol)'} ${endpointName} via Benzinga API...`);

          // Use BenzingaHandlerFactory to create and call the handler
          if (!BenzingaHandlerFactory.hasHandler(endpointName as HandlerKey)) {
            throw new Error(`No handler implemented for endpoint: ${endpointName}`);
          }
          const handler = BenzingaHandlerFactory.createHandler(endpointName as HandlerKey);

          // Build params from config and symbol
          const apiParams: Record<string, any> = {};
          for (const paramKey of endpointConfig.parameterKeys || []) {
            if (paramKey === 'symbols' || paramKey === 'parameters[tickers]') {
              if (symbol) apiParams[paramKey] = symbol;
            } else if ((endpointConfig as any)[paramKey] !== undefined) {
              apiParams[paramKey] = (endpointConfig as any)[paramKey];
            }
            // Add more param handling as needed
          }

          const requestId = `bzdm-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
          const apiResponse = await handler.handleRequest(apiParams, requestId);
          const durationMs = Date.now() - apiStart;
          logBZDM(`rBZD: Fetched data for ${symbol || '(no symbol)'} ${endpointName} in ${durationMs}ms.`);
          logBZDM(`----------- bRM rBD: END API CALL FOR [${symbol} ${endpointName}] -------------`);

          // 5. Write to Firestore
          // If this is a market-data endpoint (requiresSymbol === false) and no data is returned, still write a metadata doc
          let dataToSave = apiResponse;
          if (
            endpointConfig.id !== 'news' &&
            dataToSave &&
            typeof dataToSave === 'object' &&
            'data' in dataToSave &&
            Object.keys(dataToSave).length === 1 // Only a single 'data' property
          ) {
            dataToSave = dataToSave.data;
          }
          if (!requiresSymbol && (apiResponse == null || (Array.isArray(apiResponse) && apiResponse.length === 0) || (typeof apiResponse === 'object' && Object.keys(apiResponse).length === 0))) {
            logBZDM(`rBZD: No data returned for market-data endpoint ${endpointName}; writing metadata doc only.`);
            dataToSave = null;
          }
          const updateData = {
            data: dataToSave,
            metadata: {
              endpoint: endpointName,
              symbol,
              nextRefreshAt: new Date(Date.now() + ttl * 1000),
              lastRefreshedAt: now,
            },
            lastRefreshEvent: {
              timestamp: now,
              status: 'success',
              durationMs,
              error: null,
            },
          };
          logBZDM(`----------- bRM rBD: START WRITE TO FIRESTORE FOR [${symbol} ${endpointName}] -------------`);
          await docRef.set(updateData, { merge: true });
          logBZDM(`rBZD: Saved refreshed data for ${symbol || '(no symbol)'} ${endpointName} to Firestore.`);
          logBZDM(`----------- bRM rBD: END WRITE TO FIRESTORE FOR [${symbol} ${endpointName}] -------------`);

          // 6. Log refresh event to history with human-readable doc ID
          const historyPath = resolveRefreshHistoryPath(endpointName, symbol);
          const nowDate = new Date();
          const refreshEventId = getRefreshEventDocId(ApiProvider.BENZINGA, endpointName, nowDate, symbol);
          await db.collection(historyPath).doc(refreshEventId).set({
            ...updateData.lastRefreshEvent,
            endpoint: endpointName,
            symbol,
            vendor: ApiProvider.BENZINGA,
            timestamp: now,
          });
          logBZDM(`rBZD: Logged refresh event for ${symbol || '(no symbol)'} ${endpointName} as ${refreshEventId}.`);
          logBZDM(`----------- bRM rBD: END LOG REFRESH EVENT TO HISTORY FOR [${symbol} ${endpointName}] -------------`);

          // If this endpoint returns an array of news items, write each as its own document
          if (Array.isArray(apiResponse) && endpointConfig.id === 'news') {
            for (const newsItem of apiResponse) {
              if (!newsItem.id) {
                logBZDM('Skipping news item with missing id:', newsItem);
                continue;
              }
              const newsId = newsItem.id.toString();
              const newsDocPath = resolveFirestorePath(endpointName, undefined, newsId);
              await db.doc(newsDocPath).set(newsItem, { merge: true });
              logBZDM(`Saved news item ${newsId} for endpoint ${endpointName} to Firestore.`);
            }
          }
        } catch (error: any) {
          const durationMs = Date.now() - apiStart;
          logBZDM(`rBZD: ERROR refreshing ${symbol || '(no symbol)'} ${endpointName}:`, error.message);
          // Log failure event
          const historyPath = resolveRefreshHistoryPath(endpointName, symbol);
          const nowDate = new Date();
          const refreshEventId = getRefreshEventDocId(ApiProvider.BENZINGA, endpointName, nowDate, symbol);
          await db.collection(historyPath).doc(refreshEventId).set({
            timestamp: now,
            status: 'failure',
            durationMs,
            error: error.message,
            endpoint: endpointName,
            symbol,
            vendor: ApiProvider.BENZINGA,
          });
          logBZDM(`rBZD: Logged failure event for ${symbol || '(no symbol)'} ${endpointName} as ${refreshEventId}.`);
          logBZDM(`----------- bRM rBD: END REFRESH FOR ${symbol} ${endpointName} -----------------------`);
        }
        logBZDM(`=========== END SYMBOL [${symbol}] ===================================`);
        logBZDM(`**********************************************************************************`);
        logBZDM(`-`);
        logBZDM(`-`);
      }
      logBZDM(`**********************************************************************************`);
      logBZDM(`**********************************************************************************`);
      logBZDM(`=========== END ENDPOINT [${endpointName}] ===================================`);
      logBZDM(`-`);
      logBZDM(`-`);
    }
    logBZDM(`rBZD: --- Benzinga Data Refresh Cycle Complete. Duration: ${Date.now() - batchStart}ms ---`);
    logBZDM('==============================================');
  }
);
