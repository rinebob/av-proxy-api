import { Request as ExpressRequest } from 'express';
import { BenzingaEndpoint, BzCompanyDataCalendarType, BzCalendarType, BzMarketDataCalendarType } from '../../common/common-benz';
import { BenzingaBaseHandler } from './handlers/benzinga-base.handler';
import { BenzingaHandlerFactory } from './benzinga-factory';

/**
 * Union type of all possible handler keys
 */
type HandlerKey = BenzingaEndpoint | BzCalendarType;


/**
 * Handles Benzinga API requests by routing them to the appropriate endpoint handler
 * @param endpoint The Benzinga endpoint being requested
 * @param req The Express request object
 * @param requestId Unique request ID for logging
 * @returns The raw response data from Benzinga API
 */
export async function handleBenzingaRequest(
  endpoint: HandlerKey,
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
 * Maps calendar types to their corresponding endpoint values
 */
function mapCalendarTypeToEndpoint(calendarType: BzCalendarType): BenzingaEndpoint {
  // For now, we'll just cast since we know the values align
  // In a more complex scenario, we might need a proper mapping
  return calendarType as unknown as BenzingaEndpoint;
}

/**
 * Gets the appropriate handler for the given endpoint
 * @param endpoint The Benzinga endpoint or calendar type
 * @returns The handler instance for the endpoint
 */
function getHandler(endpoint: HandlerKey): BenzingaBaseHandler<any> {
  // Convert calendar type to endpoint if needed
  const endpointKey = (Object.values(BzCompanyDataCalendarType).includes(endpoint as BzCompanyDataCalendarType) ||
                      Object.values(BzMarketDataCalendarType).includes(endpoint as BzMarketDataCalendarType))
    ? mapCalendarTypeToEndpoint(endpoint as BzCalendarType)
    : endpoint as BenzingaEndpoint;

  // Initialize handlers map with BenzingaEndpoint keys
  const handlers: Partial<Record<BenzingaEndpoint, BenzingaBaseHandler<any>>> = {
    // Use CALENDAR as the endpoint since EARNINGS is a calendar type
    [BenzingaEndpoint.CALENDAR]: BenzingaHandlerFactory.createHandler(BenzingaEndpoint.CALENDAR),
    // NEWS handler is optional and can be added later
  };

  const handler = handlers[endpointKey];
  
  if (!handler) {
    throw new Error(`No handler implemented for endpoint: ${endpoint}`);
  }
  
  return handler;
}

// Export handler types for use in other files
export * from './handlers/benzinga-base.handler';
