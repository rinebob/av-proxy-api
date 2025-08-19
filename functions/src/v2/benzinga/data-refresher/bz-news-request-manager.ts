import { onSchedule } from "firebase-functions/v2/scheduler";
import { db } from "../../../firebase-admin-init";
import { Timestamp } from "firebase-admin/firestore";

import { BenzingaHandlerFactory } from "../benzinga-factory";

import { 
    MAX_BENZINGA_NEWS_ARTICLES,
    BENZINGA_NEWS_TTL_DAYS,
    BenzingaNewsRequestConfig,
    BzNewsData,
    SvtBenzingaNewsItem,
    SvtBzNewsRequest
} from "@shared/benzinga";
import { FirestoreCollection } from "@shared/firestore";

import { BZ_NEWS_REFRESH_SCHEDULE } from "../../common/function-schedules";

// Document name for tracking bz news requests
const BZ_NEWS_REQUEST_TRACKING = 'bz-news-request-tracking';

/**
 * Fetches all pages of news from the Benzinga API for a given endpoint configuration.
 *
 * @param {any} handler The Benzinga API handler instance.
 * @param {Record<string, any>} initialApiParams The initial set of parameters for the API request.
 * @param {number} mostRecentArticleId The most recently fetched article ID.
 * @returns {Promise<any[]>} A promise that resolves to an array containing all fetched news articles.
 */
async function fetchAllNewsPages(handler: any, initialApiParams: Record<string, any>, mostRecentArticleId: number): Promise<any[]> {
    let allNewsItems: any[] = [];
    let currentPage = 0;
    const pageSize = initialApiParams.pageSize ?? 100; // Use provided pageSize or default to 100
    const maxPages = 100; // Benzinga has a 100-page limit.  this will freeze the emulators though. Set at 5-10 for testing
    let hasMorePages = true;

    console.log(`bNRM fANP: Starting paginated fetch for endpoint. Page size: ${pageSize}`);

    while (hasMorePages && currentPage < maxPages) { 
        const finalApiParams = { ...initialApiParams, page: currentPage };
        const requestId = `news-refresh-${Date.now()}-${Math.floor(Math.random() * 1000)}`;

        try {
            console.log(`bNRM fANP: Fetching page ${currentPage}...`);
            const apiResponse = await handler.handleRequest(finalApiParams, requestId);
            const newsItems = Array.isArray(apiResponse) ? apiResponse : [];

            if (newsItems.length > 0) {
                // Check if we have encountered an article ID that we have already processed.
                const oldestArticleInBatch = Math.min(...newsItems.map((item) => item.id));
                if (mostRecentArticleId > 0 && oldestArticleInBatch <= mostRecentArticleId) {
                    const newItems = newsItems.filter((item) => item.id > mostRecentArticleId);
                    allNewsItems.push(...newItems);
                    console.log(`bNRM fANP: Found previously fetched article. Halting pagination. Added ${newItems.length} new articles from this page.`);
                    hasMorePages = false; // Stop the loop
                } else {
                    allNewsItems.push(...newsItems);
                }
            } else {
                // No more items are available from the API.
                hasMorePages = false;
            }

            if (hasMorePages) {
                console.log(`bNRM fANP: Fetched ${newsItems.length} items from page ${currentPage}. Total items so far: ${allNewsItems.length}`);
                currentPage++;
            } else if (newsItems.length === 0) {
                console.log(`bNRM fANP: No more items found on page ${currentPage}. Halting pagination.`);
            }
        } catch (error) {
            console.error(`bNRM fANP: Error fetching page ${currentPage}. Aborting pagination.`, { error, finalApiParams });
            hasMorePages = false; // Stop on error to prevent infinite loops
        }
    }

    console.log(`bNRM fANP: Paginated fetch complete. Total items fetched: ${allNewsItems.length}`);
    return allNewsItems;
}

/**
 * Transforms and saves an array of Benzinga news items to Firestore using a batch write.
 *
 * @param {BzNewsData[]} newsItems An array of news items from the Benzinga API.
 * @returns {Promise<number>} A promise that resolves to the total number of articles processed and saved.
 */
