import { onRequest } from "firebase-functions/v2/https";
import { ListSymbolsOptions } from "../common/common-dm";
import { symbolManagerService } from "./symbolManager.service";



/**
 * HTTP endpoint for listing tracked symbols
 * GET /listSymbols?activeOnly=true&limit=100&offset=0&sortBy=symbol&sortDirection=asc
 */
export const listSymbols = onRequest({ 
  secrets: ['ALPHAVANTAGE_API_KEY'],
  cors: true 
}, async (req, res) => {
  try {
    if (req.method !== 'GET') {
      res.status(405).json({ error: 'Method not allowed' });
      return;
    }

    const options: ListSymbolsOptions = {
      activeOnly: req.query.activeOnly !== 'false',
      limit: req.query.limit ? parseInt(req.query.limit as string, 10) : 100,
      offset: req.query.offset ? parseInt(req.query.offset as string, 10) : 0,
      sortBy: (req.query.sortBy as 'symbol' | 'lastUpdated') || 'symbol',
      sortDirection: (req.query.sortDirection as 'asc' | 'desc') || 'asc'
    };

    console.log('Calling symbolManagerService.listSymbols with options:', options);
    const result = await symbolManagerService.listSymbols(options);
    
    console.log('Successfully retrieved symbols:', { 
      count: result.symbols?.length, 
      total: result.total,
      hasSymbols: Array.isArray(result.symbols) && result.symbols.length > 0,
      firstFewSymbols: result.symbols?.slice(0, 3) // Log first few symbols if available
    });
    
    if (!result.symbols || result.symbols.length === 0) {
      console.warn('No symbols returned from symbolManagerService.listSymbols');
      // Log the query being used
      console.log('Query parameters:', {
        activeOnly: options.activeOnly,
        limit: options.limit,
        offset: options.offset,
        sortBy: options.sortBy,
        sortDirection: options.sortDirection
      });
    }
    
    res.status(200).json(result);
  } catch (error: any) {
    console.error('Error in listSymbols:', {
      message: error.message,
      stack: error.stack,
      name: error.name,
      code: error.code,
      statusCode: error.statusCode,
      details: error.details
    });
    res.status(500).json({ 
      error: 'Internal server error',
      message: error.message,
      details: process.env.NODE_ENV === 'development' ? error.stack : undefined
    });
  }
});
