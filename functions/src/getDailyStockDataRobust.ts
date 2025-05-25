import { onRequest } from "firebase-functions/v2/https";
import * as admin from 'firebase-admin';
import {
  setCorsHeaders,
  handleOptionsRequest,
  getAlphavantageApiKey,
  fetchStockData, // Assuming fetchStockData is updated in utils.ts
} from './utils';

// Import constants from common-fn.ts
import {
  // CACHE_DURATION_MS,
  RATE_LIMIT_WINDOW_MS,
  MAX_REQUESTS_PER_WINDOW,
  AlphaVantageFunction // Keep AlphaVantageFunction imported from common-fn.ts
} from './common-fn';

// Initialize Firebase Admin SDK (keep this if needed for Firestore)
// Check if Firebase app is already initialized to avoid errors in local development
if (!admin.apps.length) {
  admin.initializeApp();
}

const db = admin.firestore(); // Keep this if Firestore is used

export const getDailyStockDataRobust = onRequest(async (req, res) => {
    setCorsHeaders(res);

    console.info('gDSDR robust calling handleOptionsRequest. query: ', req.query);
    if (handleOptionsRequest(req as any, res as any)) {
        return;
    }
    console.info('gDSDR robust after calling handleOptionsRequest');

    // Use a placeholder client identifier for local testing if req.ip is undefined
    const clientIdentifier = process.env.FUNCTIONS_EMULATOR === 'true' ? 'local-emulator-client' : req.ip;

    console.info('gDSDR robust req.query: ', req.query);
    console.info('gDSDR robust clientIdentifier: ', clientIdentifier);

    // --- Handle potential undefined clientIdentifier ---
    if (!clientIdentifier) {
        console.warn('Could not determine client IP for rate limiting.');
        res.status(500).json({ error: 'Could not determine client identifier.' });
        return;
    }
    // --- End handling undefined clientIdentifier ---

    const rateLimitDocRef = db.collection('rate_limits').doc(clientIdentifier);

    console.info('gDSDR robust rateLimitDocRef: ', rateLimitDocRef);

    // --- Rate Limiting Check ---
    try {
        console.info('gDSDR Robust: START of rate limiting try block');

        let rateLimitDoc;
        try {
            console.info('gDSDR Robust: About to call rateLimitDocRef.get()');
            rateLimitDoc = await rateLimitDocRef.get();
            console.info('gDSDR Robust: After rateLimitDoc.get()');
        } catch (getError: any) {
            // Check if the error is a "NOT_FOUND" error (Firestore error code 5)
            if (getError.code === 5 || getError.details === 'NOT_FOUND') { // Check against Firestore error codes or details
                console.info('gDSDR Robust: Rate limit document not found, creating.');
                // Document doesn't exist, proceed to create it below
            } else {
                 // Log and re-throw other unexpected errors
                console.error('gDSDR Robust - Unexpected error during rate limit doc get:', getError);
                throw getError; // Re-throw to be caught by the outer catch
            }
        }

        const currentTime = Date.now();

        // console.info('gDSDR robust rateLimitDoc: ', rateLimitDoc); // Avoid logging large objects
        console.info('gDSDR robust currentTime: ', currentTime);


        // Now, check if rateLimitDoc exists (it might not if the inner catch handled a NOT_FOUND)
        if (rateLimitDoc && rateLimitDoc.exists) {
            const rateLimitData = rateLimitDoc.data();
            // Ensure timestamp exists and is a Firestore Timestamp before calling toDate()
            // Access using bracket notation for safety with potentially undefined data
            const timestamp = rateLimitData?.['timestamp'] instanceof admin.firestore.Timestamp ? rateLimitData['timestamp'].toDate().getTime() : undefined;
            const count = rateLimitData?.['count'] || 0;

            // console.info('gDSDR robust rateLimitData: ', rateLimitData); // Avoid logging large objects
            console.info('gDSDR robust timestamp/count: ', timestamp, count);


            if (timestamp !== undefined && (currentTime - timestamp) < RATE_LIMIT_WINDOW_MS) {
                if (count >= MAX_REQUESTS_PER_WINDOW) {
                    console.warn('gDSDR Robust - Rate limit exceeded for:', clientIdentifier);
                    res.status(429).json({ error: 'Dude - Too Many Requests!!' });
                    return;
                } else {
                    // Access using bracket notation for safety with potentially undefined data
                    await rateLimitDocRef.update({ ['count']: admin.firestore.FieldValue.increment(1) });
                    console.warn('gDSDR Robust - Updating Rate limit doc');
                }
            } else {
                console.warn('gDSDR Robust rate limit window expired or timestamp invalid. Resetting.');
                // Window expired or timestamp invalid, reset count and timestamp
                await rateLimitDocRef.set({
                    count: 1,
                    timestamp: admin.firestore.FieldValue.serverTimestamp(),
                });
                 console.warn('gDSDR Robust no timestamp or still in rate limit window'); // This log seems misplaced based on the logic
            }
        } else {
             console.warn('gDSDR Robust no rate limit doc found. creating now ');
            // First request from this client, create document
            await rateLimitDocRef.set({
                count: 1,
                timestamp: admin.firestore.FieldValue.serverTimestamp(),
            });
        }


    } catch (error: any) {
        console.error('gDSDR Robust - Error during rate limiting check:', error);
        res.status(500).json({ error: 'An error occurred while checking rate limits.' });
        return; // Stop execution if rate limiting check fails
    }
    // --- End Rate Limiting Check ---

    const symbol = (req.query['symbol'] as string);
    const apiKey = getAlphavantageApiKey();

    if (!apiKey) {
        console.error('Alphavantage API key is not configured.');
        res.status(500).json({ error: 'Alphavantage API key is not configured.' });
        return;
    }


    if (!symbol) {
        console.error('Symbol parameter is missing');
        res.status(400).json({ error: 'symbol parameter is required' });
        return;
    }

    // --- Cache Checking ---
    const cacheKey = `daily_${symbol}`;
    const cacheDocRef = db.collection('api_cache').doc(cacheKey);

    console.info('gDSDR cache key:', cacheKey);
    console.info('gDSDR cacheDocRef:', cacheDocRef);

    try {
        const cacheDoc = await cacheDocRef.get(); // Keep this await inside the try for cache check

        if (cacheDoc.exists) {
            // const cachedData = cacheDoc.data();
            // console.info('gDSDR cache doc exists. data: ', cachedData); // Avoid logging large objects
             // Ensure timestamp exists and is a Firestore Timestamp before calling toDate()
            // const timestamp = cachedData?.['timestamp'] instanceof admin.firestore.Timestamp ? cachedData['timestamp'].toDate().getTime() : undefined; // Access using bracket notation
            // if (timestamp && (Date.now() - timestamp.getTime()) < CACHE_DURATION_MS) {
            //     console.info('gDSDR Serving from cache:', cacheKey);
            //     res.json(cachedData?.['data']); // Return cached data // Access using bracket notation
            //     return; // Keep this return, as you are successfully serving from cache
            // } else {
            //     console.info('gDSDR Cache expired or invalid:', cacheKey);
            // }
        } else {
            console.info('gDSDR Cache miss:', cacheKey);
        }
    } catch (error: any) {
        console.error('gDSDR Robust - Error during cache check:', error);
        // Don't return here, let the function continue
    }
    // --- End Cache Checking ---

    try {
        // If not in cache or expired, fetch from Alphavantage using helper
        // Corrected call: Pass AlphaVantageFunction.TIME_SERIES_DAILY as the first argument
        const response = await fetchStockData(AlphaVantageFunction.TIME_SERIES_DAILY, symbol, apiKey);

        // Assuming fetchStockData now returns AxiosResponse, access data via response.data
        const apiData = response.data;


        // Store in cache (using set to create or overwrite)
        console.info('gDSDR robust fetched data: ', apiData);
        await cacheDocRef.set({
            data: apiData,
            timestamp: admin.firestore.FieldValue.serverTimestamp(),
        });

        console.info('gDSDR Robust - Fetched from Alphavantage and cached:', cacheKey);
        res.json(apiData); // Return fetched data

    } catch (error: any) {
        // --- Error Handling ---
        // Check if the error is an AxiosError (assuming fetchStockData throws AxiosError)
        if (error.response?.status) {
             console.error('gDSDR Ruh roh - Error fetching data from Alphavantage:', error.message);
             // Access error response data if needed, cast for type safety if available
             const apiErrorData = error.response.data as any; // Cast to any or a specific error type if known
             res.status(error.response.status || 500).json({ error: `Yikes! Error fetching data from Alphavantage: ${apiErrorData?.Information || error.message}` });
        } else {
          console.error('gDSDR Dude - an unexpected error occurred:', error);
          res.status(500).json({ error: 'Doh!! An unexpected error occurred' });
        }
        // --- End Error Handling ---
    }
});


