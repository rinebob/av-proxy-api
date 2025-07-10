// =======================================
// DATA MANAGER: Alpha Vantage-Only Refresher
// VERSION: 1.1.0 (with human-readable refresh event doc IDs)
// =======================================

import { db } from '../firebase-admin-init';
import { Timestamp } from 'firebase-admin/firestore';
import { onSchedule } from 'firebase-functions/v2/scheduler';
import { AlphaVantageHandlerFactory } from '../api/alpha-vantage/alpha-vantage-factory';
import { AV_ENDPOINT_CONFIGS } from '../api/alpha-vantage/config/av-endpoint-configs';
import { AlphaVantageEndpoint, AV_IMPLEMENTED_ENDPOINTS } from '../common/common-av';
import { ApiProvider, DATA_PROVIDERS } from '../common/data-providers';
import { FirestoreCollection } from '../common/firestore-collections';

// Logging helper
const pr = true;
function logDM(message: string, ...args: any[]) {
  if (pr) console.log(`dM rAVD: ${message}`, ...args);
}

/**
 * Generate a human-readable, sortable, unique Firestore doc ID for a refresh event.
 * Format: {provider}-{endpoint}-{YYYYMMDD}-{HHmmss}[-{symbol}]
 */
function getRefreshEventDocId(
  provider: ApiProvider,
  endpoint: AlphaVantageEndpoint,
  date: Date,
  symbol?: string
): string {
  const providerMeta = DATA_PROVIDERS[provider];
  const pad = (n: number) => n.toString().padStart(2, '0');
  const YYYY = date.getFullYear();
  const MM = pad(date.getMonth() + 1);
  const DD = pad(date.getDate());
  const HH = pad(date.getHours());
  const mm = pad(date.getMinutes());
  const ss = pad(date.getSeconds());
  const base = `${providerMeta.prefix}-${endpoint}-${YYYY}${MM}${DD}-${HH}${mm}${ss}`;
  return symbol ? `${base}-${symbol}` : base;
}

// Helper to resolve the Firestore path for a given endpoint and symbol using config
function resolveFirestorePath(endpointName: AlphaVantageEndpoint, symbol?: string): string {
  const config = AV_ENDPOINT_CONFIGS[endpointName];
  if (!config || !config.firestorePath) {
    throw new Error(`No Firestore path config for endpoint ${endpointName}`);
  }
  return config.firestorePath.replace('{symbol}', symbol || '');
}

// Helper for refresh history collection
function resolveRefreshHistoryPath(endpointName: AlphaVantageEndpoint, symbol?: string): string {
  return resolveFirestorePath(endpointName, symbol) + '/refreshHistory';
}

/**
 * Main scheduled function for refreshing Alpha Vantage data
 * Scans all tracked symbols and endpoints, checks freshness, and refreshes as needed
 */
