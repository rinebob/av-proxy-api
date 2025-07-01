// Cloud Function stub for fetching fresh data from AV/BZ and storing in Firestore
// This will be triggered by scheduler/tasks with a payload: { symbol, endpoint }

import { onRequest } from "firebase-functions/v2/https";
import { db, admin } from "../firebase-admin-init";
import { MARKET_DATA } from "../common/firestore-collections";

/**
 * fetchAndStoreData Cloud Function
 *
 * - Triggered with { symbol, endpoint } payload
 * - Will fetch from the correct API, update Firestore under /market_data/{symbol}/data_points/{endpoint}
 * - Will set lastUpdated, nextRefreshAt, ttlSeconds, status, data, errorDetails
 * - For now, this is just a stub for review
 */
export const fetchAndStoreData = onRequest({
  cors: true
}, async (req, res) => {
  // TODO: Implement data fetching and Firestore write logic
  res.status(501).json({ message: "Not implemented yet." });
});
