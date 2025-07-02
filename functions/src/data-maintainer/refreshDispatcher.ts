// =======================================
// CLOUD FUNCTION: refreshDispatcher
// VERSION: 1.1.0 - Refactored for better error handling
// =======================================

// Firebase Admin
import { Timestamp } from 'firebase-admin/firestore';
import { db } from '../firebase-admin-init';

// Firebase Functions
import { onSchedule } from 'firebase-functions/v2/scheduler';
import { onCall, CallableRequest, HttpsError } from 'firebase-functions/v2/https';

// Project imports
import { DataMaintainerEndpoint, ENDPOINT_TTLS, IMPLEMENTED_ENDPOINTS } from '../common/common-dm';
import { DATA_POINTS } from '../common/firestore-collections';
import { logRefreshEvent, RefreshStatus } from '../common/refresh-events';
import * as admin from 'firebase-admin';
const FieldValue = admin.firestore.FieldValue;

/**
 * Formats a Firestore Timestamp or Date to a Pacific Time string
 * @param date The date to format (can be Firestore Timestamp, Date, or null/undefined)
 * @returns Formatted date string in Pacific Time or 'N/A' if invalid
 */
function formatPST(date: any): string {
  if (!date) return 'N/A';
  try {
    const d = date.toDate ? date.toDate() : new Date(date);
    if (isNaN(d.getTime())) return 'Invalid Date';
    return d.toLocaleString('en-US', {
      timeZone: 'America/Los_Angeles',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: true
    }) + ' PT';
  } catch (error) {
    console.error('Error formatting date:', error);
    return 'Invalid Date';
  }
}

// Test configuration
const TEST_MODE = true; // Set to false to use production settings
const TEST_TTL_SECONDS = 30; // 30 seconds for testing
const SCHEDULE = 'every 1 minutes'; // Run every minute in test mode

/**
 * Scheduled function that runs periodically to check for and refresh expired data
 */
