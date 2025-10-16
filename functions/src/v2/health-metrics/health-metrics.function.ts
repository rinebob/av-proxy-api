import { onRequest } from 'firebase-functions/v2/https';
import { authenticateRequestEither } from '../utils/utils';
import { HealthMetricsService } from './health-metrics.service';
import { AlphaVantageEndpoint } from '@shared/alpha-vantage';
import { createLogger } from '../utils/utils';
import { withCors } from '../utils/cors-middleware';
import { HealthMetricsSortBy, SortOrder, HealthStatus } from '@shared/health-metrics';
import { Request, Response } from 'express';

const logger = createLogger('health-metrics');
const healthMetricsService = new HealthMetricsService();

// Helper to normalize auth result into a loggable actor descriptor
function resolveActor(auth: any): { type: 'firebase' | 'service-account'; uid?: string; email?: string; serviceAccountEmail?: string } {
  if (auth && typeof auth === 'object' && 'serviceAccountEmail' in auth) {
    return { type: 'service-account', serviceAccountEmail: String((auth as any).serviceAccountEmail || '') };
  }
  // Assume Firebase DecodedIdToken shape
  const uid = (auth as any)?.uid ? String((auth as any).uid) : undefined;
  const email = (auth as any)?.email ? String((auth as any).email) : undefined;
  return { type: 'firebase', uid, email };
}

export const getHealthMetrics = onRequest(withCors(async (req: Request, res: Response) => {
  try {
    // Authenticate the request
    const authResult = await authenticateRequestEither(req, res);
    if (!authResult) return;
    const actor = resolveActor(authResult);
    
    logger.info('Processing request', { 
      authType: actor.type,
      uid: actor.uid,
      email: actor.email,
      serviceAccountEmail: actor.serviceAccountEmail,
      endpoint: req.query.endpoint 
    });

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

    logger.info('Fetching health metrics', { endpoint, uid: actor.uid, serviceAccountEmail: actor.serviceAccountEmail });
    const metrics = await healthMetricsService.getEndpointHealth(endpoint);

    res.status(200).json({
      success: true,
      data: metrics
    });
  } catch (error) {
    logger.error('Error in getHealthMetrics', { 
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
      endpoint: (req.query as any).endpoint
    });
    
    res.status(500).json({
      success: false,
      error: 'Internal server error',
      details: process.env.NODE_ENV === 'development' ? 
        (error instanceof Error ? error.message : String(error)) : 
        undefined
    });
  }
}));

// New: aggregated summary for dashboards
export const getHealthSummary = onRequest(withCors(async (req: Request, res: Response) => {
  try {
    // Authenticate the request
    const authResult = await authenticateRequestEither(req, res);
    if (!authResult) return;
    const actor = resolveActor(authResult);
    
    logger.info('Processing request', { 
      authType: actor.type,
      uid: actor.uid, 
      email: actor.email,
      serviceAccountEmail: actor.serviceAccountEmail,
    });

    const summary = await healthMetricsService.getHealthSummary();
    res.status(200).json({ success: true, data: summary });
  } catch (error) {
    logger.error('Error in getHealthSummary', { 
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined
    });
    res.status(500).json({ 
      success: false, 
      error: 'Internal server error',
      details: process.env.NODE_ENV === 'development' ? 
        (error instanceof Error ? error.message : String(error)) : 
        undefined
    });
  }
}));

