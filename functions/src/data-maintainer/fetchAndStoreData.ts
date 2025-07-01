// =======================================
// CLOUD FUNCTION: fetchAndStoreData
// VERSION: 1.0.2 - Added request body parsing and debug logs
// =======================================
console.log('\n\n\n=== dude - fetchAndStoreData.ts LOADED - VERSION 1.0.2 ===\n\n\n');

// Version identifier - increment with each deployment
const VERSION = '1.0.2';

import { onRequest } from "firebase-functions/v2/https";
import { db } from "../firebase-admin-init";

interface RequestBody {
  symbol?: string;
  endpoint?: string;
  useMock?: boolean;
}
import { MARKET_DATA } from "../common/firestore-collections";
import { AvCompanyOverviewHandler } from './api-handlers/av-company-overview';
import { authenticateRequest } from '../utils';
import { getMockCompanyOverview } from './mock-data/company-overview.mock';
/**
 * fetchAndStoreData Cloud Function
 *
 * - Triggered with { symbol, endpoint } payload
 * - Will fetch from the correct API, update Firestore under /market_data/{symbol}/data_points/{endpoint}
 * - Will set lastUpdated, nextRefreshAt, ttlSeconds, status, data, errorDetails
 * - For now, this is just a stub for review
 */
export const fetchAndStoreData = onRequest({
  secrets: ['ALPHAVANTAGE_API_KEY'],
  cors: true
}, async (req, res) => {
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
    // Use the mock data flag from the request
    const useMockData = Boolean(useMock);
    console.log(`fn fASD Will use mock data: ${useMockData} (after Boolean conversion)`);
    
    let data: any;
    
    if (useMockData) {
      console.log(`fn fASD Using MOCK data for symbol=${symbol}`);
      const mockData = getMockCompanyOverview(symbol);
      if (!mockData) {
        throw new Error(`No mock data available for symbol: ${symbol}`);
      }
      data = mockData;
    } else {
      // Fetch real data from Alpha Vantage
      console.log(`fn fASD Fetching REAL data for symbol=${symbol}`);
      const handler = new AvCompanyOverviewHandler();
      data = await handler.fetchAndTransform(symbol);
    }
    
    console.log(`fn fASD Data ${useMockData ? 'mock ' : ''}fetched for symbol=${symbol}:`, data);
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
    res.status(200).json({ ok: true, symbol, endpoint, data });
    console.log(`fn fASD Response sent for symbol=${symbol}, endpoint=${endpoint}`);
  } catch (error: any) {
    console.error(`fn fASD ERROR:`, error);
    res.status(500).json({ error: error?.message || 'Unknown error', details: error });
  }
});