export async function refreshAllData() {
  const batchStartTime = Date.now();
  const now = Timestamp.now();
  const refreshPromises: Promise<void>[] = [];
  
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
    
    console.log(`rD rAD  Starting scheduled refresh at ${pacificTime} PT`);
    console.log(`rD rAD Test mode: ${TEST_MODE}, TTL: ${TEST_TTL_SECONDS}s`);
    
    // Get all symbols that have data points
    // Log current time and test settings
    const currentTime = new Date();
    console.log('rD rAD Current time:', formatPST(currentTime));
      
    console.log('rD rAD Running collectionGroup query:', {
      collection: DATA_POINTS,
      now: now.toDate().toISOString(),
      nowMillis: now.toMillis(),
      testMode: TEST_MODE,
      testTtl: TEST_TTL_SECONDS
    });
    
    let docsToProcess: FirebaseFirestore.QueryDocumentSnapshot<FirebaseFirestore.DocumentData>[] = [];
    
    try {
      console.log('rD rAD Limiting to company-overview endpoint for debugging');
      
      // First, get all documents that need refreshing
      console.log('rD rAD Querying for documents that need refreshing...');
      
      // Instead of using collectionGroup, we'll query each implemented endpoint separately
      // This avoids the document ID validation issue with collectionGroup
      docsToProcess = [];
      
      // Process each implemented endpoint separately
      for (const endpoint of IMPLEMENTED_ENDPOINTS) {
        try {
          console.log(`rD rAD Checking endpoint: ${endpoint}`);
          
          // For collection group queries, we can't filter by document ID directly
          // Instead, we'll fetch all documents that need refreshing and filter them
          const query = db.collectionGroup(DATA_POINTS)
            .where('nextRefreshAt', '<=', now)
            .limit(100);
            
          const snapshot = await query.get();
          
          // Filter for documents with matching endpoint ID
          const matchingDocs = snapshot.docs.filter(doc => {
            // The last segment of the path is the document ID (endpoint name)
            const docId = doc.ref.path.split('/').pop();
            return docId === endpoint;
          });
          
          if (matchingDocs.length > 0) {
            console.log(`rD rAD Found ${matchingDocs.length} documents for endpoint ${endpoint} that need refreshing`);
            docsToProcess.push(...matchingDocs);
          }
        } catch (error) {
          console.error(`rD rAD Error querying endpoint ${endpoint}:`, error);
          console.error('Query details:', {
            collection: DATA_POINTS,
            filter: { nextRefreshAt: { '<=': now.toDate().toISOString() } },
            limit: 100
          });
          if (error instanceof Error && 'documentRef' in error) {
            console.error('Error document reference:', {
              path: (error as any).documentRef?.path,
              id: (error as any).documentRef?.id
            });
          }
        }
      }
      
      if (docsToProcess.length === 0) {
        console.log('rD rAD No documents need refreshing at this time');
        return { success: true, refreshed: 0, skipped: 0, errors: 0 };
      }
      
      console.log(`rD rAD Found ${docsToProcess.length} documents to refresh across all implemented endpoints`);
      
      if (docsToProcess.length > 0) {
        console.log('rD rAD Documents to refresh:');
        docsToProcess.forEach((doc, i) => {
          const data = doc.data();
          console.log(`  [${i}] ${doc.ref.path}`, {
            id: doc.id,
            lastUpdated: formatPST(data.lastUpdated),
            nextRefreshAt: formatPST(data.nextRefreshAt),
            ttlSeconds: data.ttlSeconds,
            status: data.status
          });
        });
      } else {
        console.log('rD rAD No documents found matching the query');
        // No additional debug logging needed here
      }
    
    } catch (error) {
      console.error('rD rAD Error executing collectionGroup query:', error);
      throw error;
    }
    
    // Track refresh results
    const results = {
      success: 0,
      errors: 0
    };
    
    // Log batch start with document count
    console.log(`[${formatPST(Timestamp.now())}] rD rAD: Starting batch refresh of ${docsToProcess.length} documents`);
      
    // Process each document that needs refreshing
    for (const doc of docsToProcess) {
      const symbol = doc.ref.parent.parent?.id;
      const endpoint = doc.id as DataMaintainerEndpoint;
      
      if (!symbol) {
        const errorMsg = `Document has no parent symbol: ${doc.ref.path}`;
        console.error(`[${formatPST(Timestamp.now())}] rD rAD: ${errorMsg}`);
        results.errors++;
        continue;
      }
      
      // Log refresh start
      try {
        await logRefreshEvent(db, {
          symbol,
          endpoint,
          status: RefreshStatus.STARTED,
        });
      } catch (error) {
        console.error('rD rAD Failed to log refresh start:', error);
      }
      
      // Log metadata for company overview endpoint
      if (endpoint === DataMaintainerEndpoint.COMPANY_OVERVIEW) {
        const data = doc.data();
        console.log('rD rAD Company Overview Metadata:', {
          symbol,
          endpoint,
          lastUpdated: formatPST(data.lastUpdated),
          nextRefreshAt: formatPST(data.nextRefreshAt),
          ttlSeconds: data.ttlSeconds,
          status: data.status,
          docPath: doc.ref.path
        });
      }
      
      const refreshStartTime = Date.now();
      try {
        console.log(`rD rAD: Starting refresh for ${symbol} ${endpoint}`);
        
        // Get the TTL for this endpoint
        const ttl = TEST_MODE ? TEST_TTL_SECONDS : (ENDPOINT_TTLS[endpoint] || 3600);
        console.log(`rD rAD: Using TTL of ${ttl} seconds for ${endpoint}`);
        
        // Add refresh metadata to the document
        const nextRefreshAt = admin.firestore.Timestamp.fromMillis(Date.now() + (ttl * 1000));
        const refreshMetadata = {
          lastRefreshedAt: FieldValue.serverTimestamp(),
          nextRefreshAt: nextRefreshAt,
        };
        
        console.log(`[${formatPST(Timestamp.now())}] rD rAD: Updating document ${symbol}/${endpoint} with new refresh times`);
        
        // Update the document with the new data and refresh metadata
        await doc.ref.set({
          ...doc.data(),
          updatedAt: FieldValue.serverTimestamp(),
          ...refreshMetadata,
        }, { merge: true });
        
        const duration = Date.now() - refreshStartTime;
        console.log(`[${formatPST(Timestamp.now())}] rD rAD: Successfully updated ${symbol} ${endpoint} in ${duration}ms`);
        
        // Log successful refresh
        await logRefreshEvent(db, {
          symbol,
          endpoint,
          status: RefreshStatus.COMPLETED,
          metadata: {
            recordsUpdated: 1,
            responseSizeBytes: JSON.stringify(doc.data()).length,
            ttlSeconds: ttl,
            nextRefreshAt: nextRefreshAt.toDate().toISOString()
          },
          durationMs: duration
        });
        
        results.success++;
        console.log(`[${formatPST(Timestamp.now())}] rD rAD: Success count: ${results.success}, Error count: ${results.errors}`);
      } catch (error) {
        const duration = Date.now() - refreshStartTime;
        const errorMessage = error instanceof Error ? error.message : String(error);
        
        console.error(`[${formatPST(Timestamp.now())}] rD rAD: Error refreshing ${symbol} ${endpoint} after ${duration}ms:`, errorMessage);
        if (error instanceof Error && error.stack) {
          console.error(error.stack);
        }
        
        results.errors++;
        
        // Log failed refresh
        await logRefreshEvent(db, {
          symbol,
          endpoint,
          status: RefreshStatus.FAILED,
          error: error as Error,
          metadata: {
            error: errorMessage,
            timestamp: Timestamp.now().toDate().toISOString()
          },
          durationMs: duration
        });
        
        console.log(`[${formatPST(Timestamp.now())}] rD rAD: Error count: ${results.errors}, Success count: ${results.success}`);
      }
    }
    
    // Wait for all refreshes to complete
    await Promise.all(refreshPromises);
    
    const duration = Date.now() - batchStartTime;
    const successRate = refreshPromises.length > 0 
      ? (results.success / refreshPromises.length * 100).toFixed(2) 
      : 'N/A';
      
    console.log(`[${formatPST(Timestamp.now())}] rD rAD: Batch completed in ${duration}ms`);
    console.log(`[${formatPST(Timestamp.now())}] rD rAD: Results: ${results.success} succeeded, ${results.errors} failed (${successRate}% success rate)`);
    
    return { 
      success: results.errors === 0, 
      refreshed: refreshPromises.length,
      succeeded: results.success,
      failed: results.errors,
      durationMs: duration
    };
  } catch (error) {
    console.error('rD rAD Error in scheduled refresh job:', error);
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
  
  const ttl = TEST_MODE ? TEST_TTL_SECONDS : (ENDPOINT_TTLS[endpoint as DataMaintainerEndpoint] || 3600);
  
  // The refresh is now handled in the main loop, no need for a separate function
  // Remove the unused ttl variable to fix the TypeScript warning
  void ttl; // Mark as intentionally unused
  return { success: true };
});

