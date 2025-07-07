// =======================================
// CLOUD FUNCTION: refreshDispatcher
// VERSION: 1.3.0 - Integrated with symbol manager and refactored for better maintainability
// =======================================

// Firebase Admin
import { Timestamp } from 'firebase-admin/firestore';
import { db } from '../firebase-admin-init';

// Firebase Functions
import { onSchedule } from 'firebase-functions/v2/scheduler';
import { onCall, CallableRequest, HttpsError } from 'firebase-functions/v2/https';

// Project imports
import { DataMaintainerEndpoint, ENDPOINT_TTLS, IMPLEMENTED_ENDPOINTS, RefreshResult, DocumentToProcess } from '../common/common-dm';
import { AvCompanyOverviewHandler } from './api-handlers/av-company-overview';
import { logRefreshEvent, RefreshStatus } from '../common/refresh-events';
import { formatPST } from '../utils/utils';
import { fetchAndStoreData } from './fetchAndStoreData';
import { FirestoreCollection } from '../common/firestore-collections';

// Test configuration
const TEST_MODE = true; // Set to false to use production settings
const TEST_TTL_SECONDS = 300; // 5 minutes TTL for testing
const SCHEDULE = 'every 15 minutes'; // Run every 15 minutes in test mode

// turn off console logs
const pr = false;

/**
 * Scheduled function that runs periodically to check for and refresh expired data
 */
