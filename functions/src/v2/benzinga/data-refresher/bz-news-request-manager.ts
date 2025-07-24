import { logger } from "firebase-functions";
import { onSchedule } from "firebase-functions/v2/scheduler";
import { admin, db } from "../../../firebase-admin-init";
import { BenzingaHandlerFactory } from "../benzinga-factory";
import { BenzingaNewsParameter, SvtBzNewsRequest } from "../../common/common-benz";
import { BZ_NEWS_REFRESH_SCHEDULE } from "../../common/function-schedules";

/**
 * Provides a consistent logging prefix for this manager.
 * @param {string} message The log message.
 * @param {any[]} args Additional arguments to log.
 */
function logNewsRequest(message: string, ...args: any[]) {
    logger.info(`[bNRM] ${message}`, ...args);
}

/**
 * Transforms and saves an array of Benzinga news items to Firestore using a batch write.
 *
 * @param {any[]} newsItems An array of news articles from the Benzinga API response.
 * @returns {Promise<number>} A promise that resolves with the number of items successfully processed.
 */
async function transformAndSaveNews(newsItems: any[]): Promise<number> {
  if (!newsItems || newsItems.length === 0) {
    logNewsRequest("bNRM taSN: No news items to save.");
    return 0;
  }

  const batch = db.batch();
  const newsCollection = db.collection("news");

  for (const item of newsItems) {
    if (!item.id) {
      logNewsRequest("bNRM taSN: Skipping news item with no ID:", item);
      continue;
    }

    console.log("bNRM taSN: Processing news item:", item);

    const docRef = newsCollection.doc(item.id.toString());

    const transformedItem = {
      ...item,
      vendor: "benzinga",
      created: admin.firestore.Timestamp.fromDate(new Date(item.created)),
      stockSymbols: item.stocks?.map((s: { name: string }) => s.name) ?? [],
      channelNames: item.channels?.map((c: { name: string }) => c.name) ?? [],
      tagNames: item.tags?.map((t: { name: string }) => t.name) ?? [],
      stocks: admin.firestore.FieldValue.delete(),
      channels: admin.firestore.FieldValue.delete(),
      tags: admin.firestore.FieldValue.delete(),
    };

    batch.set(docRef, transformedItem, { merge: true });
  }

  try {
    await batch.commit();
    const savedCount = newsItems.length;
    logNewsRequest(`bNRM taSN: Successfully committed batch of ${savedCount} bz news articles.`);
    return savedCount;
  } catch (error) {
    logNewsRequest(`bNRM taSN: Batch write failed:`, error);
    throw error;
  }
}

/**
 * Fetches the latest news from Benzinga, transforms it, and saves it to Firestore.
 */
async function fetchAndPersistBenzingaNews(): Promise<void> {
    logNewsRequest('Starting Benzinga news fetch and persist process...');
    const handler = BenzingaHandlerFactory.createHandler(SvtBzNewsRequest.BZ_NEWS);

    const apiParams = {
        [BenzingaNewsParameter.PAGE_SIZE]: 100,
        [BenzingaNewsParameter.DISPLAY_OUTPUT]: "full",
    };
    const requestId = `news-refresh-${Date.now()}`;
    const apiResponse = await handler.handleRequest(apiParams, requestId);
    const newsArray = Array.isArray(apiResponse) ? apiResponse : apiResponse?.data ?? [];

    if (newsArray.length === 0) {
        logNewsRequest(`bNRM faSN: No news items returned from API. Ending process.`);
        return;
    }

    const savedCount = await transformAndSaveNews(newsArray);

    logNewsRequest(`bNRM faSN: Benzinga news process complete. Saved ${savedCount} articles.`);
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
        logger.info('bNRM faSN: Benzinga News Request Manager triggered by schedule.');
        try {
            await fetchAndPersistBenzingaNews();
        } catch (error) {
            logger.error(`bNRM faSN: An unhandled error occurred in the news refresh scheduler:`, error);
        }
        logger.info('bNRM faSN: Benzinga News Request Manager finished.');
    }
);

// Explicitly export for testing in the shell
module.exports = {
    requestBenzingaNews,
    fetchAndPersistBenzingaNews,
};