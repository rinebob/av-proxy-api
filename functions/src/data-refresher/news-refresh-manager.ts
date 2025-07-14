import { onSchedule } from "firebase-functions/v2/scheduler";
import { BzNewsChannel } from '../api/benzinga/config/bz-news-channels';
import * as admin from 'firebase-admin';
import { BenzingaHandlerFactory } from '../api/benzinga/benzinga-factory';
import { FirestoreCollection } from '../common/firestore-collections';
import { SvtBzNewsRequest } from '../common/common-benz';

// Logging helper
const pr = true;
function logNewsRefresh(message: string, ...args: any[]) {
  if (pr) console.log(`[refreshNewsEndpoints] ${message}`, ...args);
}

// Canonical list of Benzinga news endpoint names (from config)
import { BZ_NEWS_ENDPOINTS } from '../api/benzinga/config/bz-endpoint-configs';
const BZ_NEWS_ENDPOINT_NAMES = Object.keys(BZ_NEWS_ENDPOINTS);

export const refreshNewsEndpoints = onSchedule(
  {
    schedule: 'every 1 minutes',
    secrets: ['BENZINGA_WIIM_API_KEY'],
  },
  async () => {
    logNewsRefresh('============== START NEWS REFRESH ============================');
    logNewsRefresh('--- News Endpoint Refresh Cycle Started ---');
    const db = admin.firestore();
    // Declare once for the whole refresh cycle
    const now = admin.firestore.Timestamp.now();
    // Use Benzinga News endpoint's TTL from canonical config
    const newsEndpointConfig = BZ_NEWS_ENDPOINTS[SvtBzNewsRequest.BZ_NEWS];
    if (!newsEndpointConfig || typeof newsEndpointConfig.ttl !== 'number') {
      throw new Error('Benzinga News endpoint config must have a numeric ttl');
    }
    const ttlMs = newsEndpointConfig.ttl * 1000;

    for (const endpointName of BZ_NEWS_ENDPOINT_NAMES as SvtBzNewsRequest[]) {
      logNewsRefresh(`----------- nRM: START [${endpointName}] REFRESH -------------`);
      const endpointConfig = BZ_NEWS_ENDPOINTS[endpointName as SvtBzNewsRequest];
      const handler = BenzingaHandlerFactory.createHandler(endpointName as any);
      const configPageSize = endpointConfig.parameters?.pageSize?.default ?? 100;
      const apiParams: Record<string, any> = { pageSize: configPageSize };
      for (const paramKey of endpointConfig.parameterKeys || []) {
        if ((endpointConfig as any)[paramKey] !== undefined) {
          apiParams[paramKey] = (endpointConfig as any)[paramKey];
        }
      }
      // Delta polling: read last maxUpdated from Firestore
      // Compute metadata doc path by removing '{newsId}' (if present) and appending '/metadata'
      // Replace {channel} with actual channel name in metaDocPath
      let metaDocPath = endpointConfig.firestorePath;
      // Extract channel from apiParams.channels or default to WIIM
      let channel = BzNewsChannel.WIIM;
      if (apiParams.channels && apiParams.channels.length > 0) {
        const candidate = apiParams.channels[0];
        if (Object.values(BzNewsChannel).includes(candidate as BzNewsChannel)) {
          channel = candidate as BzNewsChannel;
        }
      }

      if (!metaDocPath) {
        logNewsRefresh(`No firestorePath defined for endpoint ${endpointName}, skipping metadata update.`);
        continue; // Skip this endpoint
      }
      if (metaDocPath.includes('{newsId}')) {
        metaDocPath = metaDocPath.replace('/{newsId}', '');
      }
      if (metaDocPath.includes('{channel}')) {
        metaDocPath = metaDocPath.replace('{channel}', channel);
      }
      metaDocPath = `${metaDocPath}/${FirestoreCollection.METADATA}`;
      const metaDoc = await db.doc(metaDocPath).get();
      const metaDocData = metaDoc.data();
      if (metaDoc.exists) {
        logNewsRefresh(`Metadata object loaded:`, metaDocData);
      } else {
        logNewsRefresh(`Metadata doc does not exist at path: ${metaDocPath}`);
      }
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
      const apiStart = Date.now();
      logNewsRefresh(`----------- nRM: START API CALL FOR [${endpointName}] -------------`);
      logNewsRefresh(`nRM: Refreshing news for endpoint ${endpointName} via Benzinga API...`);
      const apiResponse = await handler.handleRequest(apiParams, requestId);
      const durationMs = Date.now() - apiStart;
      logNewsRefresh(`nRM: Fetched news for ${endpointName} in ${durationMs}ms.`);
      logNewsRefresh('nRM: apiResponse:', apiResponse);
      logNewsRefresh(`----------- nRM: END API CALL FOR [${endpointName}] -------------`);
      const newsArray = Array.isArray(apiResponse)
        ? apiResponse
        : (Array.isArray(apiResponse?.data) ? apiResponse.data : []);
      logNewsRefresh('[SHIM] newsArray:', newsArray);
      if (newsArray.length > 0) {
        // SHIM: Pick a random newsId from the WIIM news and fetch by ID
        const randomIdx = Math.floor(Math.random() * newsArray.length);
        const randomNewsItem = newsArray[randomIdx];
        const randomNewsId = randomNewsItem?.id || randomNewsItem?.newsId || randomNewsItem?.article_id || randomNewsItem?._id;
        logNewsRefresh('[SHIM] randomNewsID/Item:', randomNewsId, randomNewsItem);
        if (randomNewsId) {
          try {
            logNewsRefresh(`----------- nRM: START API CALL FOR NEWS_BY_ID [${randomNewsId}] -------------`);
            const newsByIdHandler = BenzingaHandlerFactory.createHandler(SvtBzNewsRequest.BZ_NEWS_BY_ID);
            const byIdResponse = await newsByIdHandler.handleRequest({ newsId: randomNewsId }, `news-by-id-shim-${Date.now()}`);
            logNewsRefresh(`nRM: NEWS_BY_ID response for newsId ${randomNewsId}:`, byIdResponse);
            logNewsRefresh(`----------- nRM: END API CALL FOR NEWS_BY_ID [${randomNewsId}] -------------`);
          } catch (err) {
            logNewsRefresh(`[SHIM] Failed to fetch Benzinga NEWS_BY_ID for newsId ${randomNewsId}:`, err);
          }
        }
        logNewsRefresh(`----------- nRM: START FIRESTORE WRITE ------------------`);
        // Use Pacific time string as for refresh-history docId
        const laDate = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/Los_Angeles' }));
        const pad = (n: number) => n.toString().padStart(2, '0');
        const baseTimeStr = `${laDate.getFullYear()}-${pad(laDate.getMonth() + 1)}-${pad(laDate.getDate())}_` +
          `${pad(laDate.getHours())}-${pad(laDate.getMinutes())}-${pad(laDate.getSeconds())}`;
        for (const newsItem of newsArray) {
          const newsId = newsItem.id || newsItem.newsId || newsItem.article_id || newsItem._id;
          if (!newsId) {
            logNewsRefresh('Skipping news item with missing id:', newsItem);
            continue;
          }
          if (!endpointConfig.firestorePath) {
            logNewsRefresh(`No firestorePath defined for endpoint ${endpointName}, skipping news item ${newsId}.`);
            continue;
          }
          // Build stock-names string
          let stockNames = '';
          if (Array.isArray(newsItem.stocks)) {
            const names = newsItem.stocks.map((s: any) => s?.name).filter(Boolean);
            if (names.length > 0) {
              stockNames = names.join('-');
            }
          }
          let customDocId = `${baseTimeStr}_${newsId}`;
          if (stockNames) {
            customDocId += `_${stockNames}`;
          }
          // Only write if newsId > highestNewsId in metadata
          const highestNewsId = metaDocData?.highestNewsId ?? 0;
          if (typeof newsId === 'number' && newsId <= highestNewsId) {
            logNewsRefresh(`Skipping newsId ${newsId} (docId: ${customDocId}) because it is not higher than highestNewsId (${highestNewsId})`);
            continue;
          }
          // Replace {channel} and {newsId} in path with actual values
          const channel = (typeof apiParams.channels === 'string' ? apiParams.channels : Array.isArray(apiParams.channels) ? apiParams.channels[0] : BzNewsChannel.WIIM);
          const docPath = endpointConfig.firestorePath
            .replace('{channel}', channel)
            .replace('{newsId}', customDocId);
          try {
            logNewsRefresh(`nRM: Writing news doc to Firestore: ${docPath}`);
            await db.doc(docPath).set({
              ...newsItem,
              lastRefreshedAt: now,
            }, { merge: true });
            logNewsRefresh(`nRM: Successfully wrote news doc: ${docPath}`);
          } catch (err) {
            logNewsRefresh(`nRM: Failed to write news doc: ${docPath}`, err);
          }
        }
      } else {
        logNewsRefresh('No news items to write for endpoint:', endpointName + (Array.isArray(apiResponse) ? '' : ' (checked apiResponse.data)'));
      }
      // Update collection-level metadata, including new maxUpdated
      let newMaxUpdated = lastMaxUpdated;
      let lastNewsId: string | number | null = null;
      for (const newsItem of newsArray) {
        if (typeof newsItem.updated === 'number' && newsItem.updated > newMaxUpdated) {
          newMaxUpdated = newsItem.updated;
        }
        const candidateId = newsItem.id || newsItem.newsId || newsItem.article_id || newsItem._id;
        if (candidateId !== undefined && candidateId !== null) {
          if (lastNewsId === null || candidateId > lastNewsId) {
            lastNewsId = candidateId;
          }
        }
      }
      const nextRefreshAt = admin.firestore.Timestamp.fromDate(new Date(Date.now() + ttlMs));
      const metaDocUpdate: Record<string, any> = {
        lastFetchedAt: now,
        maxUpdated: newMaxUpdated,
        newsCount: newsArray.length,
        durationMs,
        error: null,
        status: 'success',
        timestamp: now,
        nextRefreshAt,
      };
      if (lastNewsId !== null) {
        metaDocUpdate.highestNewsId = lastNewsId;
      }
      await db.doc(metaDocPath).set(metaDocUpdate, { merge: true });
      logNewsRefresh(`Updated news collection metadata: ${metaDocPath}`);

      // Add refresh history event under metadata doc
      const refreshHistoryRef = db.collection(`${metaDocPath}/${FirestoreCollection.REFRESH_HISTORY}`);
      // Use UTC-7 (America/Los_Angeles) for docId
      const eventTimestamp = admin.firestore.Timestamp.now();
      const pad = (n: number) => n.toString().padStart(2, '0');
      const laDate = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/Los_Angeles' }));
      const docId = `${laDate.getFullYear()}-${pad(laDate.getMonth() + 1)}-${pad(laDate.getDate())}_` +
        `${pad(laDate.getHours())}-${pad(laDate.getMinutes())}-${pad(laDate.getSeconds())}`;
      await refreshHistoryRef.doc(docId).set({
        timestamp: eventTimestamp,
        durationMs,
        newsCount: newsArray.length,
        highestNewsId: lastNewsId ?? undefined,
        maxUpdated: newMaxUpdated,
        status: 'success',
        error: null,
      });
      logNewsRefresh(`Appended refresh history event to ${metaDocPath}/${FirestoreCollection.REFRESH_HISTORY} as ${docId}`);

      // Write root news/benzinga metadata doc
      // 'channel' already assigned above for Firestore path; reuse here
      const nextUpdateAt = admin.firestore.Timestamp.fromDate(new Date(Date.now() + ttlMs)); // Next update based on endpoint TTL
      await db.doc(`${FirestoreCollection.NEWS}/${FirestoreCollection.BENZINGA}`).set({
        lastUpdatedAt: now,
        lastUpdatedByChannel: channel,
        nextUpdateAt,
        nextUpdateByChannel: channel,
      }, { merge: true });
      logNewsRefresh('Updated root news/benzinga metadata doc');
      logNewsRefresh(`----------- nRM: END FIRESTORE WRITE ------------------`);
      logNewsRefresh(`----------- nRM: END [${endpointName}] REFRESH -------------`);
    }
    logNewsRefresh('--- News Endpoint Refresh Cycle Complete ---');
    logNewsRefresh('============== END NEWS REFRESH ============================');
    logNewsRefresh('-');
    logNewsRefresh('-');
  }
);
