import { Request, Response } from 'express';

/**
 * Logs incoming HTTP requests
 * @param req Express request object
 * @param requestId Unique request identifier
 */
export function logRequest(req: Request, requestId: string): void {
  console.log(`[${requestId}] ${req.method} ${req.originalUrl}`, {
    headers: req.headers,
    query: req.query,
    body: req.body,
    timestamp: new Date().toISOString()
  });
}

/**
 * Logs HTTP responses
 * @param res Express response object
 * @param requestId Unique request identifier
 * @param data Response data to log (optional)
 */
export function logResponse(
  res: Response, 
  requestId: string, 
  data?: any
): void {
  console.log(`[${requestId}] Response`, {
    statusCode: res.statusCode,
    statusMessage: res.statusMessage,
    headers: res.getHeaders(),
    data,
    timestamp: new Date().toISOString()
  });
}

/**
 * Logs errors with request context
 * @param error Error object
 * @param requestId Unique request identifier
 * @param context Additional context about where the error occurred
 */
export function logError(
  error: Error, 
  requestId: string, 
  context: Record<string, any> = {}
): void {
  console.error(`[${requestId}] Error: ${error.message}`, {
    name: error.name,
    stack: error.stack,
    ...context,
    timestamp: new Date().toISOString()
  });
}