import { Request as ExpressRequest } from 'express';
import { BenzingaEndpoint, CompanyDataEndpoint } from '../../common/common-benz';
import { BenzingaBaseHandler } from './handlers/benzinga-base.handler';
import { BenzingaHandlerFactory } from './benzinga-factory';

/**
 * Handler map type that maps endpoint names to their respective handlers
 */
type HandlerMap = {
  [key in BenzingaEndpoint]?: BenzingaBaseHandler<any>;
};

/**
 * Handles Benzinga API requests by routing them to the appropriate endpoint handler
 * @param endpoint The Benzinga endpoint being requested
 * @param req The Express request object
 * @param requestId Unique request ID for logging
 * @returns The raw response data from Benzinga API
 */
export async function handleBenzingaRequest(
  endpoint: BenzingaEndpoint,
  req: ExpressRequest,
  requestId: string
): Promise<any> {
  try {
    // Get the appropriate handler for the endpoint
    const handler = getHandler(endpoint);
    
    // Process the request using the handler and return the raw response
    const result = await handler.handleRequest(req.query, requestId);
    
    // Return the raw response without any wrapping
    return result;
  } catch (error: unknown) {
    console.error(`[${requestId}] Error in handleBenzingaRequest:`, error);
    // Re-throw the error to be handled by the gateway
    throw error;
  }
}

/**
 * Gets the appropriate handler for the given endpoint
 * @param endpoint The Benzinga endpoint
 * @returns The handler instance for the endpoint
 */
function getHandler(endpoint: BenzingaEndpoint): BenzingaBaseHandler<any> {
  // Initialize handlers map
  const handlers: HandlerMap = {
    // Add calendar handler for earnings endpoint
    [CompanyDataEndpoint.EARNINGS as BenzingaEndpoint]: BenzingaHandlerFactory.createHandler(CompanyDataEndpoint.EARNINGS as BenzingaEndpoint),
    // Add more handlers here as they are implemented
  };

  const handler = handlers[endpoint];
  
  if (!handler) {
    throw new Error(`No handler implemented for endpoint: ${endpoint}`);
  }
  
  return handler;
}

// Export handler types for use in other files
export * from './handlers/benzinga-base.handler';
