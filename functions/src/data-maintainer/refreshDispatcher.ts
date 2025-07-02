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
import { AlphaVantageFunctionName, CLOUD_FUNCTIONS_BASE_URL } from '../common/common-fn';
import { DataMaintainerEndpoint, ENDPOINT_TTLS, METADATA_SERVER_TOKEN_URL, IMPLEMENTED_ENDPOINTS } from '../common/common-dm';
import { DATA_POINTS, MARKET_DATA } from '../common/firestore-collections';

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
  const startTime = Date.now();
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
    
    let symbolsSnapshot: FirebaseFirestore.QuerySnapshot<FirebaseFirestore.DocumentData>;
    let docsToProcess: FirebaseFirestore.QueryDocumentSnapshot<FirebaseFirestore.DocumentData>[] = [];
    
    try {
      console.log('rD rAD Limiting to company-overview endpoint for debugging');
      
      // First, get the specific document to debug
      const nvdaDocRef = db.collection('market-data')
        .doc('NVDA')
        .collection('data-points')
        .doc(DataMaintainerEndpoint.COMPANY_OVERVIEW);
      
      const nvdaDoc = await nvdaDocRef.get();
      if (nvdaDoc.exists) {
        const data = nvdaDoc.data();
        console.log('rD rAD NVDA Company Overview Doc:', {
          exists: true,
          path: nvdaDoc.ref.path,
          lastUpdated: data?.lastUpdated?.toDate?.()?.toISOString(),
          nextRefreshAt: data?.nextRefreshAt?.toDate?.()?.toISOString(),
          nextRefreshAtMillis: data?.nextRefreshAt?.toMillis?.(),
          nowMillis: now.toMillis(),
          shouldRefresh: data?.nextRefreshAt && data.nextRefreshAt.toMillis() <= now.toMillis()
        });
      } else {
        console.log('rD rAD NVDA Company Overview Doc: Does not exist');
      }
      
      // First, get all documents that need refreshing
      const query = db.collectionGroup(DATA_POINTS)
        .where('nextRefreshAt', '<=', now);
      
      console.log('rD rAD Query constructed, executing...');
      
      symbolsSnapshot = await query.get();
      
      // Filter to only implemented endpoints and process them
      docsToProcess = symbolsSnapshot.docs
        .filter(doc => IMPLEMENTED_ENDPOINTS.has(doc.id as DataMaintainerEndpoint));
      
      console.log(`rD rAD Found ${docsToProcess.length} implemented endpoints to refresh (out of ${symbolsSnapshot.size} total)`);
      
      // Log skipped endpoints for debugging
      if (docsToProcess.length < symbolsSnapshot.size) {
        const skippedCount = symbolsSnapshot.size - docsToProcess.length;
        const skippedEndpoints = [...new Set(
          symbolsSnapshot.docs
            .filter(doc => !IMPLEMENTED_ENDPOINTS.has(doc.id as DataMaintainerEndpoint))
            .map(doc => doc.id)
        )];
        
        console.log(`rD rAD Skipping ${skippedCount} documents from unimplemented endpoints:`, 
          skippedEndpoints.join(', '));
      }
      
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
        
        // Debug: Check if the collection exists and has any documents
        const allDocs = await db.collectionGroup(DATA_POINTS).limit(1).get();
        console.log(`rD rAD Collection group ${DATA_POINTS} exists: ${!allDocs.empty}`);
        
        if (!allDocs.empty) {
          const sampleDoc = allDocs.docs[0];
          const data = sampleDoc.data();
          console.log('rD rAD Sample document from collection:', {
            path: sampleDoc.ref.path,
            lastUpdated: formatPST(data.lastUpdated),
            nextRefreshAt: formatPST(data.nextRefreshAt),
            now: formatPST(now),
            isBeforeNow: data.nextRefreshAt && data.nextRefreshAt.toMillis() <= now.toMillis()
          });
        }
      }
    
    } catch (error) {
      console.error('rD rAD Error executing collectionGroup query:', error);
      throw error;
    }
    
    // Process each document that needs refreshing
    for (const doc of docsToProcess) {
      const symbol = doc.ref.parent.parent?.id;
      const endpoint = doc.id as DataMaintainerEndpoint;
      
      if (!symbol) {
        console.warn(`rD rAD Skipping document with missing symbol:`, doc.ref.path);
        continue;
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
      
      const ttl = TEST_MODE ? TEST_TTL_SECONDS : (ENDPOINT_TTLS[endpoint] || 3600);
      refreshPromises.push(refreshDataPoint(symbol, endpoint, ttl));
    }
    
    // Wait for all refreshes to complete
    await Promise.all(refreshPromises);
    
    const duration = Date.now() - startTime;
    console.log(`rD rAD Completed refresh of ${refreshPromises.length} data points in ${duration}ms`);
    
    return { success: true, refreshed: refreshPromises.length };
  } catch (error) {
    console.error('rD rAD Error in scheduled refresh job:', error);
    throw error;
  }
}

/**
 * Refreshes a single data point by calling the fetchAndStoreData function
 */
