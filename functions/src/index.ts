import { onRequest } from "firebase-functions/v2/https";
import * as logger from "firebase-functions/logger";

import axios from 'axios';
import * as dotenv from 'dotenv';
import { defineString } from "firebase-functions/params";
import * as admin from 'firebase-admin';

// Initialize Firebase Admin SDK
admin.initializeApp();
const db = admin.firestore();

// Load environment variables from .env during local development
// This will not run in the deployed Firebase Function environment
if (process.env['NODE_ENV'] !== 'production') {
  dotenv.config(); // Access using bracket notation
}

// Define the configuration key for Firebase Environment Configuration
const alphavantageKey = defineString('ALPHAVANTAGE_KEY');

// Function to get the Alphavantage API key, handling both local and deployed environments
function getAlphavantageApiKey(): string | undefined {
  // In the deployed environment, use Firebase Environment Configuration
  if (process.env['K_SERVICE']) { // K_SERVICE is an environment variable set in Cloud Run/Functions
    return alphavantageKey.value(); // Access using bracket notation
  } else {
    // In the local development environment, use process.env
    return process.env['ALPHAVANTAGE_API_KEY']; // Access using bracket notation
  }
}


const ALPHAVANTAGE_BASE_URL = 'https://www.alphavantage.co/query';
const CACHE_DURATION_MS = 1000 * 60 * 30; // Cache for 30 minutes

const RATE_LIMIT_WINDOW_MS = 1000 * 60; // 1 minute
const MAX_REQUESTS_PER_WINDOW = 10; // Max 10 requests per minute

export const getDailyStockData = onRequest(async (req, res) => {
  // Allow CORS for requests from your websites
  res.set('Access-Control-Allow-Origin', '*'); // **IMPORTANT: Restrict this in production**

  if (req.method === 'OPTIONS') {
    // Handle CORS preflight requests
    res.set('Access-Control-Allow-Methods', 'GET');
    res.set('Access-Control-Allow-Headers', 'Content-Type');
    res.status(204).send('');
    return;
  }

  const clientIdentifier = req.ip;

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

  try {
    // --- Rate Limiting Check ---
    const rateLimitDoc = await rateLimitDocRef.get();
    const currentTime = Date.now();

    if (rateLimitDoc.exists) {
      const rateLimitData = rateLimitDoc.data();
      // Ensure timestamp exists and is a Firestore Timestamp before calling toDate() // Access using bracket notation
      const timestamp = rateLimitData?.['timestamp'] instanceof admin.firestore.Timestamp ? rateLimitData['timestamp'].toDate().getTime() : undefined;
      const count = rateLimitData?.['count'] || 0;

      if (timestamp !== undefined && (currentTime - timestamp) < RATE_LIMIT_WINDOW_MS) {
        if (count >= MAX_REQUESTS_PER_WINDOW) {
          logger.warn('Rate limit exceeded for:', clientIdentifier);
          res.status(429).json({ error: 'Too Many Requests' });
          return;
        } else { // Access using bracket notation
          await rateLimitDocRef.update({ ['count']: admin.firestore.FieldValue.increment(1) });
        }
      } else {
        // Window expired or timestamp invalid, reset count and timestamp
        await rateLimitDocRef.set({
          count: 1,
          timestamp: admin.firestore.FieldValue.serverTimestamp(),
        });
      }
    } else {
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
      return; // Access using bracket notation
    }


    if (!symbol) {
      logger.error('Symbol parameter is missing');
      res.status(400).json({ error: 'symbol parameter is required' });
      return;
    }

    const cacheKey = `daily_${symbol}`; // Generate a unique cache key
    const cacheDocRef = db.collection('api_cache').doc(cacheKey);

    // --- Cache Checking ---
    const cacheDoc = await cacheDocRef.get();

    if (cacheDoc.exists) {
      const cachedData = cacheDoc.data();
       // Ensure timestamp exists and is a Firestore Timestamp before calling toDate()
      const timestamp = cachedData?.['timestamp'] instanceof admin.firestore.Timestamp ? cachedData['timestamp'].toDate() : undefined; // Access using bracket notation

      if (timestamp && (Date.now() - timestamp.getTime()) < CACHE_DURATION_MS) {
        logger.info('Serving from cache:', cacheKey);
        res.json(cachedData?.['data']); // Return cached data // Access using bracket notation
        return;
      } else {
        logger.info('Cache expired or invalid:', cacheKey);
      }
    } else {
      logger.info('Cache miss:', cacheKey);
    }
    // --- End Cache Checking ---


    // If not in cache or expired, fetch from Alphavantage
    const params = {
      function: 'TIME_SERIES_DAILY',
      symbol: symbol,
      apikey: apiKey,
    };

    const response = await axios.get(ALPHAVANTAGE_BASE_URL, { params });
    const apiData = response['data'];

    // Store in cache (using set to create or overwrite)
    await cacheDocRef.set({
      data: apiData,
      timestamp: admin.firestore.FieldValue.serverTimestamp(),
    });

    logger.info('Fetched from Alphavantage and cached:', cacheKey);
    res.json(apiData); // Return fetched data

  } catch (error: any) {
    // --- Error Handling ---
    // Check if the error is an AxiosError
    if (error?.response?.['status']) { // Use the imported AxiosError type // Access using bracket notation
       logger.error('Error fetching data from Alphavantage:', error.message);
       res.status(error.response?.status || 500).json({ error: `Error fetching data from Alphavantage: ${error.message}` });
    } else {
      logger.error('An unexpected error occurred:', error);
      res.status(500).json({ error: 'An unexpected error occurred' });
    }
    // --- End Error Handling ---
  }
});
