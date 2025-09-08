import { onRequest } from "firebase-functions/v2/https";
import { ListSymbolsOptions } from "@shared/alpha-vantage";
import { serializeTrackedSymbols } from "../common-dm";
import { symbolManagerService } from "../../alpha-vantage/services/symbol-manager.service";
import { authenticateRequestEither } from "../../utils/utils";

/**
 * HTTP endpoint for listing tracked symbols
 * GET /listSymbols?activeOnly=true&limit=100&offset=0&sortBy=symbol&sortDirection=asc
 */
export const listSymbolsV2 = onRequest({ 
  cors: true 
}, async (req, res) => {
  try {
    if (req.method !== 'GET') {
      res.status(405).json({ error: 'Method not allowed' });
      return;
    }

    // Require auth: Firebase ID token OR Google OIDC from allowlisted SAs
    const authResult = await authenticateRequestEither(req, res);
    if (!authResult) {
      return; // Response already sent
    }

    console.log('=============== START BE listSymbolsV2 ==============================');

    const options: ListSymbolsOptions = {
      activeOnly: req.query.activeOnly === undefined ? true : req.query.activeOnly === 'true',
      limit: req.query.limit ? parseInt(req.query.limit as string, 10) : 100,
      offset: req.query.offset ? parseInt(req.query.offset as string, 10) : 0,
      sortBy: (req.query.sortBy as 'symbol' | 'lastUpdated') || 'symbol',
      sortDirection: (req.query.sortDirection as 'asc' | 'desc') || 'asc'
    };

    console.log('lSV2 Calling symbolManagerService.listSymbolsV2 with options:', options);
    const result = await symbolManagerService.listSymbolsV2(options);

    // Use the helper to serialize symbols
    const symbols = serializeTrackedSymbols(result.symbols);
    
    console.log('lSV2 Successfully retrieved symbols:', { 
      count: symbols?.length, 
      total: result.total,
      hasSymbols: Array.isArray(symbols) && symbols.length > 0,
      firstFewSymbols: symbols?.slice(0, 2) // Log first few symbols if available
    });
    
    if (!symbols || symbols.length === 0) {
      console.warn('lSV2 No symbols returned from symbolManagerService.listSymbolsV2');
      // Log the query being used
      console.log('lSV2 Query parameters:', {
        activeOnly: options.activeOnly,
        limit: options.limit,
        offset: options.offset,
        sortBy: options.sortBy,
        sortDirection: options.sortDirection
      });
    }

    console.log('=============== END BE listSymbolsV2 ==============================');
    
    res.status(200).json({
      ...result,
      symbols
    });
  } catch (error: any) {
    console.error('lSV2 Error in listSymbolsV2:', {
      message: error.message,
      stack: error.stack,
      name: error.name,
      code: error.code,
      statusCode: error.statusCode,
      details: error.details
    });
    res.status(500).json({ 
      error: 'lSV2 Internal server error',
      message: error.message,
      details: process.env.NODE_ENV === 'development' ? error.stack : undefined
    });
  }
});