// import { onRequest } from "firebase-functions/v2/https";
// import * as logger from "firebase-functions/logger";

// import * as admin from 'firebase-admin';

// import {
//  setCorsHeaders,
//  handleOptionsRequest,
//  getAlphavantageApiKey,
//  fetchStockData
// } from './utils';

// import {
//   CACHE_DURATION_MS,
//   RATE_LIMIT_WINDOW_MS,
//   MAX_REQUESTS_PER_WINDOW
//  } from './common-fn';

// // Initialize Firebase Admin SDK
// admin.initializeApp();

// const db = admin.firestore();

// export const getDailyStockDataRobust = onRequest(async (req, res) => {
//   setCorsHeaders(res); // Use helper function

//   logger.info('gDSDR robust calling handleOptionsRequest. query: ', req.query);
//   if (handleOptionsRequest(req as any, res as any)) {
//     return;
//   } // Use helper function
//   logger.info('gDSDR robust after calling handleOptionsRequest');

//   // const clientIdentifier = req.ip;
//   // Use a placeholder client identifier for local testing if req.ip is undefined
//   const clientIdentifier = process.env.FUNCTIONS_EMULATOR === 'true' ? 'local-emulator-client' : req.ip;

//   logger.info('gDSDR robust req.query: ', req.query);
//   logger.info('gDSDR robust clientIdentifier: ', clientIdentifier);

