import { onSchedule } from "firebase-functions/v2/scheduler";
import * as admin from "firebase-admin";
import { BenzingaHandlerFactory } from '../api/benzinga/benzinga-factory';
import { ALL_BENZINGA_ENDPOINT_CONFIGS } from '../api/benzinga/config/bz-endpoint-configs';
import { FirestoreCollection } from '../common/firestore-collections';

// Logging helper
const pr = true;
function logNewsRefresh(message: string, ...args: any[]) {
  if (pr) console.log(`[refreshNewsEndpoints] ${message}`, ...args);
}

// Only include endpoints that are news (future: can add AV or other providers)
const NEWS_ENDPOINTS = Object.entries(ALL_BENZINGA_ENDPOINT_CONFIGS)
  .filter(([name, config]) => config.id === 'news')
  .map(([name]) => name);

export const refreshNewsEndpoints = onSchedule(
  {
    schedule: 'every 1 minutes',
    secrets: ['BENZINGA_WIIM_API_KEY'],
  },
  async () => {
    logNewsRefresh('--- News Endpoint Refresh Cycle Started ---');
    const db = admin.firestore();
    for (const endpointName of NEWS_ENDPOINTS) {
      const endpointConfig = ALL_BENZINGA_ENDPOINT_CONFIGS[endpointName];
      logNewsRefresh(`Refreshing endpoint: ${endpointName}`);
      const handler = BenzingaHandlerFactory.createHandler(endpointName as any);
      const apiParams: Record<string, any> = {};
      for (const paramKey of endpointConfig.parameterKeys || []) {
        if ((endpointConfig as any)[paramKey] !== undefined) {
          apiParams[paramKey] = (endpointConfig as any)[paramKey];
        }
      }
      // Delta polling: read last maxUpdated from Firestore
      // Compute metadata doc path by removing '{newsId}' (if present) and appending '/metadata'
      let metaDocPath = endpointConfig.firestorePath;
      if (!metaDocPath) {
        logNewsRefresh(`No firestorePath defined for endpoint ${endpointName}, skipping metadata update.`);
        continue; // Skip this endpoint
      }
      if (metaDocPath.includes('{newsId}')) {
        metaDocPath = metaDocPath.replace('/{newsId}', '');
      }
      metaDocPath = `${metaDocPath}/${FirestoreCollection.METADATA}`;
      const metaDoc = await db.doc(metaDocPath).get();
      const metaDocData = metaDoc.data();
      let lastMaxUpdated = metaDoc.exists && metaDocData && typeof metaDocData.maxUpdated === 'number'
        ? metaDocData.maxUpdated
        : 0;
      // Subtract 5 seconds for lag
      const laggedTimestamp = lastMaxUpdated > 0 ? lastMaxUpdated - 5 : 0;
      if (laggedTimestamp > 0) {
        apiParams.updatedSince = laggedTimestamp;
        logNewsRefresh(`Using updatedSince=${laggedTimestamp}`);
      }

      const requestId = `news-refresh-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
      const apiResponse = await handler.handleRequest(apiParams, requestId);
      logNewsRefresh('Received API response:', apiResponse);
      if (Array.isArray(apiResponse)) {
        for (const newsItem of apiResponse) {
          const newsId = newsItem.id || newsItem.newsId || newsItem.article_id || newsItem._id;
          if (!newsId) {
            logNewsRefresh('Skipping news item with missing id:', newsItem);
            continue;
          }
          if (!endpointConfig.firestorePath) {
            logNewsRefresh(`No firestorePath defined for endpoint ${endpointName}, skipping news item ${newsId}.`);
            continue;
          }
          const docPath = endpointConfig.firestorePath.replace('{newsId}', newsId);
          await db.doc(docPath).set({
            data: newsItem,
            metadata: {
              endpoint: endpointName,
              newsId,
              lastRefreshedAt: admin.firestore.Timestamp.now(),
              lastRefreshedAtPST: new Date().toLocaleString('en-US', { timeZone: 'America/Los_Angeles' }),
            }
          }, { merge: true });
          logNewsRefresh(`Wrote news doc: ${docPath}`);
        }
      }
      // Update collection-level metadata, including new maxUpdated
      let newMaxUpdated = lastMaxUpdated;
      if (Array.isArray(apiResponse)) {
        for (const newsItem of apiResponse) {
          if (typeof newsItem.updated === 'number' && newsItem.updated > newMaxUpdated) {
            newMaxUpdated = newsItem.updated;
          }
        }
      }
      await db.doc(metaDocPath).set({
        lastFetchedAt: admin.firestore.Timestamp.now(),
        lastFetchedAtPST: new Date().toLocaleString('en-US', { timeZone: 'America/Los_Angeles' }),
        maxUpdated: newMaxUpdated,
      }, { merge: true });
      logNewsRefresh(`Updated news collection metadata: ${metaDocPath}`);
    }
    logNewsRefresh('--- News Endpoint Refresh Cycle Complete ---');
  }
);
