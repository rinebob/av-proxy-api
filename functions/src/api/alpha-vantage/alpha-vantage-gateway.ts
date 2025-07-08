import { onRequest } from 'firebase-functions/v2/https';
import { Request, Response } from 'express';
import { AlphaVantageHandlerFactory } from './alpha-vantage-factory';
import { AlphaVantageEndpoint } from '../../common/common-av';

interface ApiError extends Error {
  status?: number;
  code?: string;
  details?: any;
}

/**
 * API Gateway for all Alpha Vantage endpoints
 * Routes requests to the appropriate handler based on the endpoint path
 * Example: /alpha-vantage/time-series-daily?symbol=IBM
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
    try {
      // Extract endpoint from URL path (e.g., 'time-series-daily' from '/alpha-vantage/time-series-daily')
      const endpoint = req.path.split('/').pop() as AlphaVantageEndpoint;
      
      if (!endpoint) {
        throw new Error('No endpoint specified in URL');
      }

      // Get the list of valid endpoints from the factory
      const validEndpoints = AlphaVantageHandlerFactory.getAvailableEndpoints();
      
      // Check if the endpoint is valid
      if (!validEndpoints.includes(endpoint as AlphaVantageEndpoint)) {
        throw new Error(`Invalid endpoint: ${endpoint}. Valid endpoints are: ${validEndpoints.join(', ')}`);
      }

      // Get the endpoint config and create the appropriate handler
      const endpointConfig = AlphaVantageHandlerFactory.getEndpointConfig(endpoint as AlphaVantageEndpoint);
      const handler = AlphaVantageHandlerFactory.createHandler(endpoint as AlphaVantageEndpoint);
      
      // Get query parameters and handle the request
      const params = { ...req.query };
      const response = await handler.fetch(params);
      
      // Transform the response to match frontend expectations
      const frontendResponse = {
        data: response,
        metadata: {
          endpoint: endpointConfig.id,
          timestamp: new Date().toISOString()
        }
      };

      // Send the transformed response
      res.status(200).json(frontendResponse);
    } catch (error) {
      // Handle errors consistently
      const apiError = error as ApiError;
      console.error('Error in alphaVantageApi:', apiError);
      
      // Set default status code if not provided
      const statusCode = apiError.status || 500;
      
      // Send error response
      res.status(statusCode).json({
        error: {
          message: apiError.message || 'Internal server error',
          code: apiError.code || 'INTERNAL_ERROR',
          details: apiError.details || undefined
        }
      });
    }
  }
);