//   // --- Handle potential undefined clientIdentifier ---
//   if (!clientIdentifier) {
//       logger.warn('Could not determine client IP for rate limiting.');
//       // You might want to return an error or handle this case differently
//       // depending on your desired behavior when the IP is unknown.
//       // For now, we'll return an error.
//       res.status(500).json({ error: 'Could not determine client identifier.' });
//       return;
//   }
//   // --- End handling undefined clientIdentifier ---

//   const rateLimitDocRef = db.collection('rate_limits').doc(clientIdentifier);

//   logger.info('gDSDR robust rateLimitDocRef: ', rateLimitDocRef);

//   try {
//     // --- Rate Limiting Check ---
//     const rateLimitDoc = await rateLimitDocRef.get();
//     const currentTime = Date.now();

//     logger.info('gDSDR robust rateLimitDoc: ', rateLimitDoc);
//     logger.info('gDSDR robust currentTime: ', currentTime);

//     if (rateLimitDoc.exists) {
//       const rateLimitData = rateLimitDoc.data();
//       // Ensure timestamp exists and is a Firestore Timestamp before calling toDate() // Access using bracket notation
//       const timestamp = rateLimitData?.['timestamp'] instanceof admin.firestore.Timestamp ? rateLimitData['timestamp'].toDate().getTime() : undefined;
//       const count = rateLimitData?.['count'] || 0;

//       logger.info('gDSDR robust dude rateLimitData: ', rateLimitData);
//       logger.info('gDSDR robust timestamp/count: ', timestamp, count);

