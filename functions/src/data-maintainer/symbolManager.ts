/**
 * symbolManager Cloud Function
 *
 * - POST: Add or update a tracked symbol (with source)
 * - DELETE: Remove a source from a symbol, or deactivate symbol if no sources remain
 * - GET: List all tracked symbols
 */
import { onRequest } from "firebase-functions/v2/https";
// Import shared admin and db from firebase-admin-init
import { db, admin } from "../firebase-admin-init";

import { TRACKED_SYMBOLS } from "../common/firestore-collections";

export const symbolManager = onRequest({
  cors: true
}, async (req, res) => {
  try {
    if (req.method === "POST") {
      /**
       * Add or update a tracked symbol
       * Body: { symbol: string, source: string }
       */
      const { symbol, source } = req.body;
      if (!symbol || !source) {
        res.status(400).json({ error: "Missing symbol or source" });
        return;
      }
      const symbolRef = db.collection(TRACKED_SYMBOLS).doc(symbol);
      const doc = await symbolRef.get();
      if (doc.exists) {
        // Update sources array, set isActive true
        const data = doc.data();
        const sources = Array.isArray(data?.sources) ? data.sources : [];
        if (!sources.includes(source)) {
          sources.push(source);
        }
        await symbolRef.update({
          sources,
          isActive: true
        });
      } else {
        // Create new doc
        await symbolRef.set({
          symbol,
          dateAdded: admin.firestore.FieldValue.serverTimestamp(),
          isActive: true,
          sources: [source]
        });
      }
      res.status(200).json({ message: "Symbol tracked", symbol });
      return;
    }
    if (req.method === "DELETE") {
      /**
       * Remove a source from a tracked symbol
       * Body: { symbol: string, source: string }
       */
      const { symbol, source } = req.body;
      if (!symbol || !source) {
        res.status(400).json({ error: "Missing symbol or source" });
        return;
      }
      const symbolRef = db.collection(TRACKED_SYMBOLS).doc(symbol);
      const doc = await symbolRef.get();
      if (!doc.exists) {
        res.status(404).json({ error: "Symbol not found" });
        return;
      }
      const data = doc.data();
      let sources = Array.isArray(data?.sources) ? data.sources : [];
      sources = sources.filter((s: string) => s !== source);
      if (sources.length === 0) {
        // No sources left, deactivate symbol
        await symbolRef.update({
          sources: [],
          isActive: false
        });
      } else {
        await symbolRef.update({ sources });
      }
      res.status(200).json({ message: "Source removed", symbol, sources });
      return;
    }
    if (req.method === "GET") {
      /**
       * List all tracked symbols
       */
      const snapshot = await db.collection(TRACKED_SYMBOLS).where("isActive", "==", true).get();
      const symbols = snapshot.docs.map(doc => doc.data());
      res.status(200).json({ trackedSymbols: symbols });
      return;
    }
    res.status(405).json({ error: "Method not allowed" });
  } catch (err: any) {
    console.error("symbolManager error", err);
    res.status(500).json({ error: "Internal server error", details: err?.message });
  }
});
