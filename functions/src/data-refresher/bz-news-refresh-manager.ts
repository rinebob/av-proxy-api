import { onSchedule } from "firebase-functions/v2/scheduler";
import * as admin from 'firebase-admin';

import { BenzingaHandlerFactory } from '../api/benzinga/benzinga-factory';
import { BZ_NEWS_REQUEST_CONFIGS } from '../api/benzinga/request-configs/bz-news-request-configs';
import { BenzingaNewsParameter, BenzingaNewsRequestConfig, BenzingaRequestId, SvtBzNewsRequest } from '../common/common-benz';
import { RequestConfig } from '../api/common/types';

import { FirestoreCollection } from '../common/firestore-collections';

const BZ_NEWS_REQUEST_CONFIG: BenzingaNewsRequestConfig = BZ_NEWS_REQUEST_CONFIGS[SvtBzNewsRequest.BZ_NEWS] as BenzingaNewsRequestConfig;

// Logging helper
const pr = true;
function logNewsRefresh(message: string, ...args: any[]) {
    if (pr) console.log(`[rNE] ${message}`, ...args);
}

function initializeApiParams(endpointConfig: BenzingaNewsRequestConfig, channel: string, lastMaxUpdated: Date | null): Record<string, any> {
    const apiParams: Record<string, any> = {};

    // Set channel parameter
    if (channel) {
        apiParams[BenzingaNewsParameter.CHANNELS] = channel;
    }

    // TODO: Temporarily removing updatedSince parameter as it's causing issues with the API
    // if (lastMaxUpdated) {
    //     apiParams[BenzingaNewsParameter.UPDATED_SINCE] = Math.floor(lastMaxUpdated.getTime() / 1000);
    // }

    // Add default parameters from config
    if (endpointConfig.parameters) {
        console.log('nRM iAP endpointConfig.parameters:', endpointConfig.parameters);
        Object.entries(endpointConfig.parameters).forEach(([key, paramConfig]) => {
            if (paramConfig.default !== undefined) {
                apiParams[key] = paramConfig.default;
            }
        });
    }

    // Remove any parameters with empty values
    Object.keys(apiParams).forEach(key => {
        const value = apiParams[key];
        if (!value || (typeof value === 'string' && value.trim() === '') || 
            (Array.isArray(value) && value.length === 0)) {
            delete apiParams[key];
        }
    });

    
    // Remove updatedSince parameter as it's causing 401 errors
    if (BenzingaNewsParameter.UPDATED_SINCE in apiParams) {
        delete apiParams[BenzingaNewsParameter.UPDATED_SINCE];
        logNewsRefresh(`Removed ${BenzingaNewsParameter.UPDATED_SINCE} parameter to prevent 401 errors`);
    }

    console.log('nRM iAP final apiParams:', apiParams);
    return apiParams;
}

function getMetadataDocPath(endpointConfig: RequestConfig<BenzingaRequestId>, channel: string, endpointName: string): string {
    let metaDocPath = endpointConfig.firestorePath;

    if (!metaDocPath) {
        logNewsRefresh(`No firestorePath defined for endpoint ${endpointName}, skipping metadata update.`);
        return ''; // Or throw an error, depending on desired behavior
    }

    if (metaDocPath.includes('{newsId}')) {
        metaDocPath = metaDocPath.replace('/{newsId}', '');
    }

    if (metaDocPath.includes('{channel}')) {
        metaDocPath = metaDocPath.replace('{channel}', channel);
    }

    return `${metaDocPath}/${FirestoreCollection.METADATA}`; 
}

async function fetchNewsFromApi(handler: any, apiParams: Record<string, any>, requestId: string, endpointName: string, lastMaxUpdated: number): Promise<{ apiResponse: any, durationMs: number }> {
    const apiStart = Date.now();
    logNewsRefresh(`----------- nRM: START API CALL FOR [${endpointName}] -------------`);
    logNewsRefresh(`nRM: Refreshing news for endpoint ${endpointName} via Benzinga API...`);
    const apiResponse = await handler.handleRequest(apiParams, requestId);
    const durationMs = Date.now() - apiStart;
    logNewsRefresh(`nRM: Fetched news for ${endpointName} in ${durationMs}ms.`);
    if (apiResponse && apiResponse.data && apiResponse.data.length > 0) {
        logNewsRefresh(`nRM: Logging channels for all ${apiResponse.data.length} news items:`);
        apiResponse.data.forEach((newsItem: any, index: number) => {
            if (newsItem.channels && Array.isArray(newsItem.channels)) {
                const channelNames = newsItem.channels.map((c: any) => c.name).join(', ');
                logNewsRefresh(`  Item ${index + 1} channels: [${channelNames}]`);
            } else {
                logNewsRefresh(`  Item ${index + 1} channels: ${JSON.stringify(newsItem.channels)}`);
            } 
        });
    }
    logNewsRefresh('nRM: Full apiResponse (truncated):', JSON.stringify(apiResponse, null, 2).substring(0, 500) + '...');
    logNewsRefresh(`----------- nRM: END API CALL FOR [${endpointName}] -------------`);
    return { apiResponse, durationMs };
}

