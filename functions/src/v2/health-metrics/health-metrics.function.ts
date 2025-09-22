import { onRequest } from 'firebase-functions/v2/https';
import { authenticateRequestEither } from '../utils/utils';
import { HealthMetricsService } from './health-metrics.service';
import { AlphaVantageEndpoint } from '@shared/alpha-vantage';
import { createLogger } from '../utils/utils';
import { withCors } from '../utils/cors-middleware';

const logger = createLogger('health-metrics');
const healthMetricsService = new HealthMetricsService();

export const getHealthMetrics = onRequest(withCors(async (req, res) => {
  try {
    // Authenticate the request
    const user = await authenticateRequestEither(req, res);
    if (!user) return; // authenticateRequestEither already sent the error response

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

    logger.info('Fetching health metrics', { endpoint, caller: (user as any).uid || (user as any).serviceAccountEmail || 'unknown' });
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
}));

// New: aggregated summary for dashboards
export const getHealthSummary = onRequest(withCors(async (req, res) => {
  try {
    const user = await authenticateRequestEither(req, res);
    if (!user) return;

    const summary = await healthMetricsService.getHealthSummary();
    res.status(200).json({ success: true, data: summary });
  } catch (error) {
    logger.error('Error fetching health summary', {
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
    });
    res.status(500).json({ success: false, error: 'Failed to fetch health summary' });
  }
}));

// New: paginated request logs with filters
export const getRequestLogs = onRequest(withCors(async (req, res) => {
  try {
    const user = await authenticateRequestEither(req, res);
    if (!user) return;

    // Parse query params
    const qp = req.query as Record<string, string | string[]>;
    const parseCsv = (v?: string | string[]) =>
      typeof v === 'string' && v.trim().length ? v.split(',').map(s => s.trim()).filter(Boolean) : undefined;

    const endpointIds = parseCsv(qp.endpointIds as string);
    const symbols = parseCsv(qp.symbols as string);

    // Dates as ISO strings (optional)
    const fromStr = (qp.from as string) || undefined;
    const toStr = (qp.to as string) || undefined;
    const from = fromStr ? new Date(fromStr) : undefined;
    const to = toStr ? new Date(toStr) : undefined;

    const sortBy = (qp.sortBy as any) || 'timestamp';
    const sortOrder = (qp.sortOrder as 'asc' | 'desc') || 'desc';
    const limit = qp.limit ? Math.max(1, Math.min(1000, Number(qp.limit))) : undefined;
    const offset = qp.offset ? Math.max(0, Number(qp.offset)) : undefined;

    const result = await healthMetricsService.getRequestLogs({
      endpointIds,
      symbols,
      timeRange: from || to ? { from: from ?? new Date(0), to: to ?? new Date() } : undefined,
      sortBy,
      sortOrder,
      limit,
      offset,
    });

    res.status(200).json({ success: true, ...result });
  } catch (error) {
    logger.error('Error fetching request logs', {
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
    });
    res.status(500).json({ success: false, error: 'Failed to fetch request logs' });
  }
}));

// New: per-symbol status (latest)
export const getSymbolStatus = onRequest(withCors(async (req, res) => {
  try {
    const user = await authenticateRequestEither(req, res);
    if (!user) return;

    const symbol = String(req.query.symbol || '').toUpperCase();
    if (!symbol) {
      res.status(400).json({ success: false, error: 'symbol is required' });
      return;
    }

    const status = await healthMetricsService.getSymbolStatus(symbol);
    res.status(200).json({ success: true, data: status });
  } catch (error) {
    logger.error('Error fetching symbol status', {
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
    });
    res.status(500).json({ success: false, error: 'Failed to fetch symbol status' });
  }
}));

// New: per-symbol aggregated metrics
export const getSymbolMetrics = onRequest(withCors(async (req, res) => {
  try {
    const user = await authenticateRequestEither(req, res);
    if (!user) return;

    const symbol = String(req.query.symbol || '').toUpperCase();
    if (!symbol) {
      res.status(400).json({ success: false, error: 'symbol is required' });
      return;
    }

    const metrics = await healthMetricsService.getSymbolMetrics(symbol);
    res.status(200).json({ success: true, data: metrics });
  } catch (error) {
    logger.error('Error fetching symbol metrics', {
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
    });
    res.status(500).json({ success: false, error: 'Failed to fetch symbol metrics' });
  }
}));

// Export all health metrics functions
export * from './health-metrics.service';