//       if (timestamp !== undefined && (currentTime - timestamp) < RATE_LIMIT_WINDOW_MS) {
//         if (count >= MAX_REQUESTS_PER_WINDOW) {
//           logger.warn('gDSDR Robust - Rate limit exceeded for:', clientIdentifier);
//           res.status(429).json({ error: 'Dude - Too Many Requests!!' });
//           return;
//         } else { // Access using bracket notation
//           await rateLimitDocRef.update({ ['count']: admin.firestore.FieldValue.increment(1) });
//           logger.warn('gDSDR Robust - Updating Rate limit doc');
//         }
//       } else {
//         logger.warn('gDSDR Robust no timestamp or still in rate limit window');
//         // Window expired or timestamp invalid, reset count and timestamp
//         await rateLimitDocRef.set({
//           count: 1,
//           timestamp: admin.firestore.FieldValue.serverTimestamp(),
//         });
//       }
//     } else {
//       logger.warn('gDSDR Robust no rate limit doc. creating now ');
//       // First request from this client, create document
//       await rateLimitDocRef.set({
//         count: 1,
//         timestamp: admin.firestore.FieldValue.serverTimestamp(),
//       });
//     }
//     // --- End Rate Limiting Check ---


//     const symbol = (req.query['symbol'] as string); // Access using bracket notation
//     const apiKey = getAlphavantageApiKey();

//     if (!apiKey) {
//       logger.error('Alphavantage API key is not configured.');
//       res.status(500).json({ error: 'Alphavantage API key is not configured.' });
//       return; 
//     }


//     if (!symbol) {
//       logger.error('Symbol parameter is missing');
//       res.status(400).json({ error: 'symbol parameter is required' });
//       return;
//     }

//     const cacheKey = `daily_${symbol}`; // Generate a unique cache key
//     const cacheDocRef = db.collection('api_cache').doc(cacheKey);

//     logger.info('gDSDR cache key:', cacheKey);
//     logger.info('gDSDR cacheDocRef:', cacheDocRef);

//     // --- Cache Checking ---
//     const cacheDoc = await cacheDocRef.get();

//     if (cacheDoc.exists) {
//       const cachedData = cacheDoc.data();
//       logger.info('gDSDR cache doc exists. data: ', cachedData);
//        // Ensure timestamp exists and is a Firestore Timestamp before calling toDate()
//       const timestamp = cachedData?.['timestamp'] instanceof admin.firestore.Timestamp ? cachedData['timestamp'].toDate() : undefined; // Access using bracket notation
//       if (timestamp && (Date.now() - timestamp.getTime()) < CACHE_DURATION_MS) {
//         logger.info('gDSDR Serving from cache:', cacheKey);
//         res.json(cachedData?.['data']); // Return cached data // Access using bracket notation
//         return;
//       } else {
//         logger.info('gDSDR Cache expired or invalid:', cacheKey);
//       }
//     } else {
//       logger.info('gDSDR Cache miss:', cacheKey);
//     }
//     // --- End Cache Checking ---


//     // If not in cache or expired, fetch from Alphavantage using helper
//     const apiData = await fetchStockData(symbol, apiKey);
//     // Store in cache (using set to create or overwrite)
//     logger.info('gDSDR robust fetched data: ', apiData);
//     await cacheDocRef.set({
//       data: apiData,
//       timestamp: admin.firestore.FieldValue.serverTimestamp(),
//     });

//     logger.info('gDSDR Robust - Fetched from Alphavantage and cached:', cacheKey);
//     res.json(apiData); // Return fetched data

//   } catch (error: any) {
//     // --- Error Handling ---
//     // Check if the error is an AxiosError
//     if (error?.response?.['status']) { // Use the imported AxiosError type // Access using bracket notation
//        logger.error('gDSDR Ruh roh - Error fetching data from Alphavantage:', error.message);
//        res.status(error.response?.status || 500).json({ error: `Yikes! Error fetching data from Alphavantage: ${error.message}` });
//     } else {
//       logger.error('gDSDR Dude - an unexpected error occurred:', error);
//       res.status(500).json({ error: 'Doh!! An unexpected error occurred' });
//     }
//     // --- End Error Handling ---
//   }
// });