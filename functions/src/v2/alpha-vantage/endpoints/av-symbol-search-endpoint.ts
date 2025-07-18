import { onRequest } from 'firebase-functions/v2/https';
import { AlphaVantageHandlerFactory } from '../alpha-vantage-factory';
import { AlphaVantageEndpoint } from '../../common/common-av';
import { logger } from 'firebase-functions';

/**
 * HTTP endpoint for searching symbols using Alpha Vantage's SYMBOL_SEARCH endpoint
 * 
 * GET /v2/alpha-vantage/symbol-search?keywords=:keywords
 * 
 * @param keywords - The search keywords (e.g., 'microsoft')
 * @returns JSON response with search results
 */
export const symbolSearch = onRequest(
  { 
    cors: true,
    secrets: ['ALPHAVANTAGE_API_KEY'],
    memory: '256MiB',
    maxInstances: 10,
    timeoutSeconds: 30
  },
  async (req, res) => {
    const requestId = Math.random().toString(36).substring(2, 10);
    const startTime = Date.now();
    
    // Log incoming request
    logger.info(`[${requestId}] [SYMBOL_SEARCH] Incoming request`, {
      method: req.method,
      url: req.url,
      query: req.query,
      ip: req.ip,
      userAgent: req.get('user-agent')
    });

    // Only allow GET requests
    if (req.method !== 'GET') {
      const error = 'Method not allowed';
      logger.warn(`[${requestId}] [SYMBOL_SEARCH] ${error}`, { method: req.method });
      
      res.status(405).json({ 
        success: false, 
        error,
        allowedMethods: ['GET']
      });
      return;
    }

    try {
      const { keywords } = req.query;
      
      // Validate required parameters
      if (!keywords) {
        const error = 'Missing required parameter: keywords';
        logger.warn(`[${requestId}] [SYMBOL_SEARCH] ${error}`);
        
        res.status(400).json({ 
          success: false, 
          error,
          example: '/v2/alpha-vantage/symbol-search?keywords=microsoft'
        });
        return;
      }

      logger.info(`[${requestId}] [SYMBOL_SEARCH] Processing search`, { 
        keywords,
        requestId
      });

      // Create the handler for SYMBOL_SEARCH
      const handler = AlphaVantageHandlerFactory.createHandler(
        AlphaVantageEndpoint.SYMBOL_SEARCH
      );

      // Execute the search
      const result = await handler.fetch({ 
        keywords: Array.isArray(keywords) ? keywords[0] : keywords
      });

      // Log successful response
      logger.info(`[${requestId}] [SYMBOL_SEARCH] Search completed`, {
        keywords,
        resultCount: result.data?.bestMatches?.length || 0,
        duration: `${Date.now() - startTime}ms`
      });

      // Return the search results as JSON
      res.status(200).json({
        success: true,
        data: result.data,
        metadata: {
          ...result.metadata,
          requestId,
          timestamp: new Date().toISOString(),
          duration: `${Date.now() - startTime}ms`
        }
      });

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      const errorStack = error instanceof Error ? error.stack : undefined;
      
      logger.error(`[${requestId}] [SYMBOL_SEARCH] Error processing request`, {
        error: errorMessage,
        stack: errorStack,
        query: req.query,
        ip: req.ip,
        duration: `${Date.now() - startTime}ms`
      });

      res.status(500).json({
        success: false,
        error: 'Failed to perform symbol search',
        message: errorMessage,
        requestId,
        timestamp: new Date().toISOString()
      });
    }
  }
);
