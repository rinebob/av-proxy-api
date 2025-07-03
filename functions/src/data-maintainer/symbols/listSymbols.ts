import { onRequest } from "firebase-functions/v2/https";
import { ListSymbolsOptions } from "../../common/common-dm";
import { symbolManagerService } from "./symbolManager.service";

/**
 * HTTP endpoint for listing tracked symbols
 * GET /listSymbols?activeOnly=true&limit=100&offset=0&sortBy=symbol&sortDirection=asc
 */
export const listSymbols = onRequest({ cors: true }, async (req, res) => {
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

    const result = await symbolManagerService.listSymbols(options);
    res.status(200).json(result);
  } catch (error: any) {
    console.error('Error in listSymbols:', error);
    res.status(500).json({ 
      error: 'Internal server error',
      details: error.message 
    });
  }
});
