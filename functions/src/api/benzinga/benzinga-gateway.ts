import { onRequest } from 'firebase-functions/v2/https';
import { Request, Response } from 'express';
import { BenzingaEndpoint } from '../../common/common-benz';
import { BenzingaHandlerFactory } from './benzinga-factory';
import { 
  authenticateRequest, 
  handleApiError,
  handleOptionsRequest
} from '../../utils/utils';
import { BenzingaFunctionName } from '../../common/common-fn';

/**
 * Benzinga API Gateway
 * 
 * Handles all Benzinga API requests through a single entry point.
 * Routes requests to the appropriate handler based on the endpoint.
 */
export const benzingaApi = onRequest(
  {
    secrets: ['BENZINGA_CALENDAR_API_KEY'],
    memory: '256MiB',
    cors: true, // Enable CORS for all origins
  },
  async (req: Request, res: Response) => {
    const requestId = Math.random().toString(36).substring(2, 10);
    const startTime = Date.now();

    if (handleOptionsRequest(req, res)) {
      return;
    }
    
    try {
      console.log(`bZG bzA [${requestId}] [GATEWAY] Incoming request: ${req.method} ${req.url}`);
      console.log(`bZG bzA [${requestId}] [GATEWAY] Headers:`, JSON.stringify(req.headers));
      console.log(`bZG bzA [${requestId}] [GATEWAY] Query params:`, JSON.stringify(req.query));
      
      // Authenticate the request
      const decodedToken = await authenticateRequest(req, res);
      if (!decodedToken) {
        return; // Authentication failed, response already sent
      }

      // The endpoint is determined by the 'type' query parameter.
      const endpoint = req.query.type as BenzingaEndpoint;
      console.log(`bZG bzA [${requestId}] [GATEWAY] Resolved endpoint from 'type' query param: ${endpoint}`);
      
      if (!endpoint) {
        res.status(400).json({ 
          error: 'Bad Request', 
          message: 'No endpoint specified in URL path' 
        });
        return;
      }

      // Get valid endpoints from factory
      const validEndpoints = BenzingaHandlerFactory.getAvailableEndpoints();
      
      // Check if the endpoint is valid
      if (!validEndpoints.includes(endpoint as BenzingaEndpoint)) {
        res.status(404).json({ 
          error: 'Not Found', 
          message: `No handler found for endpoint: ${endpoint}` 
        });
        return;
      }

      // Get the appropriate handler from factory
      const handler = BenzingaHandlerFactory.createHandler(endpoint);
      
      if (!handler) {
        res.status(404).json({ 
          error: 'Not Found', 
          message: `No handler found for endpoint: ${endpoint}` 
        });
        return;
      }

      console.log(`bZG bzA [${requestId}] [GATEWAY] Processing ${endpoint} request...`);
      console.log(`bZG bzA [${requestId}] [GATEWAY] Query params:`, JSON.stringify(req.query));
      
      // Process the request using the handler with all query parameters
      const requestParams = { ...req.query };
      

      // Log the final parameters being sent to the handler
      console.log(`bZG bzA [${requestId}] [GATEWAY] Final request params:`, JSON.stringify(requestParams));
      
      // Use the public fetch method to handle the request
      const response = await handler.fetch(requestParams);

      // Send the raw API response
      res.status(200).json(response);
      
    } catch (error: unknown) {
      if (!handleApiError(error, res, BenzingaFunctionName.GET_CALENDAR)) {
        console.error(`bZG bzA [${requestId}] [GATEWAY] Unhandled error:`, error);
        res.status(500).json({ 
          error: 'Internal Server Error',
          message: 'An unexpected error occurred'
        });
      }
    } finally {
      console.log(`bZG bzA [${requestId}] [GATEWAY] Request completed in ${Date.now() - startTime}ms`);
    }
  }
);
