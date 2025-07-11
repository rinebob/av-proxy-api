// =======================================
// DATA MANAGER: Benzinga Data Refresher
// =======================================

import { db } from '../firebase-admin-init';
import { Timestamp } from 'firebase-admin/firestore';
import { onSchedule } from 'firebase-functions/v2/scheduler';
import { ALL_BENZINGA_ENDPOINT_CONFIGS } from '../api/benzinga/config/bz-endpoint-configs';
import { ApiProvider } from '../common/data-providers';
import { FirestoreCollection } from '../common/firestore-collections';
import { BenzingaNewsItem } from '../common/common-benz';
import { BenzingaHandlerFactory } from '../api/benzinga/benzinga-factory';
import type { HandlerKey } from '../api/benzinga/benzinga-factory';


// Logging helper
const pr = true;
function logBZDM(message: string, ...args: any[]) {
  if (pr) console.log(`dM rBZD: ${message}`, ...args);
}

// Helper to resolve the Firestore path for a given endpoint and symbol using config
function resolveFirestorePath(endpointName: string, symbol?: string): string {
  const config = ALL_BENZINGA_ENDPOINT_CONFIGS[endpointName];
  if (!config || !config.firestorePath) {
    throw new Error(`No Firestore path config for endpoint ${endpointName}`);
  }
  // Replace {symbol} if present
  return config.firestorePath.replace('{symbol}', symbol || '');
}

// Helper for refresh history collection
function resolveRefreshHistoryPath(endpointName: string, symbol?: string): string {
  // Use FirestoreCollection.REFRESH_HISTORY for consistency
  return resolveFirestorePath(endpointName, symbol) + `/${FirestoreCollection.REFRESH_HISTORY}`;
}

// Generate a human-readable, sortable, unique Firestore doc ID for a refresh event
function getRefreshEventDocId(
  provider: ApiProvider,
  endpoint: string,
  date: Date,
  symbol?: string
): string {
  const pad = (n: number) => n.toString().padStart(2, '0');
  const YYYY = date.getFullYear();
  const MM = pad(date.getMonth() + 1);
  const DD = pad(date.getDate());
  const HH = pad(date.getHours());
  const mm = pad(date.getMinutes());
  const ss = pad(date.getSeconds());
  const base = `${provider}-${endpoint}-${YYYY}${MM}${DD}-${HH}${mm}${ss}`;
  return symbol ? `${base}-${symbol}` : base;
}

// Main scheduled function for refreshing Benzinga data
export const refreshBenzingaData = onSchedule(
  {
    schedule: 'every 15 minutes',
    secrets: ['BENZINGA_API_KEY'],
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
        const docPath = resolveFirestorePath(endpointName, symbol);
        logBZDM(`rBZD: docPath: ${docPath}`);
        const docRef = db.doc(docPath);
        const docSnap = await docRef.get();
        const now = Timestamp.now();
        let needsRefresh = false;

        if (!docSnap.exists) {
          logBZDM(`rBZD: No data for ${symbol || '(no symbol)'} ${endpointName}, will fetch.`);
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
          if (!nextRefreshDate || now.toDate() >= nextRefreshDate) {
            logBZDM(`rBZD: Data for ${symbol || '(no symbol)'} ${endpointName} is stale or missing nextRefreshAt.`);
            needsRefresh = true;
          } else {
            logBZDM(`rBZD: Data for ${symbol || '(no symbol)'} ${endpointName} is fresh (nextRefreshAt: ${nextRefreshDate})`);
          }
        }

        if (!needsRefresh) continue;

        // 4. Call Benzinga API (pseudo-code, replace with real handler)
        const apiStart = Date.now();
        try {
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

          // 5. Write to Firestore
          const updateData = {
            data: apiResponse,
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
          await docRef.set(updateData, { merge: true });
          logBZDM(`rBZD: Saved refreshed data for ${symbol || '(no symbol)'} ${endpointName} to Firestore.`);

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

          // Save WIIM news item to Firestore
          if (endpointName === 'wiim') {
            const wiimItem = apiResponse as BenzingaNewsItem;
            if (!wiimItem || !wiimItem.id) {
              throw new Error('WIIM news item must have an id field');
            }
            const wiimDocId = wiimItem.id.toString();
            const wiimDocRef = db.doc(`/news/benzinga/wiim/${wiimDocId}`);
            await wiimDocRef.set(wiimItem, { merge: true });
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
        }
      }
    }
    logBZDM(`rBZD: --- Benzinga Data Refresh Cycle Complete. Duration: ${Date.now() - batchStart}ms ---`);
    logBZDM('==============================================');
  }
);
