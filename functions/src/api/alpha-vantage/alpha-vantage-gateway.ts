import { onRequest } from 'firebase-functions/v2/https';
import { Request, Response } from 'express';
import { AlphaVantageHandlerFactory } from './alpha-vantage-factory';
import { AlphaVantageEndpoint } from '../../common/common-av';

/**
 * API Gateway for all Alpha Vantage endpoints
 * Routes requests to the appropriate handler based on the endpoint path
 * Example: /alpha-vantage/TIME_SERIES_DAILY?symbol=IBM
 */
export const alphaVantageApi = onRequest(
  { 
    secrets: ['ALPHAVANTAGE_API_KEY'],
    cors: true,
    memory: '256MiB',
    maxInstances: 10,
    timeoutSeconds: 60
  },
  async (req: Request, res: Response) => {
    const requestId = Math.random().toString(36).substring(2, 10);
    const startTime = Date.now();
    
    // Log incoming request
    console.log(`aVG aVA [${requestId}] [GATEWAY] Incoming request: ${req.method} ${req.url}`);
    console.log(`aVG aVA [${requestId}] [GATEWAY] Headers:`, JSON.stringify(req.headers));
    console.log(`aVG aVA [${requestId}] [GATEWAY] Query params:`, JSON.stringify(req.query));

    try {
      // Extract endpoint from URL path (e.g., 'TIME_SERIES_DAILY' from '/alpha-vantage/TIME_SERIES_DAILY')
      const endpoint = req.path.split('/').pop() as AlphaVantageEndpoint;
      console.log(`aVG aVA [${requestId}] [GATEWAY] Extracted endpoint: ${endpoint}`);
      
      if (!endpoint) {
        const error = new Error('No endpoint specified in URL');
        console.error(`aVG aVA [${requestId}] [GATEWAY] Error: ${error.message}`);
        res.status(400).json({ error: error.message });
        return;
      }

      // Get the list of valid endpoints from the factory
      const validEndpoints = AlphaVantageHandlerFactory.getAvailableEndpoints();
      console.log(`aVG aVA [${requestId}] [GATEWAY] Valid endpoints:`, validEndpoints);
      
      // Check if the endpoint is valid
      if (!validEndpoints.includes(endpoint as AlphaVantageEndpoint)) {
        const error = new Error(`Invalid endpoint: ${endpoint}. Valid endpoints are: ${validEndpoints.join(', ')}`);
        console.error(`aVG aVA [${requestId}] [GATEWAY] Error: ${error.message}`);
        res.status(404).json({ error: error.message });
        return;
      }

      // Get the endpoint config and create the appropriate handler
      console.log(`aVG aVA [${requestId}] [GATEWAY] Creating handler for endpoint: ${endpoint}`);
      const endpointConfig = AlphaVantageHandlerFactory.getEndpointConfig(endpoint as AlphaVantageEndpoint);
      const handler = AlphaVantageHandlerFactory.createHandler(endpoint as AlphaVantageEndpoint);
      
      // Get query parameters and handle the request
      const params = { ...req.query };
      console.log(`aVG aVA [${requestId}] [GATEWAY] Processing request with params:`, JSON.stringify(params));
      
      const response = await handler.fetch(params);
      
      // Log successful response
      console.log(`aVG aVA [${requestId}] [GATEWAY] Request processed successfully in ${Date.now() - startTime}ms`);
      
      // Transform the response to match frontend expectations
      const frontendResponse = {
        data: response,
        metadata: {
          endpoint: endpointConfig.id,
          timestamp: new Date().toISOString(),
          requestId,
          processingTimeMs: Date.now() - startTime
        }
      };

      res.status(200).json(frontendResponse);
    } catch (error: any) {
      const errorResponse = {
        error: error.message || 'An unknown error occurred',
        code: error.code || 'UNKNOWN_ERROR',
        details: error.details || {},
        timestamp: new Date().toISOString(),
        requestId,
        processingTimeMs: Date.now() - startTime
      };
      
      console.error(`aVG aVA [${requestId}] [GATEWAY] Error:`, error);
      res.status(error.statusCode || 500).json(errorResponse);
    }
  }
);
