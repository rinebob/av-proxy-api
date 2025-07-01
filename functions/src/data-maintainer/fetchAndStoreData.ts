// Cloud Function stub for fetching fresh data from AV/BZ and storing in Firestore
// This will be triggered by scheduler/tasks with a payload: { symbol, endpoint }

import { onRequest } from "firebase-functions/v2/https";

// import { db } from "../firebase-admin-init";
// import { MARKET_DATA } from "../common/firestore-collections";
import { AvCompanyOverviewHandler } from './api-handlers/av-company-overview';
import { authenticateRequest } from '../utils';
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
  console.log('fn fASD fetchAndStoreData triggered.');
  try {
    // Authenticate request (require Firebase ID token)
    const decodedToken = await authenticateRequest(req, res);
    if (!decodedToken) return; // Auth failed, response already sent

    const symbol = req.body?.symbol || req.query?.symbol;
    const endpoint = req.body?.endpoint || req.query?.endpoint;
    console.log(`fn fASD Params: symbol=${symbol}, endpoint=${endpoint}`);
    if (!symbol || !endpoint) {
      res.status(400).json({ error: 'Missing symbol or endpoint' });
      return;
    }
    if (endpoint !== 'company-overview') {
      res.status(400).json({ error: 'Only company-overview endpoint is supported in this version.' });
      return;
    }
    // Fetch data from handler
    const handler = new AvCompanyOverviewHandler();
    const data = await handler.fetchAndTransform(symbol);
    console.log(`fn fASD Data fetched for symbol=${symbol}:`, data);
    // Save to Firestore
    // const docRef = db.collection(MARKET_DATA)
    //   .doc(symbol)
    //   .collection('data_points')
    //   .doc(endpoint);
    // await docRef.set({
    //   data,
    //   lastUpdated: new Date(),
    //   status: 'success',
    // }, { merge: true });
    res.status(200).json({ ok: true, symbol, endpoint, data });
    console.log(`fn fASD Response sent for symbol=${symbol}, endpoint=${endpoint}`);
  } catch (error: any) {
    console.error(`fn fASD ERROR:`, error);
    res.status(500).json({ error: error?.message || 'Unknown error', details: error });
  }
});