export const refreshAlphaVantageData = onSchedule('every 15 minutes', async () => {
  logDM('==============================================');
  logDM('--- Alpha Vantage Data Refresh Cycle Started ---');
  const batchStart = Date.now();

  // 1. Get all tracked symbols (assume a collection 'tracked-symbols' exists)
  const symbolsSnap = await db.collection(FirestoreCollection.TRACKED_SYMBOLS).get();
  const symbols = symbolsSnap.docs.map(doc => doc.id);
  logDM(`Found ${symbols.length} tracked symbols:`, symbols);

  // 2. For each implemented AV endpoint
  for (const endpoint of Array.from(AV_IMPLEMENTED_ENDPOINTS)) {
    const endpointConfig = AV_ENDPOINT_CONFIGS[endpoint]; 
    if (!endpointConfig) {
      logDM(`No config found for endpoint: ${endpoint}`);
      continue;
    }
    const endpointName = endpointConfig.name;
    const ttl = endpointConfig.ttl;
    logDM(`Processing endpoint: ${endpointName} (TTL: ${ttl}s)`);

    // 3. For each symbol
    for (const symbol of symbols) {
      const docPath = resolveFirestorePath(endpoint, symbol);
      logDM(`dM rAVD: docPath: ${docPath}`);
      const docRef = db.doc(docPath);
      const docSnap = await docRef.get();
      const now = Timestamp.now();
      let needsRefresh = false;

      if (!docSnap.exists) {
        logDM(`dM rAVD: No data for ${symbol} ${endpointName}, will fetch.`);
        needsRefresh = true;
      } else {
        const metadata = docSnap.data()?.metadata;
        const nextRefreshAt = metadata?.nextRefreshAt;
        let nextRefreshDate;
        if (nextRefreshAt) {
          if (typeof nextRefreshAt.toDate === 'function') {
            nextRefreshDate = nextRefreshAt.toDate();
          } else if (typeof nextRefreshAt === 'number') {
            nextRefreshDate = new Date(nextRefreshAt);
          } else if (typeof nextRefreshAt === 'string') {
            nextRefreshDate = new Date(Number(nextRefreshAt));
          }
        }
        if (!nextRefreshDate || now >= nextRefreshDate) {
          logDM(`dM rAVD: Data for ${symbol} ${endpointName} is stale or missing nextRefreshAt.`);
          needsRefresh = true;
        } else {
          logDM(`dM rAVD: Data for ${symbol} ${endpointName} is fresh (nextRefreshAt: ${nextRefreshDate})`);
        }
      }

      if (!needsRefresh) continue;

      // 4. Call Alpha Vantage API via handler factory
      const apiStart = Date.now();
      try {
        logDM(`dM rAVD: Refreshing ${symbol} ${endpointName} via AlphaVantageHandlerFactory...`);
        // Use the handler factory for internal backend calls
        const handler = AlphaVantageHandlerFactory.createHandler(endpoint);
        const apiResponse = await handler.fetch({ symbol });
        const durationMs = Date.now() - apiStart;
        logDM(`dM rAVD: Fetched data for ${symbol} ${endpointName} in ${durationMs}ms.`);
        logDM(`dM rAVD: apiResponse: ${apiResponse}`);

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
        await docRef.set(updateData, { merge: true });
        logDM(`dM rAVD: Saved refreshed data for ${symbol} ${endpointName} to Firestore.`);

        // 6. Log refresh event to history with human-readable doc ID
        const historyPath = resolveRefreshHistoryPath(endpoint, symbol);
        const nowDate = new Date();
        const refreshEventId = getRefreshEventDocId(ApiProvider.ALPHA_VANTAGE, endpoint, nowDate, symbol);
        await db.collection(historyPath).doc(refreshEventId).set({
          ...updateData.lastRefreshEvent,
          endpoint: endpointName,
          symbol,
          vendor: 'av',
          timestamp: now,
        });
        logDM(`dM rAVD: Logged refresh event for ${symbol} ${endpointName} as ${refreshEventId}.`);
      } catch (error: any) {
        const durationMs = Date.now() - apiStart;
        logDM(`dM rAVD: ERROR refreshing ${symbol} ${endpointName}:`, error.message);
        // Log failure event with human-readable doc ID
        const historyPath = resolveRefreshHistoryPath(endpoint, symbol);
        const nowDate = new Date();
        const refreshEventId = getRefreshEventDocId(ApiProvider.ALPHA_VANTAGE, endpoint, nowDate, symbol);
        await db.collection(historyPath).doc(refreshEventId).set({
          timestamp: now,
          status: 'failure',
          durationMs,
          error: error.message,
          endpoint: endpointName,
          symbol,
          vendor: 'av',
        });
        logDM(`dM rAVD: Logged failure event for ${symbol} ${endpointName} as ${refreshEventId}.`);
      }
    }
  }
  logDM(`dM rAVD: --- Alpha Vantage Data Refresh Cycle Complete. Duration: ${Date.now() - batchStart}ms ---`);
  logDM('==============================================');
});