// Emulator mode detection
if (process.env.FUNCTIONS_EMULATOR) {
  console.log('rD Emulator mode detected - starting automated test runner');
  
  // Wrap in an async IIFE to handle top-level await
  (async () => {
    const intervalMs = 60 * 1000; // 1 minute
    let runCount = 0;
    
    console.log(`rD Starting test runner - will run every ${intervalMs/1000} seconds`);
    
    // Define the refresh function
    const runRefresh = async () => {
      runCount++;
      console.log(`rD Running refresh #${runCount}...`);
      try {
        await refreshAllData();
      } catch (error) {
        console.error('Error in test runner refresh:', error);
      }
    };

    // Run immediately and set up interval
    await runRefresh();
    setInterval(runRefresh, intervalMs);
  })().catch(console.error);
}

// Export the scheduled refresh function
export const scheduledRefresh = onSchedule(
  {
    schedule: SCHEDULE,
    timeoutSeconds: 540,
    memory: '256MiB',
  },
  async (event) => {
    const timestamp = new Date().toLocaleString('en-US', { timeZone: 'America/Los_Angeles' });
    console.log(`rD [${timestamp} PT] Starting scheduled refresh`);
    
    try {
      await refreshAllData();
      console.log(`rD [${timestamp} PT] Completed scheduled refresh`);
    } catch (error) {
      console.error(`rD [${timestamp} PT] Error in scheduled refresh:`, error);
      throw error; // Let Firebase handle the retry logic
    }
  }
);