// New: paginated request logs with filters
export const getRequestLogs = onRequest(withCors(async (req: Request, res: Response) => {
  try {
    // Authenticate the request
    const authResult = await authenticateRequestEither(req, res);
    if (!authResult) return;
    const actor = resolveActor(authResult);
    
    logger.info('Processing request', { 
      authType: actor.type,
      uid: actor.uid, 
      email: actor.email,
      serviceAccountEmail: actor.serviceAccountEmail,
    });

    // Parse query params
    const qp = req.query as Record<string, string | string[]>;
    
    // Handle array parameters
    const parseCsv = (v?: string | string[]) => 
      (Array.isArray(v) ? v[0] : v || '').split(',').filter(Boolean);

    const endpointIds = parseCsv(qp.endpointIds);
    const symbols = parseCsv(qp.symbols);

    // Parse time range (standardized): use only `from` and `to` ISO strings
    const fromRaw = qp.from as unknown as string | undefined;
    const toRaw = qp.to as unknown as string | undefined;
    const startDate = fromRaw ? new Date(fromRaw) : undefined;
    const endDate = toRaw ? new Date(toRaw) : undefined;
    const timeRange = (startDate || endDate) 
      ? { 
          from: startDate || new Date(0), // Default to epoch if startDate not provided
          to: endDate || new Date()      // Default to now if endDate not provided
        }
      : undefined;

    // Parse sorting
    const sortByRaw = (qp.sortBy as string) || HealthMetricsSortBy.Timestamp;
    const sortBy = Object.values(HealthMetricsSortBy).includes(sortByRaw as HealthMetricsSortBy)
      ? (sortByRaw as HealthMetricsSortBy)
      : HealthMetricsSortBy.Timestamp;

    const sortOrderRaw = (qp.sortOrder as string) || 'desc';
    const sortOrder = sortOrderRaw === 'asc' ? SortOrder.Asc : SortOrder.Desc;

    // Parse pagination
    const limit = Math.min(100, Math.max(1, parseInt(qp.limit as string) || 20));
    const offset = Math.max(0, parseInt(qp.offset as string) || 0);

    const status = qp.status 
      ? (Array.isArray(qp.status) ? qp.status : [qp.status])
          .flatMap(s => typeof s === 'string' ? s.split(',').map(x => x.trim()) : [])
          .filter((s): s is HealthStatus => 
            Object.values(HealthStatus).includes(s as HealthStatus)
          )
      : undefined;

    const logs = await healthMetricsService.getRequestLogs({
      endpointIds: endpointIds.length ? endpointIds : undefined,
      symbols: symbols.length ? symbols : undefined,
      status: status?.length ? status : undefined,
      timeRange,
      sortBy,
      sortOrder,
      limit,
      offset
    });

    res.status(200).json({
      success: true,
      data: logs
    });
  } catch (error) {
    logger.error('Error in getRequestLogs', { 
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
      query: req.query
    });
    res.status(500).json({ 
      success: false, 
      error: 'Internal server error',
      details: process.env.NODE_ENV === 'development' ? 
        (error instanceof Error ? error.message : String(error)) : 
        undefined
    });
  }
}));

// New: per-symbol status (latest)
export const getSymbolStatus = onRequest(withCors(async (req: Request, res: Response) => {
  try {
    // Authenticate the request
    const authResult = await authenticateRequestEither(req, res);
    if (!authResult) return;
    const actor = resolveActor(authResult);
    
    logger.info('Processing request', { 
      authType: actor.type,
      uid: actor.uid, 
      email: actor.email,
      serviceAccountEmail: actor.serviceAccountEmail,
    });

    const symbol = String(req.query.symbol || '').toUpperCase();
    if (!symbol) {
      res.status(400).json({ success: false, error: 'Symbol parameter is required' });
      return;
    }

    const status = await healthMetricsService.getSymbolStatus(symbol);
    logger.info('getSymbolStatus.result', {
      symbol,
      hasData: !!status,
      endpointId: status?.endpointId,
      status: status?.status,
      lastUpdated: status?.lastUpdated,
    });
    res.status(200).json({ success: true, data: status });
  } catch (error) {
    logger.error('Error in getSymbolStatus', { 
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
      symbol: req.query.symbol
    });
    // Return 200 with null payload so UI can continue without breaking
    res.status(200).json({ success: true, data: null });
  }
}));

