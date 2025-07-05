import { onRequest } from "firebase-functions/v2/https";
import { Timestamp } from 'firebase-admin/firestore';
import { symbolManagerService } from "./symbolManager.service";

/**
 * HTTP endpoint for syncing symbols
 * POST /syncSymbols
 * Body: { symbols: string[] }
 */
export const syncSymbols = onRequest({ cors: true }, async (req, res) => {
  const requestId = Math.random().toString(36).substring(2, 10);
  const startTime = Date.now();
  
  console.log(`fn sS [${requestId}] syncSymbols request received`, {
    method: req.method,
    headers: req.headers,
    body: req.body,
    query: req.query
  });
  
  try {
    if (req.method !== 'POST') {
      const errorMsg = `fn sS [${requestId}] Method not allowed: ${req.method}`;
      console.warn(errorMsg);
      res.status(405).json({ 
        success: false,
        error: 'Method not allowed',
        allowedMethods: ['POST']
      });
      return;
    }

    const { symbols } = req.body;
    
    if (!Array.isArray(symbols)) {
      const errorMsg = `fn sS [${requestId}] Invalid request: symbols array is required`;
      console.warn(errorMsg, { received: typeof symbols });
      res.status(400).json({ 
        success: false,
        error: 'Invalid request',
        message: 'fn sS symbols array is required',
        received: typeof symbols
      });
      return;
    }

    console.log(`fn sS [${requestId}] Processing sync request for ${symbols.length} symbols`, {
      symbols: symbols.slice(0, 10), // Log first 10 symbols to avoid huge logs
      totalSymbols: symbols.length
    });

    // Call the service with the current timestamp and remove flag
    const timestamp = Timestamp.now();
    const { remove = false } = req.body;
    
    console.log(`fn sS [${requestId}] Calling symbolManagerService.syncSymbols`, { 
      timestamp,
      remove
    });
    
    const result = await symbolManagerService.syncSymbols({
      symbols,
      timestamp,
      remove
    });

    const duration = Date.now() - startTime;
    console.log(`fn sS [${requestId}] syncSymbols completed in ${duration}ms`, {
      result: {
        success: result.success,
        added: result.added,
        removed: result.removed,
        totalActive: result.totalActive
      },
      durationMs: duration
    });

    res.status(200).json(result);
  } catch (error: any) {
    const duration = Date.now() - startTime;
    const errorId = `err_${Date.now()}`;
    const errorDetails = {
      message: error.message,
      name: error.name,
      stack: error.stack,
      code: error.code,
      requestId,
      errorId,
      durationMs: duration
    };
    
    console.error(`fn sS [${requestId}] Error in syncSymbols after ${duration}ms:`, errorDetails);
    
    res.status(500).json({ 
      success: false, 
      error: 'Internal server error',
      errorId,
      message: error.message,
      timestamp: new Date().toISOString()
    });
  }
});
