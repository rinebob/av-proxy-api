// =======================================
// CLOUD FUNCTION: fetchAndStoreData
// VERSION: 1.0.2 - Added request body parsing and debug logs
// =======================================
console.log('\n\n\n=== dude - fetchAndStoreData.ts LOADED - VERSION 1.0.2 ===\n\n\n');

// Version identifier - increment with each deployment
const VERSION = '1.0.2';

import { onRequest } from 'firebase-functions/v2/https';
import { authenticateRequest } from '../utils';
import { MARKET_DATA } from "../common/firestore-collections";
import { AvCompanyOverviewHandler } from './api-handlers/av-company-overview';
import { DataMaintainerEndpoint } from '../common/common-dm';
import { mockDataService, registerAllMockData } from './mock-data';
import { db } from "../firebase-admin-init";

// Initialize mock data on module load
console.log('Initializing mock data...');
registerAllMockData();
console.log('Mock data initialization complete');

interface RequestBody {
  symbol?: string;
  endpoint?: string;
  useMock?: boolean;
}
/**
 * fetchAndStoreData Cloud Function
 *
 * - Triggered with { symbol, endpoint } payload
 * - Will fetch from the correct API, update Firestore under /market_data/{symbol}/data_points/{endpoint}
 * - Will set lastUpdated, nextRefreshAt, ttlSeconds, status, data, errorDetails
 * - For now, this is just a stub for review
 */
export const fetchAndStoreData = onRequest(
  { secrets: ['ALPHAVANTAGE_API_KEY'], cors: true },
  async (req, res) => {
  console.log('--------- fn fASD fetchAndStoreData ----------------------.')
  console.log(`fn fASD fetchAndStoreData v${VERSION} triggered.`);
  try {
    // Authenticate request (require Firebase ID token)
    const decodedToken = await authenticateRequest(req, res);
    if (!decodedToken) return; // Auth failed, response already sent

    const symbol = req.body?.symbol || req.query?.symbol;
    const endpoint = req.body?.endpoint || req.query?.endpoint;
    // Ensure we're parsing the body as JSON
    let requestBody: RequestBody = {};
    if (typeof req.body === 'string') {
      try {
        requestBody = JSON.parse(req.body);
      } catch (e) {
        console.error('fn fASD Error parsing request body:', e);
      }
    } else {
      requestBody = req.body || {};
    }

    // Get useMock flag from request, default to true if not provided
    const useMock = requestBody?.useMock ?? req.query?.useMock ?? true;
    
    console.log('fn fASD Raw request body:', req.body);
    console.log('fn fASD Parsed request body:', requestBody);
    console.log('fn fASD Request query:', req.query);
    console.log(`fn fASD Parsed params: symbol=${symbol}, endpoint=${endpoint}, useMock=${useMock} (type: ${typeof useMock})`);
    
    if (!symbol || !endpoint) {
      res.status(400).json({ error: 'Missing symbol or endpoint' });
      return;
    }
    if (endpoint !== 'company-overview') {
      res.status(400).json({ error: 'Only company-overview endpoint is supported in this version.' });
      return;
    }
    let data: any = null;
    
    // Check for mock data first if useMock is true
    if (useMock) {
      console.log(`fn fASD Checking for mock data for symbol=${symbol}, endpoint=${endpoint}`);
      
      if (!mockDataService.has(endpoint as DataMaintainerEndpoint, symbol)) {
        const errorMsg = `No mock data available for symbol=${symbol}, endpoint=${endpoint}. ` +
                        `Use useMock=false to fetch real data.`;
        console.error(`fn fASD ${errorMsg}`);
        res.status(404).json({ 
          error: errorMsg,
          availableEndpoints: Array.from(mockDataService.getEndpoints()),
          availableSymbols: mockDataService.getSymbols(endpoint as DataMaintainerEndpoint)
        });
        return;
      }
      
      const mockData = mockDataService.get(endpoint as DataMaintainerEndpoint, symbol);
      if (mockData) {
        console.log(`fn fASD Using MOCK data for symbol=${symbol}, endpoint=${endpoint}`);
        data = mockData;
      } else {
        const errorMsg = `Failed to load mock data for symbol=${symbol}, endpoint=${endpoint}`;
        console.error(`fn fASD ${errorMsg}`);
        res.status(500).json({ error: errorMsg });
        return;
      }
    } else {
      // Fetch real data from Alpha Vantage
      console.log(`fn fASD Fetching REAL data for symbol=${symbol}, endpoint=${endpoint}`);
      
      // Use the appropriate handler based on the endpoint
      if (endpoint === DataMaintainerEndpoint.COMPANY_OVERVIEW) {
        const handler = new AvCompanyOverviewHandler();
        data = await handler.fetchAndTransform(symbol);
      } else {
        throw new Error(`Unsupported endpoint: ${endpoint}`);
      }
    }
    
    console.log(`fn fASD Data ${useMock ? 'mock ' : ''}fetched for symbol=${symbol}:`, data);
    // Save to Firestore
    const docRef = db.collection(MARKET_DATA)
      .doc(symbol)
      .collection('data_points')
      .doc(endpoint);
    
    const updateData = {
      data,
      lastUpdated: new Date(),
      status: 'success',
      symbol,
      endpoint,
      nextRefreshAt: new Date(Date.now() + 24 * 60 * 60 * 1000), // 24 hours from now
      ttlSeconds: 24 * 60 * 60 // 24 hours in seconds
    };
    
    console.log(`fn fASD Saving to Firestore:`, { symbol, endpoint });
    await docRef.set(updateData, { merge: true });
    console.log(`fn fASD Successfully saved to Firestore for ${symbol}/${endpoint}`);
    res.status(200).json({ 
      ok: true, 
      symbol, 
      endpoint, 
      data,
      dataSource: useMock ? 'mock' : 'alpha_vantage',
      timestamp: new Date().toISOString()
    });
    console.log(`fn fASD Response sent for symbol=${symbol}, endpoint=${endpoint}`);
  } catch (error: any) {
    console.error(`fn fASD ERROR:`, error);
    res.status(500).json({ error: error?.message || 'Unknown error', details: error });
  }
});