// New: per-symbol aggregated metrics
export const getSymbolMetrics = onRequest(withCors(async (req: Request, res: Response) => {
  try {
    // Authenticate the request
    const authResult = await authenticateRequestEither(req, res);
    if (!authResult) return;
    const actor = resolveActor(authResult);
    
    logger.info('Processing request', { 
      authType: actor.type,
      uid: actor.uid, 
      email: actor.email,
      serviceAccountEmail: actor.serviceAccountEmail,
    });

    const symbol = String(req.query.symbol || '').toUpperCase();
    if (!symbol) {
      res.status(400).json({ success: false, error: 'Symbol parameter is required' });
      return;
    }

    const metrics = await healthMetricsService.getSymbolMetrics(symbol);
    logger.info('getSymbolMetrics.result', {
      symbol,
      hasData: !!metrics,
      endpointId: metrics?.endpointId,
      refreshCount: metrics?.refreshCount,
      successCount: metrics?.successCount,
      failureCount: metrics?.failureCount,
      lastUpdated: metrics?.lastUpdated,
    });
    res.status(200).json({ success: true, data: metrics });
  } catch (error) {
    logger.error('Error in getSymbolMetrics', { 
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
      symbol: req.query.symbol
    });
    // Return 200 with null payload so UI can continue without breaking
    res.status(200).json({ success: true, data: null });
  }
}));

// V2: per-symbol status (latest) — fresh function name to avoid any legacy routing
export const getSymbolStatusV2 = onRequest(withCors(async (req: Request, res: Response) => {
  try {
    // Authenticate the request
    const authResult = await authenticateRequestEither(req, res);
    if (!authResult) return;
    const actor = resolveActor(authResult);
    
    logger.info('Processing request', { 
      authType: actor.type,
      uid: actor.uid, 
      email: actor.email,
      serviceAccountEmail: actor.serviceAccountEmail,
    });

    const symbol = String(req.query.symbol || '').toUpperCase();
    if (!symbol) {
      res.status(400).json({ success: false, error: 'Symbol parameter is required' });
      return;
    }

    const status = await healthMetricsService.getSymbolStatus(symbol);
    logger.info('getSymbolStatusV2.result', { symbol, hasData: !!status, endpointId: status?.endpointId, status: status?.status, lastUpdated: status?.lastUpdated });
    res.status(200).json({ success: true, data: status });
  } catch (error) {
    logger.error('Error in getSymbolStatusV2', {
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
      symbol: req.query.symbol,
    });
    res.status(200).json({ success: true, data: null });
  }
}));

// V2: per-symbol aggregated metrics — fresh function name to avoid any legacy routing
export const getSymbolMetricsV2 = onRequest(withCors(async (req: Request, res: Response) => {
  try {
    // Authenticate the request
    const authResult = await authenticateRequestEither(req, res);
    if (!authResult) return;
    const actor = resolveActor(authResult);
    
    logger.info('Processing request', { 
      authType: actor.type,
      uid: actor.uid, 
      email: actor.email,
      serviceAccountEmail: actor.serviceAccountEmail,
    });

    const symbol = String(req.query.symbol || '').toUpperCase();
    if (!symbol) {
      res.status(400).json({ success: false, error: 'Symbol parameter is required' });
      return;
    }

    const metrics = await healthMetricsService.getSymbolMetrics(symbol);
    logger.info('getSymbolMetricsV2.result', { symbol, hasData: !!metrics, endpointId: metrics?.endpointId, refreshCount: metrics?.refreshCount, successCount: metrics?.successCount, failureCount: metrics?.failureCount, lastUpdated: metrics?.lastUpdated });
    res.status(200).json({ success: true, data: metrics });
  } catch (error) {
    logger.error('Error in getSymbolMetricsV2', {
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
      symbol: req.query.symbol,
    });
    res.status(200).json({ success: true, data: null });
  }
}));

export * from './health-metrics.service';
