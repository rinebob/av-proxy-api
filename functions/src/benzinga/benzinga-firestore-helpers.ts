import { db } from '../firebase-admin-init';
import { FieldValue } from 'firebase-admin/firestore';
import { BenzingaCalendarParams } from '../common/common-benz';

// Collection names
const CALENDAR_CACHE_COLLECTION = 'benzingaCalendarCache';
const LOGO_CACHE_COLLECTION = 'benzingaLogoCache';
const LOGO_CACHE_DURATION_DAYS = 30;

/**
 * Generate a cache key for the given calendar parameters
 */
function generateCacheKey(params: BenzingaCalendarParams): string {
  const keyParts = [
    params.type,
    ...(params.tickers ? params.tickers.sort() : []),
    params.dateFrom || '',
    params.dateTo || '',
    params.page?.toString() || '',
    params.pageSize?.toString() || '',
    params.updatedSince || ''
  ];
  return keyParts.join('_');
}

/**
 * Get cached calendar data from Firestore if it exists and is not expired
 */
async function getCachedCalendarData(params: BenzingaCalendarParams): Promise<any | null> {
  const cacheKey = generateCacheKey(params);
  const cacheDoc = await db.collection(CALENDAR_CACHE_COLLECTION).doc(cacheKey).get();
  
  if (!cacheDoc.exists) {
    return null;
  }
  
  const cacheData = cacheDoc.data();
  const now = new Date();
  const cacheTime = cacheData?.cachedAt?.toDate();
  
  // Check if cache is expired (default 1 hour)
  if (cacheTime && now.getTime() - cacheTime.getTime() > 60 * 60 * 1000) {
    return null;
  }
  
  return cacheData?.data || null;
}

/**
 * Save calendar data to Firestore cache
 */
async function cacheCalendarData(params: BenzingaCalendarParams, response: any): Promise<void> {
  const cacheKey = generateCacheKey(params);
  const cacheData = {
    data: response,
    cachedAt: FieldValue.serverTimestamp(),
    ...params
  };
  
  await db.collection(CALENDAR_CACHE_COLLECTION).doc(cacheKey).set(cacheData);
}

/**
 * Clear expired cache entries
 */
async function clearExpiredCache(expiryHours: number = 24): Promise<void> {
  try {
    const expiryTime = new Date(Date.now() - expiryHours * 60 * 60 * 1000);
    const snapshot = await db.collection(CALENDAR_CACHE_COLLECTION)
      .where('cachedAt', '<', expiryTime)
      .limit(100)
      .get();

    const batch = db.batch();
    snapshot.docs.forEach(doc => {
      batch.delete(doc.ref);
    });

    if (snapshot.size > 0) {
      await batch.commit();
      console.log(`Cleared ${snapshot.size} expired cache entries`);
    }
  } catch (error) {
    console.error('Error clearing expired cache:', error);
  }
}

/**
 * Retrieves a cached company logo from Firestore if it's valid.
 */
async function getLogoData(ticker: string): Promise<any | null> {
  const cacheDoc = await db.collection(LOGO_CACHE_COLLECTION).doc(ticker).get();

  if (!cacheDoc.exists) {
    return null;
  }

  const cacheData = cacheDoc.data();
  const cacheTime = cacheData?.cachedAt?.toDate();
  const isCacheExpired = (new Date().getTime() - cacheTime.getTime()) > LOGO_CACHE_DURATION_DAYS * 24 * 60 * 60 * 1000;

  if (isCacheExpired) {
    console.log(`[${ticker}] LOGO CACHE EXPIRED`);
    return null;
  }

  return cacheData?.data || null;
}

/**
 * Saves company logo data to the Firestore cache.
 */
async function saveLogoData(ticker: string, data: any): Promise<void> {
  const cachePayload = {
    cachedAt: FieldValue.serverTimestamp(),
    data,
  };

  await db.collection(LOGO_CACHE_COLLECTION).doc(ticker).set(cachePayload);
}

export { getCachedCalendarData, cacheCalendarData, clearExpiredCache, getLogoData, saveLogoData };