async function transformAndSaveNews(newsItems: BzNewsData[]): Promise<number> {
    const batchSize = 450; // Keep well below the 500-operation limit for Firestore batches
    let totalProcessedCount = 0;

    // --- LIMIT NEWS COLLECTION SIZE ---
    const MAX_NEWS_ARTICLES = MAX_BENZINGA_NEWS_ARTICLES;
    
    const newsCollection = db.collection(FirestoreCollection.NEWS);
    const snapshot = await newsCollection.orderBy('createdAt', 'asc').get();
    if (snapshot.size >= MAX_NEWS_ARTICLES) {
        const docsToDelete = snapshot.docs.slice(0, snapshot.size - MAX_NEWS_ARTICLES + newsItems.length);
        if (docsToDelete.length > 0) {
            const batchDelete = db.batch();
            docsToDelete.forEach(doc => batchDelete.delete(doc.ref));
            await batchDelete.commit();
            console.log(`transformAndSaveNews: Deleted ${docsToDelete.length} oldest news articles to enforce max cap.`);
        }
    }

    const ttlDays = BENZINGA_NEWS_TTL_DAYS;
    const ttlTimestamp = Timestamp.fromDate(new Date(Date.now() + ttlDays * 24 * 60 * 60 * 1000));

    for (let i = 0; i < newsItems.length; i += batchSize) {
        const chunk = newsItems.slice(i, i + batchSize);
        const batch = db.batch();
        let chunkProcessedCount = 0;

        chunk.forEach((item) => {
            // The API returns the ID as a number, so we validate for that and convert to string for Firestore.
            if (!item || typeof item.id !== 'number') {
                console.warn('bNRM taSN: Skipping news item with missing or invalid numeric ID.', { item });
                return; // Skip this item
            }

            console.log(`bNRM taSN: Processing news item ${item.id}`);

            const docRef = db.collection(FirestoreCollection.NEWS).doc(item.id.toString());

            // Construct the new object explicitly for clarity and to define a clean Firestore schema.
            const transformedItem: SvtBenzingaNewsItem = {
                id: item.id.toString(),
                author: item.author,
                title: item.title,
                teaser: item.teaser,
                body: item.body,
                url: item.url,
                imageUrls: item.image?.reduce((acc: Record<string, string>, img: { size: string, url: string }) => {
                    if (img.size && img.url) {
                        acc[img.size] = img.url;
                    }
                    return acc;
                }, {}) ?? {},
                createdAt: item.created ? Timestamp.fromDate(new Date(item.created)) : Timestamp.now(),
                updatedAt: item.updated ? Timestamp.fromDate(new Date(item.updated)) : Timestamp.now(),
                savedAt: Timestamp.now(),
                stocks: item.stocks?.map((s: { name: string }) => s.name) ?? [],
                channels: item.channels?.map((c: { name: string }) => c.name) ?? [],
                tags: item.tags?.map((t: { name: string }) => t.name) ?? [],
                ttl: ttlTimestamp, // Add TTL field for Firestore TTL policy
            };
            batch.set(docRef, transformedItem, { merge: true });
            chunkProcessedCount++;
        });

        if (chunkProcessedCount > 0) {
            try {
                await batch.commit();
                console.log(`bNRM taSN: Successfully committed batch of ${chunkProcessedCount} news articles.`);
                totalProcessedCount += chunkProcessedCount;
            } catch (error) {
                console.error(`bNRM taSN: Error committing batch of ${chunkProcessedCount} articles:`, error);
                // Depending on requirements, you might want to stop or continue. For now, we'll log and continue.
            }
        }
    }

    return totalProcessedCount;
}

/**
 * Main function to fetch and persist Benzinga news.
 */
export async function fetchAndPersistBenzingaNews() {
    console.log('==================== START BZ_NEWS ===============================');
    console.log('bNRM faPBN: --- Benzinga News Refresh Cycle Starting ---');
    const endpointId = SvtBzNewsRequest.BZ_NEWS;
    const handler = BenzingaHandlerFactory.createHandler(endpointId);

    const systemInfoRef = db.collection(FirestoreCollection.SYSTEM_INFO).doc(BZ_NEWS_REQUEST_TRACKING);
    const systemInfoDoc = await systemInfoRef.get();
    const systemInfo = systemInfoDoc.data();

    const lastRefreshTimestamp = systemInfo?.lastRefreshTimestamp?.toMillis() || 0;
    const mostRecentArticleId = systemInfo?.mostRecentArticleId ?? 0;

    console.log(`bNRM faPBN: Fetching news updated since ${Math.floor(lastRefreshTimestamp / 1000)}`);

    const apiParams = {
        updated_since: Math.floor(lastRefreshTimestamp / 1000),
    };

    const allNewsItems = await fetchAllNewsPages(handler, apiParams, mostRecentArticleId);

    if (allNewsItems.length === 0) {
        console.log('bNRM faPBN: No new news items to process.');
        return;
    }

    const processedCount = await transformAndSaveNews(allNewsItems);

    // Update the last refresh timestamp and the most recent article ID
    const newMostRecentArticleId = Math.max(...allNewsItems.map((item) => item.id));
    await systemInfoRef.set({
        lastRefreshTimestamp: Timestamp.now(),
        mostRecentArticleId: newMostRecentArticleId,
    }, { merge: true });

    console.log(`bNRM faPBN: Processed and saved ${processedCount} news items.`);
    console.log('bNRM faPBN: Successfully updated news refresh timestamp and most recent article ID.');
    console.log('bNRM faPBN: --- Benzinga News Refresh Cycle Complete ---');
    console.log('==================== END BZ_NEWS ===============================');
}

/**
 * This Cloud Function is responsible for triggering the Benzinga news refresh process on a schedule.
 */
export const requestBenzingaNews = onSchedule(
    {
        schedule: BZ_NEWS_REFRESH_SCHEDULE,
        secrets: ['BENZINGA_WIIM_API_KEY'],
    },
    async () => {
        console.info('bNRM rBN: Benzinga News Request Manager triggered by schedule.');
        try {
            await fetchAndPersistBenzingaNews();
        } catch (error) {
            console.error(`bNRM rBN: An unhandled error occurred in the news refresh scheduler:`, error);
        }
        console.info('bNRM rBN: Benzinga News Request Manager finished.');
    }
);