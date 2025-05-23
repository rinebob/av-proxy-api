import { onRequest } from "firebase-functions/v2/https";
import * as logger from "firebase-functions/logger";

import * as admin from 'firebase-admin';

import {
 setCorsHeaders,
 handleOptionsRequest,
 getAlphavantageApiKey,
 fetchStockData,
 CACHE_DURATION_MS,
 RATE_LIMIT_WINDOW_MS,
 MAX_REQUESTS_PER_WINDOW
} from './utils';

// Initialize Firebase Admin SDK
admin.initializeApp();

const db = admin.firestore();

export const getDailyStockDataRobust = onRequest(async (req, res) => {
  setCorsHeaders(res); // Use helper function

  logger.info('gDSDR robust calling handleOptionsRequest. query: ', req.query);
  if (handleOptionsRequest(req as any, res as any)) {
    return;
  } // Use helper function
  logger.info('gDSDR robust after calling handleOptionsRequest');

  // const clientIdentifier = req.ip;
  // Use a placeholder client identifier for local testing if req.ip is undefined
  const clientIdentifier = process.env.FUNCTIONS_EMULATOR === 'true' ? 'local-emulator-client' : req.ip;

  logger.info('gDSDR robust req.query: ', req.query);
  logger.info('gDSDR robust clientIdentifier: ', clientIdentifier);

  // --- Handle potential undefined clientIdentifier ---
  if (!clientIdentifier) {
      logger.warn('Could not determine client IP for rate limiting.');
      // You might want to return an error or handle this case differently
      // depending on your desired behavior when the IP is unknown.
      // For now, we'll return an error.
      res.status(500).json({ error: 'Could not determine client identifier.' });
      return;
  }
  // --- End handling undefined clientIdentifier ---

  const rateLimitDocRef = db.collection('rate_limits').doc(clientIdentifier);

  logger.info('gDSDR robust rateLimitDocRef: ', rateLimitDocRef);

  try {
    // --- Rate Limiting Check ---
    const rateLimitDoc = await rateLimitDocRef.get();
    const currentTime = Date.now();

    logger.info('gDSDR robust rateLimitDoc: ', rateLimitDoc);
    logger.info('gDSDR robust currentTime: ', currentTime);

    if (rateLimitDoc.exists) {
      const rateLimitData = rateLimitDoc.data();
      // Ensure timestamp exists and is a Firestore Timestamp before calling toDate() // Access using bracket notation
      const timestamp = rateLimitData?.['timestamp'] instanceof admin.firestore.Timestamp ? rateLimitData['timestamp'].toDate().getTime() : undefined;
      const count = rateLimitData?.['count'] || 0;

      logger.info('gDSDR robust dude rateLimitData: ', rateLimitData);
      logger.info('gDSDR robust timestamp/count: ', timestamp, count);

      if (timestamp !== undefined && (currentTime - timestamp) < RATE_LIMIT_WINDOW_MS) {
        if (count >= MAX_REQUESTS_PER_WINDOW) {
          logger.warn('gDSDR Robust - Rate limit exceeded for:', clientIdentifier);
          res.status(429).json({ error: 'Dude - Too Many Requests!!' });
          return;
        } else { // Access using bracket notation
          await rateLimitDocRef.update({ ['count']: admin.firestore.FieldValue.increment(1) });
          logger.warn('gDSDR Robust - Updating Rate limit doc');
        }
      } else {
        logger.warn('gDSDR Robust no timestamp or still in rate limit window');
        // Window expired or timestamp invalid, reset count and timestamp
        await rateLimitDocRef.set({
          count: 1,
          timestamp: admin.firestore.FieldValue.serverTimestamp(),
        });
      }
    } else {
      logger.warn('gDSDR Robust no rate limit doc. creating now ');
      // First request from this client, create document
      await rateLimitDocRef.set({
        count: 1,
        timestamp: admin.firestore.FieldValue.serverTimestamp(),
      });
    }
    // --- End Rate Limiting Check ---


    const symbol = (req.query['symbol'] as string); // Access using bracket notation
    const apiKey = getAlphavantageApiKey();

    if (!apiKey) {
      logger.error('Alphavantage API key is not configured.');
      res.status(500).json({ error: 'Alphavantage API key is not configured.' });
      return; 
    }


    if (!symbol) {
      logger.error('Symbol parameter is missing');
      res.status(400).json({ error: 'symbol parameter is required' });
      return;
    }

    const cacheKey = `daily_${symbol}`; // Generate a unique cache key
    const cacheDocRef = db.collection('api_cache').doc(cacheKey);

    logger.info('gDSDR cache key:', cacheKey);
    logger.info('gDSDR cacheDocRef:', cacheDocRef);

    // --- Cache Checking ---
    const cacheDoc = await cacheDocRef.get();

    if (cacheDoc.exists) {
      const cachedData = cacheDoc.data();
      logger.info('gDSDR cache doc exists. data: ', cachedData);
       // Ensure timestamp exists and is a Firestore Timestamp before calling toDate()
      const timestamp = cachedData?.['timestamp'] instanceof admin.firestore.Timestamp ? cachedData['timestamp'].toDate() : undefined; // Access using bracket notation
      if (timestamp && (Date.now() - timestamp.getTime()) < CACHE_DURATION_MS) {
        logger.info('gDSDR Serving from cache:', cacheKey);
        res.json(cachedData?.['data']); // Return cached data // Access using bracket notation
        return;
      } else {
        logger.info('gDSDR Cache expired or invalid:', cacheKey);
      }
    } else {
      logger.info('gDSDR Cache miss:', cacheKey);
    }
    // --- End Cache Checking ---


    // If not in cache or expired, fetch from Alphavantage using helper
    const apiData = await fetchStockData(symbol, apiKey);
    // Store in cache (using set to create or overwrite)
    logger.info('gDSDR robust fetched data: ', apiData);
    await cacheDocRef.set({
      data: apiData,
      timestamp: admin.firestore.FieldValue.serverTimestamp(),
    });

    logger.info('gDSDR Robust - Fetched from Alphavantage and cached:', cacheKey);
    res.json(apiData); // Return fetched data

  } catch (error: any) {
    // --- Error Handling ---
    // Check if the error is an AxiosError
    if (error?.response?.['status']) { // Use the imported AxiosError type // Access using bracket notation
       logger.error('gDSDR Ruh roh - Error fetching data from Alphavantage:', error.message);
       res.status(error.response?.status || 500).json({ error: `Yikes! Error fetching data from Alphavantage: ${error.message}` });
    } else {
      logger.error('gDSDR Dude - an unexpected error occurred:', error);
      res.status(500).json({ error: 'Doh!! An unexpected error occurred' });
    }
    // --- End Error Handling ---
  }
});