export async function refreshAllData(): Promise<RefreshResult> {
  const batchStartTime = Date.now();
  const now = Timestamp.now();
  
  try {
    // Log the current time in Pacific Time
    const pacificTime = now.toDate().toLocaleString('en-US', {
      timeZone: 'America/Los_Angeles',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: true
    });
    
    if (pr) console.log(`rD rAD Starting scheduled refresh at ${pacificTime} PT`);
    if (pr) console.log(`rD rAD Test mode: ${TEST_MODE}, TTL: ${TEST_TTL_SECONDS}s`);
    
    // Get all active tracked symbols with their refreshEnabled status
    if (pr) console.log('rD rAD Fetching active tracked symbols...');
    const activeSymbols = await db.collection(FirestoreCollection.TRACKED_SYMBOLS)
      .where('isActive', '==', true)
      .get();
      
    // Filter out symbols where refreshEnabled is false for AV endpoints
    const symbolsToProcess = activeSymbols.docs
      .filter(doc => {
        const data = doc.data();
        // For AV endpoints, skip if refreshEnabled is explicitly false
        const isAvEndpoint = Array.from(IMPLEMENTED_ENDPOINTS).some(ep => ep.startsWith('AV_'));
        return !(isAvEndpoint && data.refreshEnabled === false);
      })
      .map(doc => doc.id);
      
    if (pr) console.log(`rD rAD Found ${symbolsToProcess.length} symbols to process`);
    
    // Log current time and test settings
    if (pr) console.log('rD rAD Current time:', formatPST(now));
    
    // Process each symbol for each implemented endpoint
    const endpoints = Array.from(IMPLEMENTED_ENDPOINTS);
    
    if (pr) console.log(`rD rAD Processing ${symbolsToProcess.length} symbols across ${endpoints.length} endpoints`);
    
    // Build the list of documents to process
    const docsToProcess: DocumentToProcess[] = [];
    
    // Process each symbol
    for (const symbol of symbolsToProcess) {
      // Process each implemented endpoint for this symbol
      for (const endpoint of endpoints) {
        const endpointKey = endpoint as DataMaintainerEndpoint;
        const ttl = TEST_MODE ? TEST_TTL_SECONDS : (ENDPOINT_TTLS as Record<string, number>)[endpointKey];
        if (ttl) {
          docsToProcess.push({ 
            symbol, 
            endpoint: endpointKey, 
            ttl 
          });
        }
      }
    }
    
    if (pr) console.log(`rD rAD Found ${docsToProcess.length} documents to process`);
    
    // Initialize results tracking
    const results = {
      success: 0,
      errors: 0,
      skipped: 0
    };
      
    // Process documents in batches to avoid timeouts
    const BATCH_SIZE = 10;
    const batchPromises: Promise<void>[] = [];

    for (let i = 0; i < docsToProcess.length; i += BATCH_SIZE) {
      const batch = docsToProcess.slice(i, Math.min(i + BATCH_SIZE, docsToProcess.length));
      if (pr) console.log(`rD rAD Processing batch ${Math.floor(i / BATCH_SIZE) + 1} of ${Math.ceil(docsToProcess.length / BATCH_SIZE)}`);
      
      // Process symbols sequentially with delay between them
      for (const { symbol, endpoint, ttl } of batch) {
        batchPromises.push((async () => {
          try {
          if (pr) console.log(`rD rAD Processing ${symbol} for endpoint ${endpoint}`);
          
          // Check if this document needs refreshing
          const docRef = db.collection(FirestoreCollection.DATA_POINTS).doc(`${symbol}_${endpoint}`);
          const doc = await docRef.get();
          
          if (!doc.exists) {
            if (pr) console.log(`rD rAD Adding ${symbol}_${endpoint} to refresh queue (new document)`);
            const startTime = Date.now();
            
            try {
              // Create a proper request/response for fetchAndStoreData
              const req = {
                method: 'POST',
                body: JSON.stringify({ symbol, endpoint }),
                headers: { 'content-type': 'application/json' }
              } as any;
              
              const res = {
                status: (code: number) => ({
                  json: (data: any) => {
                    if (code >= 400) {
                      throw new Error(data?.error || 'Failed to fetch data');
                    }
                    return data;
                  }
                })
              } as any;
              
              await fetchAndStoreData(req, res);
              const durationMs = Date.now() - startTime;
              results.success++;
              
              // Log successful refresh
              await logRefreshEvent(db, {
                symbol,
                endpoint,
                status: RefreshStatus.COMPLETED,
                durationMs
              });
            } catch (error) {
              const errorMessage = error instanceof Error ? error.message : String(error);
              if (pr) console.error(`rD rAD Error refreshing ${symbol}_${endpoint}:`, errorMessage);
              results.errors++;
              
              // Log the error to Firestore
              const errorTime = Date.now();
              await logRefreshEvent(db, {
                symbol,
                endpoint,
                status: RefreshStatus.FAILED,
                error: error as Error,
                durationMs: errorTime - startTime
              });
            }
          } else {
            const data = doc.data();
            if (!data) {
              throw new Error(`Document ${symbol}_${endpoint} exists but has no data`);
            }
            
            const lastRefreshed = data.lastRefreshed?.toDate?.();
            const lastRefreshTime = lastRefreshed ? lastRefreshed.getTime() : 0;
            const needsRefresh = !lastRefreshTime || 
              (Date.now() - lastRefreshTime) > (ttl * 1000);
              
            if (needsRefresh) {
              if (pr) console.log(`rD rAD Refreshing ${symbol}_${endpoint} (data is stale)`);
              const refreshStartTime = Date.now();
              try {
                // Create a mock request object for the fetchAndStoreData HTTP function
                // Create a proper request/response for fetchAndStoreData
                const req = {
                  method: 'POST',
                  body: JSON.stringify({ symbol, endpoint }),
                  headers: { 'content-type': 'application/json' }
                } as any;
                
                const res = {
                  status: (code: number) => ({
                    json: (data: any) => {
                      if (code >= 400) {
                        throw new Error(data?.error || 'Failed to fetch data');
                      }
                      return data;
                    }
                  })
                } as any;
                
                await fetchAndStoreData(req, res);
                const durationMs = Date.now() - refreshStartTime;
                results.success++;
                
                // Log the successful refresh
                await logRefreshEvent(db, {
                  symbol,
                  endpoint,
                  status: RefreshStatus.COMPLETED,
                  durationMs
                });
              } catch (error) {
                const errorMessage = error instanceof Error ? error.message : String(error);
                if (pr) console.error(`rD rAD Error refreshing ${symbol}_${endpoint}:`, errorMessage);
                results.errors++;
                
                // Log the error to Firestore
                const errorTime = Date.now();
                await logRefreshEvent(db, {
                  symbol,
                  endpoint,
                  status: RefreshStatus.FAILED,
                  error: error as Error,
                  durationMs: errorTime - refreshStartTime
                });
              }
            } else {
              if (pr) console.log(`rD rAD Skipping ${symbol}_${endpoint} (data is fresh)`);
              results.skipped++;
            }
          }
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : String(error);
          if (pr) console.error(`rD rAD Error processing ${symbol}_${endpoint}:`, errorMessage);
          results.errors++;
          
          // Log the error to Firestore
          // Error handling moved to the try-catch block above
        }
      })());
      }
      
      try {
        // Wait for the current batch to complete before moving to the next one
        await Promise.all(batchPromises);
        batchPromises.length = 0; // Clear the array for the next batch
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        if (pr) console.error('Error in batch processing:', errorMessage);
        results.errors++;
      }
    }
    
    // Log final results
    const durationMs = Date.now() - batchStartTime;
    if (pr) console.log(`rD rAD Refresh completed in ${durationMs}ms`);
    if (pr) console.log(`rD rAD Results: ${results.success} successful, ${results.skipped} skipped, ${results.errors} failed`);
    
    if (results.errors > 0) {
      if (pr) console.error(`rD rAD ${results.errors} errors occurred during refresh`);
    }
    
    return {
      success: results.errors === 0,
      refreshed: results.success,
      skipped: results.skipped,
      errors: results.errors,
      durationMs
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    if (pr) console.error('rD rAD Error in refreshAllData:', errorMessage);
    
    // Log the error to Firestore
    // Use a valid endpoint from DataMaintainerEndpoint for system operations
    await logRefreshEvent(db, {
      symbol: 'SYSTEM',
      endpoint: DataMaintainerEndpoint.COMPANY_OVERVIEW, // Using a valid endpoint
      status: RefreshStatus.FAILED,
      error: error as Error,
      metadata: { operation: 'REFRESH_ALL' }
    });
    
    // Re-throw the error to be handled by the caller
    throw error;
  }
}

/**
 * HTTP callable function to manually trigger a refresh for a specific symbol and endpoint
 */
export const manualRefresh = onCall({
  enforceAppCheck: true,
  memory: '256MiB',
  timeoutSeconds: 300
}, async (request: CallableRequest) => {
  // Validate request
  if (!request.auth) {
    throw new HttpsError('unauthenticated', 'You must be logged in to refresh data');
  }
  
  const { symbol, endpoint } = request.data;
  
  if (!symbol || !endpoint) {
    throw new HttpsError('invalid-argument', 'Symbol and endpoint are required');
  }
  
  // Verify the endpoint is implemented
  if (!IMPLEMENTED_ENDPOINTS.has(endpoint as DataMaintainerEndpoint)) {
    throw new HttpsError('failed-precondition', `Endpoint ${endpoint} is not implemented yet`);
  }
  
  try {
    // Refresh the data for the specified symbol and endpoint
    const refreshStartTime = Date.now();
    
    try {
      // Get the appropriate handler for the endpoint
      let handler: any;
      if (endpoint === DataMaintainerEndpoint.COMPANY_OVERVIEW) {
        handler = new AvCompanyOverviewHandler();
      } else {
        throw new Error(`Unsupported endpoint: ${endpoint}`);
      }
      
      // Fetch and transform the data
      const data = await handler.fetchAndTransform(symbol);
      
      // Save to Firestore
      const docRef = db.collection(FirestoreCollection.MARKET_DATA)
        .doc(symbol)
        .collection(FirestoreCollection.DATA_POINTS)
        .doc(endpoint);
      
      const updateData = {
        ...data,
        lastUpdated: Timestamp.now(),
        status: 'success',
        symbol,
        endpoint,
        nextRefreshAt: Timestamp.fromMillis(Date.now() + 24 * 60 * 60 * 1000), // 24 hours from now
        ttlSeconds: 24 * 60 * 60 // 24 hours in seconds
      };
      
      // Remove any undefined or null values
      Object.keys(updateData).forEach(key => {
        if (updateData[key] === undefined || updateData[key] === null) {
          delete updateData[key];
        }
      });
      
      await docRef.set(updateData, { merge: true });
      
      // Log the successful refresh
      await logRefreshEvent(db, {
        symbol,
        endpoint: endpoint as DataMaintainerEndpoint,
        status: RefreshStatus.COMPLETED,
        durationMs: Date.now() - refreshStartTime,
        metadata: { manual: true }
      });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.error(`Error in manualRefresh for ${symbol}/${endpoint}:`, errorMessage);
      
      // Log the error to Firestore
      await logRefreshEvent(db, {
        symbol,
        endpoint: endpoint as DataMaintainerEndpoint,
        status: RefreshStatus.FAILED,
        error: error as Error,
        durationMs: Date.now() - refreshStartTime,
        metadata: { manual: true }
      });
      
      throw new HttpsError('internal', `Failed to refresh data: ${errorMessage}`);
    }
    
    return { success: true };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error(`Error in manualRefresh for ${symbol}/${endpoint}:`, errorMessage);
    
    // Log the error to Firestore
    await logRefreshEvent(db, {
      symbol,
      endpoint: endpoint as DataMaintainerEndpoint,
      status: RefreshStatus.FAILED,
      error: error as Error,
      metadata: { manual: true }
    });
    
    throw new HttpsError('internal', `Failed to refresh data: ${errorMessage}`);
  }
});

// Emulator mode detection
if (process.env.FUNCTIONS_EMULATOR) {
  if (pr) console.log(`==================== DUDE START TEST RUNNER ====================`)
  if (pr) console.log('rD Emulator mode detected - starting automated test runner');
  
  // Wrap in an async IIFE to handle top-level await
  (async () => {
    const intervalMs = 5 * 60 * 1000; // 5 minutes between full refreshes
    let runCount = 0;
    
    if (pr) console.log(`rD Starting test runner - will run every ${intervalMs/1000} seconds`);
    
    // Define the refresh function
    const runRefresh = async () => {
      runCount++;
      const startTime = Date.now();
      if (pr) console.log(`==================== DUDE START rD [Run #${runCount}] ====================`)
      if (pr) console.log(`rD [Run #${runCount}] Starting refresh at ${formatPST(new Date())}`);
      
      try {
        const result = await refreshAllData();
        const duration = ((Date.now() - startTime) / 1000).toFixed(1);
        if (pr) console.log(`rD [Run #${runCount}] Completed in ${duration}s -`, result);
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        console.error(`rD [Run #${runCount}] Error:`, errorMessage);
      }
      if (pr) console.log(`==================== END rD [Run #${runCount}] ====================`)
    };

    // Don't run immediately on startup to avoid conflicts
    if (pr) console.log('rD Initial delay before first run...');
    setTimeout(() => {
      // Run first refresh
      runRefresh().catch(console.error);
      
      // Set up interval for subsequent runs
      setInterval(() => {
        runRefresh().catch(console.error);
      }, intervalMs);
    }, 10000); // 10 second initial delay
  })();
  if (pr) console.log(`==================== END TEST RUNNER ====================`)
}

// Scheduled function for production
export const scheduledRefresh = onSchedule({
  schedule: SCHEDULE,
  timeZone: 'America/Los_Angeles',
  memory: '256MiB',
  timeoutSeconds: 540 // 9 minutes
}, async (event) => {
  if (pr) console.log('rD Starting scheduled refresh at', new Date().toISOString());
  await refreshAllData();
});
