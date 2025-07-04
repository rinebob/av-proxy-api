import { onRequest } from "firebase-functions/v2/https";
import { Timestamp } from 'firebase-admin/firestore';
import { symbolManagerService } from "./symbolManager.service";

/**
 * HTTP endpoint for syncing symbols from client sites
 * POST /syncSymbols
 * Body: { clientId: string, clientName?: string, symbols: string[], metadata?: any }
 */
export const syncSymbols = onRequest({ cors: true }, async (req, res) => {
  try {
    if (req.method !== 'POST') {
      res.status(405).json({ error: 'Method not allowed' });
      return;
    }

    const { clientId, clientName, symbols, metadata } = req.body;
    
    if (!clientId || !Array.isArray(symbols)) {
      res.status(400).json({ 
        error: 'Missing required fields', 
        required: ['clientId', 'symbols'] 
      });
      return;
    }

    // Call the service with the current timestamp
    const result = await symbolManagerService.syncSymbols({
      clientId,
      clientName,
      symbols,
      metadata,
      timestamp: Timestamp.now()
    });

    res.status(200).json(result);
  } catch (error: any) {
    console.error('Error in syncSymbols:', error);
    res.status(500).json({ 
      success: false, 
      error: 'Internal server error',
      details: error.message 
    });
  }
});
