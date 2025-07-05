import { onRequest } from 'firebase-functions/v2/https';
import { 
  getAlphaVantageApiKey, 
  handleApiError,
  authenticateRequest
} from '../utils/utils';
import { AvSymbolSearchHandler } from '../data-maintainer/api-handlers/av-symbol-search';
import { TrackedSymbol } from '../common/common-dm';

interface SymbolSearchResponse {
  success: boolean;
  count: number;
  matches: TrackedSymbol[];
  information?: string;
  note?: string;
  error?: string;
}

/**
 * Cloud Function for searching symbols using Alpha Vantage's SYMBOL_SEARCH endpoint
 * 
 * @example
 * // Search for symbols matching 'microsoft'
 * GET /symbolSearch?keywords=microsoft
 * 
 * // Search without automatic tracking
 * GET /symbolSearch?keywords=apple&autotrack=false
 */
export const symbolSearch = onRequest(
  {
    secrets: ['ALPHAVANTAGE_API_KEY'],
    cors: true,
    memory: '256MiB',
  },
  async (req, res) => {
    console.info('----------- symbolSearch ---------------');

    try {
      // Authenticate the request
      const decodedToken = await authenticateRequest(req, res);
      if (!decodedToken) {
        return; // Authentication failed, response already sent
      }

      // Get client ID from the authenticated user
      const clientId = decodedToken.uid;
      
      // Validate query parameters
      const { keywords, autotrack = 'true' } = req.query;
      
      if (!keywords || typeof keywords !== 'string' || keywords.trim().length === 0) {
        const errorResponse: SymbolSearchResponse = {
          success: false,
          count: 0,
          matches: [],
          error: 'Keywords parameter is required for symbol search'
        };
        res.status(400).json(errorResponse);
        return;
      }

      // Get the API key
      const apiKey = getAlphaVantageApiKey();
      if (!apiKey) {
        const errorResponse: SymbolSearchResponse = {
          success: false,
          count: 0,
          matches: [],
          error: 'Alpha Vantage API key not configured'
        };
        res.status(500).json(errorResponse);
        return;
      }

      // Create handler and fetch data
      const handler = new AvSymbolSearchHandler();
      const shouldTrack = autotrack === 'true' || autotrack === '1';
      
      try {
        const result = await handler.fetchAndTransform(
          keywords,
          shouldTrack ? clientId : undefined
        );

        // Handle different response types
        if (result.errorMessage) {
          const errorResponse: SymbolSearchResponse = {
            success: false,
            count: 0,
            matches: [],
            error: result.errorMessage
          };
          res.status(400).json(errorResponse);
          return;
        }

        if (result.information) {
          const response: SymbolSearchResponse = {
            success: false,
            count: 0,
            matches: [],
            information: result.information,
            error: 'API rate limit exceeded'
          };
          res.status(429).json(response);
          return;
        }

        if (result.note) {
          const response: SymbolSearchResponse = {
            success: false,
            count: 0,
            matches: [],
            note: result.note,
            error: 'API rate limit note'
          };
          res.status(503).json(response);
          return;
        }

        // Successful response with matches
        const successResponse: SymbolSearchResponse = {
          success: true,
          count: result.matches.length,
          matches: result.matches
        };
        
        res.status(200).json(successResponse);

      } catch (error) {
        console.error('Error in symbol search handler:', error);
        const errorResponse: SymbolSearchResponse = {
          success: false,
          count: 0,
          matches: [],
          error: error instanceof Error ? error.message : 'Internal server error'
        };
        res.status(500).json(errorResponse);
      }

    } catch (error) {
      console.error('Error in symbolSearch:', error);
      handleApiError(error, res, 'symbolSearch');
    }
  }
);
