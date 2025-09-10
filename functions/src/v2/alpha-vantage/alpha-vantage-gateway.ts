import { onRequest } from 'firebase-functions/v2/https';
import { Request, Response } from 'express';

import { AlphaVantageEndpoint } from '@shared/alpha-vantage';

import { AlphaVantageHandlerFactory } from './alpha-vantage-factory';
import { withCors, ALLOWED_ORIGINS } from '../utils/cors-middleware';

/**
 * Alpha Vantage API Gateway
 * 
 * Handles all Alpha Vantage API requests through a single entry point.
 * Routes requests to the appropriate handler based on the endpoint.
 */
const alphaVantageApiHandler = async (req: Request, res: Response) => {
  console.log('alpha-vantage-gateway.ts loaded');
  const requestId = Math.random().toString(36).substring(2, 10);
  const startTime = Date.now();

  try {
    console.log(`aVG aVA [${requestId}] [GATEWAY] Incoming request: ${req.method} ${req.url}`);
    console.log(`aVG aVA [${requestId}] [GATEWAY] Headers:`, JSON.stringify(req.headers));
    console.log(`aVG aVA [${requestId}] [GATEWAY] Query params:`, JSON.stringify(req.query));

    // NOTE: This gateway is intentionally restricted to specific browser origins.
    // Do NOT enforce server-to-server auth here; this endpoint is browser-facing and protected by Origin checks.
    const origin = req.headers.origin as string | undefined;
    if (!origin || !ALLOWED_ORIGINS.includes(origin)) {
      console.warn(`aVG aVA [${requestId}] [GATEWAY] Blocked by origin policy. Origin: ${origin}`);
      res.status(403).json({
        error: 'Forbidden',
        message: 'This endpoint is only accessible from approved origins.',
        allowedOrigins: ALLOWED_ORIGINS,
        requestId,
      });
      return;
    }

    // Extract endpoint from URL path (e.g., 'TIME_SERIES_DAILY' from '/alpha-vantage/TIME_SERIES_DAILY')
    const endpoint = req.path.split('/').pop() as AlphaVantageEndpoint;
    console.log(`aVG aVA [${requestId}] [GATEWAY] Extracted endpoint: ${endpoint}`);

    if (!endpoint) {
      res.status(400).json({ 
        error: 'Bad Request', 
        message: 'No endpoint specified in URL path' 
      });
      return;
    }

    // Get valid endpoints from factory
    const validEndpoints = AlphaVantageHandlerFactory.getAvailableEndpoints?.() ?? [];
    
    // Check if the endpoint is valid
    if (!validEndpoints.includes(endpoint as AlphaVantageEndpoint)) {
      res.status(404).json({ 
        error: 'Not Found', 
        message: `No handler found for endpoint: ${endpoint}` 
      });
      return;
    }

    // Get the endpoint config and create the appropriate handler
    console.log(`aVG aVA [${requestId}] [GATEWAY] Creating handler for endpoint: ${endpoint}`);
    const handler = AlphaVantageHandlerFactory.createHandler(endpoint as AlphaVantageEndpoint);
    
    if (!handler) {
      res.status(404).json({ 
        error: 'Not Found', 
        message: `No handler found for endpoint: ${endpoint}` 
      });
      return;
    }

    console.log(`aVG aVA [${requestId}] [GATEWAY] Processing ${endpoint} request...`);
    console.log(`aVG aVA [${requestId}] [GATEWAY] Query params:`, JSON.stringify(req.query));
    
    // Process the request using the handler with all query parameters
    const requestParams = { ...req.query };

    // Log the final parameters being sent to the handler
    console.log(`aVG aVA [${requestId}] [GATEWAY] Final request params:`, JSON.stringify(requestParams));
    
    // Use the public fetch method to handle the request
    const response = await handler.fetch(requestParams);

    // Send the handler's response directly (new structure)
    res.status(200).json(response);
    
  } catch (error: unknown) {
    // Robust error message extraction
    console.error(`aVG aVA [${requestId}] [GATEWAY] Unhandled error:`, error);
    let message = 'An unknown error occurred';
    let code = 'UNKNOWN_ERROR';
    let details: any = {};
    let statusCode = 500;

    if (typeof error === 'string' && error.trim()) {
      message = error;
    } else if (error instanceof Error) {
      message = error.message || message;
      if ('code' in error && typeof (error as any).code === 'string') code = (error as any).code;
      if ('details' in error) details = (error as any).details;
      if ('statusCode' in error && typeof (error as any).statusCode === 'number') statusCode = (error as any).statusCode;
    } else if (error && typeof error === 'object') {
      if ('message' in error && typeof (error as any).message === 'string' && (error as any).message.trim()) {
        message = (error as any).message;
      }
      if ('code' in error && typeof (error as any).code === 'string') code = (error as any).code;
      if ('details' in error) details = (error as any).details;
      if ('statusCode' in error && typeof (error as any).statusCode === 'number') statusCode = (error as any).statusCode;
    }

    const errorResponse = {
      error: message,
      code,
      details,
      timestamp: new Date().toISOString(),
      requestId,
      processingTimeMs: Date.now() - startTime
    };
    console.error('Sending error response to client:', errorResponse);
    res.status(statusCode).json(errorResponse);
  } finally {
    console.log(`aVG aVA [${requestId}] [GATEWAY] Request completed in ${Date.now() - startTime}ms`);
  }
};

export const alphaVantageApiV2 = onRequest(
  { 
    secrets: ['ALPHAVANTAGE_API_KEY'],
    memory: '256MiB',
    maxInstances: 10,
    timeoutSeconds: 60
  },
  withCors(alphaVantageApiHandler)
);
