import { onRequest } from 'firebase-functions/v2/https';
import { authenticateRequest } from '../utils/utils';
import { HealthMetricsService } from './health-metrics.service';
import { AlphaVantageEndpoint } from '@shared/alpha-vantage';
import { createLogger } from '../utils/utils';

const logger = createLogger('health-metrics');
const healthMetricsService = new HealthMetricsService();

export const getHealthMetrics = onRequest({ cors: true }, async (req, res) => {
  try {
    // Authenticate the request
    const user = await authenticateRequest(req, res);
    if (!user) return; // authenticateRequest already sent the error response
    
    const endpoint = req.query.endpoint as AlphaVantageEndpoint;
    
    if (!endpoint || !Object.values(AlphaVantageEndpoint).includes(endpoint)) {
      const error = `Invalid endpoint. Must be one of: ${Object.values(AlphaVantageEndpoint).join(', ')}`;
      logger.error('Invalid endpoint', { endpoint, error });
      res.status(400).json({ 
        success: false, 
        error
      });
      return;
    }
    
    logger.info('Fetching health metrics', { endpoint, userId: user.uid });
    const metrics = await healthMetricsService.getEndpointHealth(endpoint);
    
    res.status(200).json({
      success: true,
      data: metrics
    });
  } catch (error) {
    logger.error('Error fetching health metrics', { 
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
      endpoint: (req.query as any).endpoint
    });
    res.status(500).json({
      success: false,
      error: 'Failed to fetch health metrics',
      details: error instanceof Error ? error.message : String(error)
    });
  }
});

// Export all health metrics functions
export * from './health-metrics.service';