async function refreshDataPoint(symbol: string, endpoint: DataMaintainerEndpoint, ttlSeconds: number): Promise<void> {
  const functionName = AlphaVantageFunctionName.FETCH_AND_STORE_DATA;
  const now = new Date();
  const pacificTime = now.toLocaleString('en-US', {
    timeZone: 'America/Los_Angeles',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: true
  });
  
  console.log(`rD rDP [${pacificTime} PT] Refreshing ${symbol}/${endpoint} with TTL ${ttlSeconds}s`);
  
  try {
    // In emulator mode, use a simplified approach
    if (process.env.FUNCTIONS_EMULATOR) {
      console.log(`rD rDP [${pacificTime} PT] Running in emulator - using simplified refresh`);
      
      // Just update the nextRefreshAt time for testing
      const nextRefreshAt = Timestamp.fromMillis(now.getTime() + (ttlSeconds * 1000));
      const dataPointRef = db.collection(MARKET_DATA).doc(symbol).collection(DATA_POINTS).doc(endpoint);
      
      await dataPointRef.set({
        lastUpdated: Timestamp.now(),
        nextRefreshAt,
        status: 'REFRESHED',
        ttlSeconds
      }, { merge: true });
      
      console.log(`rD rDP [${pacificTime} PT] Updated refresh time for ${symbol}/${endpoint} to ${nextRefreshAt.toDate().toISOString()}`);
      return;
    }
    
    // In production, call the function via HTTP
    const functionUrl = `${CLOUD_FUNCTIONS_BASE_URL}/${functionName}`;
    console.log(`rD rDP [${pacificTime} PT] Calling function at: ${functionUrl}`);
    
    const requestBody = {
      data: {
        symbol,
        endpoint,
        ttlSeconds,
        useMock: false, // Always use real data for refreshes
        forceRefresh: true, // Indicate this is a background refresh
        timestamp: Date.now()
      }
    };
    
    console.log(`rD rDP [${pacificTime} PT] Request body:`, JSON.stringify(requestBody, null, 2));
    
    const response = await fetch(functionUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${await getAuthToken()}`,
        'X-Cloud-Function': 'refreshDispatcher',
        'X-Requested-With': 'XMLHttpRequest'
      },
      body: JSON.stringify(requestBody)
    });
    
    if (!response.ok) {
      const errorText = await response.text().catch(() => 'No error details');
      throw new Error(`HTTP error! status: ${response.status}, body: ${errorText}`);
    }
    
    const responseData = await response.json();
    console.log(`rD rDP [${pacificTime} PT] Successfully refreshed ${symbol}/${endpoint}:`, responseData);
    
  } catch (error) {
    console.error(`rD rDP [${pacificTime} PT] Error refreshing ${symbol}/${endpoint}:`, error);
    
    try {
      // Log the error to Firestore for debugging
      await db.collection('refreshErrors').add({
        timestamp: Timestamp.now(),
        symbol,
        endpoint,
        error: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined
      });
    } catch (logError) {
      console.error('rD rDP Failed to log error to Firestore:', logError);
    }
    
    throw error; // Re-throw to allow callers to handle the error
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
  
  try {
    await refreshDataPoint(symbol, endpoint as DataMaintainerEndpoint, ttl);
    return { success: true };
  } catch (error) {
    console.error('Error in manual refresh:', error);
    throw new HttpsError('internal', 'Failed to refresh data', error);
  }
});

/**
 * Helper function to get auth token for function-to-function calls
 */
async function getAuthToken(): Promise<string> {
  // In test mode or emulator, use a dummy token
  if (TEST_MODE || process.env.FUNCTIONS_EMULATOR) {
    console.log('rD getAuthToken: Using dummy token for test/emulator mode');
    return 'dummy-auth-token';
  }
  
  try {
    const metadataServerTokenUrl = METADATA_SERVER_TOKEN_URL;
    console.log('rD getAuthToken: Fetching token from metadata server');
    
    const response = await fetch(metadataServerTokenUrl, {
      method: 'GET',
      headers: {
        'Metadata-Flavor': 'Google'
      },
      signal: AbortSignal.timeout(5000) // 5 second timeout
    });
    
    if (!response.ok) {
      throw new Error(`Failed to fetch token: ${response.status} ${response.statusText}`);
    }
    
    const tokenData = await response.json();
    return tokenData.access_token;
  } catch (error) {
    console.error('rD getAuthToken: Error fetching token:', error);
    
    // In test mode, return a dummy token if the real one can't be fetched
    if (TEST_MODE) {
      console.log('rD getAuthToken: Falling back to dummy token in test mode');
      return 'dummy-auth-token';
    }
    
    throw error;
  }
}

// This code block will only run in the emulator environment
if (process.env.FUNCTIONS_EMULATOR) {
  console.log('rD Emulator mode detected - starting automated test runner');
  
  // Wrap in an async IIFE to handle top-level await
  (async () => {
    const intervalMs = 60 * 1000; // 1 minute
    let runCount = 0;
    
    try {
      console.log(`rD Starting test runner - will run every ${intervalMs/1000} seconds`);
      
      // Define the refresh function
      const runRefresh = async () => {
        runCount++;
        console.log(`rD Running refresh #${runCount}...`);
        await refreshAllData();
      };
      
      // Run immediately
      await runRefresh();
      
      // Set up interval for continuous runs
      setInterval(runRefresh, intervalMs);
      
      // Log when the test runner starts
      console.log('rD Test runner started. Press Ctrl+C to stop.');
      
    } catch (error) {
      console.error('rD Error in emulator test runner:', error);
    }
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