async function getMetadataAndLastUpdated(db: admin.firestore.Firestore, endpointConfig: RequestConfig<BenzingaRequestId>, channel: string, endpointName: string): Promise<{ lastMaxUpdated: number, metaDocData: FirebaseFirestore.DocumentData | undefined, metaDocPath: string }> {
    const metaDocPath = getMetadataDocPath(endpointConfig, channel, endpointName);
    const metaDoc = await db.doc(metaDocPath).get();
    const metaDocData = metaDoc.data();

    let lastMaxUpdated = metaDoc.exists && metaDocData && typeof metaDocData.maxUpdated === 'number'
        ? metaDocData.maxUpdated
        : 0;

    if (metaDoc.exists) {
        logNewsRefresh(`Metadata object loaded:`, metaDocData);
    } else {
        logNewsRefresh(`Metadata doc does not exist at path: ${metaDocPath}`);
    }

    return { lastMaxUpdated, metaDocData, metaDocPath };
}

async function fetchAndProcessNews(
    handler: any,
    endpointConfig: BenzingaNewsRequestConfig,
    channel: string,
    lastMaxUpdated: number,
    endpointName: string
): Promise<{
    newsArray: any[];
    durationMs: number;
    apiResponse: any;
}> {
    const apiParams = initializeApiParams(endpointConfig, channel, lastMaxUpdated ? new Date(lastMaxUpdated) : null);

    const requestId = `news-refresh-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
    const { apiResponse, durationMs } = await fetchNewsFromApi(handler, apiParams, requestId, endpointName, lastMaxUpdated);

    const newsArray = Array.isArray(apiResponse)
        ? apiResponse
        : (Array.isArray(apiResponse?.data) ? apiResponse.data : []);

    logNewsRefresh('[SHIM] newsArray:', newsArray);

    return { newsArray, durationMs, apiResponse };
}

async function processNewsItems(
    db: admin.firestore.Firestore,
    newsArray: any[],
    endpointConfig: RequestConfig<BenzingaRequestId>,
    endpointName: string,
    channel: string,
    metaDocPath: string,
    now: admin.firestore.Timestamp,
    lastMaxUpdated: number,
    apiResponse: any
) {
    if (newsArray.length > 0) {
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
            // Get channel-specific metadata
            const channelMetaDocPath = metaDocPath.replace('{channel}', channel);
            const channelMetaDoc = await db.doc(channelMetaDocPath).get();
            const channelMetaDocData = channelMetaDoc.data();
            // Only write if newsId > highestNewsId in channel-specific metadata
            const highestNewsId = channelMetaDocData?.highestNewsId ?? 0;
            const newsChannels = newsItem.channels ? newsItem.channels.map((c: any) => c.name).join(', ') : 'N/A';
            // Replace {channel} and {newsId} in path with actual values
            const docPath = endpointConfig.firestorePath
                .replace('{channel}', channel)
                .replace('{newsId}', customDocId);
            const collectionName = channel;

            if (typeof newsId === 'number' && newsId <= highestNewsId) {
                logNewsRefresh(`Skipping newsId ${newsId} (docId: ${customDocId}) because it is not higher than highestNewsId (${highestNewsId}) for channel ${channel}. Channels: [${newsChannels}], Collection: [${collectionName}]`);
                continue;
            }
            // Transform channels to an array of strings (names) for easier storage and querying
            let processedChannels = newsItem.channels;
            if (Array.isArray(newsItem.channels)) {
                processedChannels = newsItem.channels.map((c: any) => c.name).filter(Boolean);
            }

            try {
                logNewsRefresh(`nRM: Writing news doc to Firestore: ${docPath}. Channels: [${newsChannels}], Collection: [${collectionName}]`);
                await db.doc(docPath).set({
                    ...newsItem,
                    channels: processedChannels, // Override the original channels with the processed ones
                    lastRefreshedAt: now,
                }, { merge: true });
            } catch (err) {
                logNewsRefresh(`nRM: Failed to write news doc: ${docPath}`, err);
            }
        }
    } else {
        logNewsRefresh('No news items to write for endpoint:', endpointName + (Array.isArray(apiResponse) ? '' : ' (checked apiResponse.data)'));
    }
}

async function updateChannelMetadata(db: admin.firestore.Firestore, channelMetaDocPath: string, now: admin.firestore.Timestamp, newMaxUpdated: number, newsCount: number, durationMs: number, lastNewsId: string | number | null, nextRefreshAt: admin.firestore.Timestamp, channel: string) {
    const metaDocUpdate: Record<string, any> = {
        lastFetchedAt: now,
        maxUpdated: newMaxUpdated,
        newsCount: newsCount,
        durationMs,
        error: null,
        status: 'success',
        timestamp: now,
        nextRefreshAt,
        channel: channel // Add channel to metadata
    };
    if (lastNewsId !== null) {
        metaDocUpdate.highestNewsId = lastNewsId;
    }
    // Ensure 'channels' field is not present in channel-specific metadata
    if (metaDocUpdate.channels) {
        delete metaDocUpdate.channels;
    }
    await db.doc(channelMetaDocPath).set(metaDocUpdate, { merge: true });
    logNewsRefresh(`Updated news collection metadata for channel ${channel}: ${channelMetaDocPath}`);
}

async function updateRootMetadata(db: admin.firestore.Firestore, rootMetaDocPath: string, now: admin.firestore.Timestamp, channel: string, lastNewsId: string | number | null, newMaxUpdated: number, newsCount: number) {
    const rootMetaUpdate: Record<string, any> = {
        lastFetchedAt: now,
        timestamp: now,
        channels: {
            [channel]: {
                lastFetchedAt: now,
                highestNewsId: lastNewsId,
                maxUpdated: newMaxUpdated,
                newsCount: newsCount
            }
        }
    };
    await db.doc(rootMetaDocPath).set(rootMetaUpdate, { merge: true });
    logNewsRefresh(`Updated root news metadata with channel ${channel} info: ${rootMetaDocPath}`);
}

async function addRefreshHistory(db: admin.firestore.Firestore, channelMetaDocPath: string, rootMetaDocPath: string, eventTimestamp: admin.firestore.Timestamp, durationMs: number, newsCount: number, lastNewsId: string | number | null, newMaxUpdated: number, channel: string) {
    const channelRefreshHistoryRef = db.collection(`${channelMetaDocPath}/${FirestoreCollection.REFRESH_HISTORY}`);
    const rootRefreshHistoryRef = db.collection(`${rootMetaDocPath}/${FirestoreCollection.REFRESH_HISTORY}`);
    const pad = (n: number) => n.toString().padStart(2, '0');
    const laDate = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/Los_Angeles' }));
    const docId = `${laDate.getFullYear()}-${pad(laDate.getMonth() + 1)}-${pad(laDate.getDate())}_` +
        `${pad(laDate.getHours())}-${pad(laDate.getMinutes())}-${pad(laDate.getSeconds())}`;

    await channelRefreshHistoryRef.doc(docId).set({
        timestamp: eventTimestamp,
        durationMs,
        newsCount,
        highestNewsId: lastNewsId ?? undefined,
        maxUpdated: newMaxUpdated,
        status: 'success',
        error: null,
        channel: channel
    });

    await rootRefreshHistoryRef.doc(docId).set({
        timestamp: eventTimestamp,
        durationMs,
        newsCount,
        highestNewsId: lastNewsId ?? undefined,
        maxUpdated: newMaxUpdated,
        status: 'success',
        error: null,
        channel: channel
    });

    logNewsRefresh(`Appended refresh history event to ${channelMetaDocPath}/${FirestoreCollection.REFRESH_HISTORY} as ${docId}`);
}

async function handleFirestoreUpdates(db: admin.firestore.Firestore, newsArray: any[], endpointConfig: RequestConfig<BenzingaRequestId>, endpointName: string, channel: string, metaDocPath: string, now: admin.firestore.Timestamp, lastMaxUpdated: number, apiResponse: any, durationMs: number, ttlMs: number) {
    logNewsRefresh(`----------- nRM: START FIRESTORE WRITE ------------------`);

    await processNewsItems(db, newsArray, endpointConfig, endpointName, channel, metaDocPath, now, lastMaxUpdated, apiResponse);

    let newMaxUpdated = lastMaxUpdated;
    let lastNewsId: string | number | null = null;
    for (const newsItem of newsArray) {
        const updatedTimestamp = new Date(newsItem.updated).getTime();
        if (updatedTimestamp > newMaxUpdated) {
            newMaxUpdated = updatedTimestamp;
        }
        const candidateId = newsItem.id || newsItem.newsId || newsItem.article_id || newsItem._id;
        if (candidateId !== undefined && candidateId !== null) {
            if (lastNewsId === null || candidateId > lastNewsId) {
                lastNewsId = candidateId;
            }
        }
    }
    const nextRefreshAt = admin.firestore.Timestamp.fromDate(new Date(Date.now() + ttlMs));
    const channelMetaDocPath = metaDocPath.replace('{channel}', channel);
    logNewsRefresh(`nRM: Updating channel metadata at path: ${channelMetaDocPath}`);
    await updateChannelMetadata(db, channelMetaDocPath, now, newMaxUpdated, newsArray.length, durationMs, lastNewsId, nextRefreshAt, channel);

    const rootMetaDocPath = metaDocPath.replace('{channel}', 'root');
    logNewsRefresh(`nRM: Updating root metadata at path: ${rootMetaDocPath}`);
    await updateRootMetadata(db, rootMetaDocPath, now, channel, lastNewsId, newMaxUpdated, newsArray.length);

    const eventTimestamp = admin.firestore.Timestamp.now();
    await addRefreshHistory(db, channelMetaDocPath, rootMetaDocPath, eventTimestamp, durationMs, newsArray.length, lastNewsId, newMaxUpdated, channel);

    const nextUpdateAt = admin.firestore.Timestamp.fromDate(new Date(Date.now() + ttlMs));
    await db.doc(`${FirestoreCollection.NEWS}/${FirestoreCollection.BENZINGA}`).set({
        lastUpdatedAt: now,
        lastUpdatedByChannel: channel,
        nextUpdateAt,
        nextUpdateByChannel: channel,
    }, { merge: true });
    logNewsRefresh('Updated root news/benzinga metadata doc');

    logNewsRefresh(`----------- nRM: END FIRESTORE WRITE ------------------`);
}

async function updateFirestoreMetadata(db: admin.firestore.Firestore, newsArray: any[], endpointConfig: RequestConfig<BenzingaRequestId>, endpointName: string, channel: string, metaDocPath: string, now: admin.firestore.Timestamp, lastMaxUpdated: number, apiResponse: any, durationMs: number, ttlMs: number) {
    await handleFirestoreUpdates(db, newsArray, endpointConfig, endpointName, channel, metaDocPath, now, lastMaxUpdated, apiResponse, durationMs, ttlMs);
}

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
        const newsEndpointConfig = BZ_NEWS_REQUEST_CONFIG;
        if (!newsEndpointConfig || typeof newsEndpointConfig.ttl !== 'number') {
            throw new Error('Benzinga News endpoint config must have a numeric ttl');
        }
        const ttlMs = newsEndpointConfig.ttl * 1000;

        // Only refresh the BZ_NEWS endpoint for now, as BZ_NEWS_REQUEST_CONFIG is a single config.
        // If other news endpoints are added, this loop will need to be re-evaluated to fetch
        // configs from ALL_BENZINGA_REQUEST_CONFIGS based on endpointKey.
        const endpointConfig = BZ_NEWS_REQUEST_CONFIG;

        const endpointId = endpointConfig.id as SvtBzNewsRequest;
        logNewsRefresh(`----------- nRM: START [${endpointId}] REFRESH -------------`);
        const handler = BenzingaHandlerFactory.createHandler(endpointId as any);

        // Get all channels from the endpoint config (guaranteed to be an array)
        const channels = endpointConfig.channels as string[];

        for (const channel of channels) {
            logNewsRefresh(`----------- nRM: START [${endpointId}] REFRESH for channel [${channel}] -------------`);
            const { metaDocPath, lastMaxUpdated } = await getMetadataAndLastUpdated(db, endpointConfig, channel, endpointId);
            const { newsArray, apiResponse, durationMs } = await fetchAndProcessNews(handler, endpointConfig as BenzingaNewsRequestConfig, channel, lastMaxUpdated, endpointId);
            await updateFirestoreMetadata(db, newsArray, endpointConfig, endpointId, channel, metaDocPath, now, lastMaxUpdated, apiResponse, durationMs, ttlMs);
            logNewsRefresh(`----------- nRM: END [${endpointId}] REFRESH for channel [${channel}] -------------`);
            logNewsRefresh('');
        }
        logNewsRefresh('--- News Endpoint Refresh Cycle Complete ---');
        logNewsRefresh('============== END NEWS REFRESH ============================');
        logNewsRefresh('');
        logNewsRefresh('');
    }
);
