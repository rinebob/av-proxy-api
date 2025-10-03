import { onRequest } from 'firebase-functions/v2/https';
import { runRefreshAlphaVantageDataV2 } from '../src/v2/alpha-vantage/data-refresher/av-refresh-manager';
import { HealthMetricsService } from '../src/v2/health-metrics/health-metrics.service';
import { RefreshStatus } from '@shared/firestore';
import { createLogger } from '../src/v2/utils/utils';
import { AlphaVantageEndpoint } from '@shared/alpha-vantage';

const logger = createLogger('av-refresh-http');
const healthMetricsService = new HealthMetricsService();

// Define the endpoint we're tracking for health metrics
const TRACKED_ENDPOINT = AlphaVantageEndpoint.TIME_SERIES_DAILY_ADJUSTED;

/**
 * HTTP wrapper to run the Alpha Vantage refresh manager once.
 * - Intended for local development with emulators.
 * - In non-emulator environments, returns 403 to avoid accidental exposure.
 */
export const refreshAlphaVantageDataV2Http = onRequest(async (req, res) => {
  if (process.env.FUNCTIONS_EMULATOR !== 'true') {
    res.status(403).json({ ok: false, error: 'Forbidden outside emulator' });
    return;
  }

  const startedAt = Date.now();
  let result;

  try {
    const forceParam = String((req.query?.force ?? '')).toLowerCase();
    const force = forceParam === '1' || forceParam === 'true';
    
    // Record the start of the refresh
    logger.info('Starting manual refresh', { 
      endpoint: TRACKED_ENDPOINT,
      force 
    });
    
    // Run the refresh
    result = await runRefreshAlphaVantageDataV2({ force });
    const finishedAt = Date.now();
    const durationMs = finishedAt - startedAt;

    // Log the results
    logger.info('Refresh completed', {
      endpoint: TRACKED_ENDPOINT,
      processed: result.symbolsChecked,
      updated: result.symbolsUpdatedCount,
      fresh: result.freshCount,
      stale: result.staleCount,
      force,
      durationMs
    });

    // Record success in health metrics for the specific endpoint
    await healthMetricsService.recordRefreshAttempt(
      TRACKED_ENDPOINT,
      RefreshStatus.SUCCESS,
      undefined,
      durationMs
    );

    // Get the latest health metrics
    const healthMetrics = await healthMetricsService.getEndpointHealth(TRACKED_ENDPOINT);

    res.status(200).json({
      ok: true,
      startedAtIso: new Date(startedAt).toISOString(),
      finishedAtIso: new Date(finishedAt).toISOString(),
      totalDurationMs: durationMs,
      endpoint: TRACKED_ENDPOINT,
      ...result,
      healthMetrics: healthMetrics || { message: 'No health metrics available yet' }
    });
  } catch (error: any) {
    const errorMessage = error?.message || 'Unknown error';
    const durationMs = Date.now() - startedAt;
    
    // Record failure in health metrics for the specific endpoint
    await healthMetricsService.recordRefreshAttempt(
      TRACKED_ENDPOINT,
      RefreshStatus.FAILURE,
      error ? error.message : undefined,
      durationMs
    );
    
    try {
      // Try to get health metrics even in case of failure
      const healthMetrics = await healthMetricsService.getEndpointHealth(TRACKED_ENDPOINT);
      
      logger.error('Refresh failed', {
        endpoint: TRACKED_ENDPOINT,
        error: errorMessage,
        stack: error?.stack,
        durationMs,
        healthMetrics
      });
      
      res.status(500).json({ 
        ok: false, 
        error: errorMessage,
        endpoint: TRACKED_ENDPOINT,
        durationMs,
        healthMetrics: healthMetrics || { message: 'No health metrics available' }
      });
    } catch (metricsError: unknown) {
      // If we can't get metrics, still return the original error
      const errorMessage = metricsError instanceof Error ? metricsError.message : 'Unknown error';
      
      logger.error('Failed to get health metrics after refresh failure', {
        endpoint: TRACKED_ENDPOINT,
        error: errorMessage,
        metricsError: errorMessage
      });
      
      res.status(500).json({ 
        ok: false, 
        error: errorMessage,
        endpoint: TRACKED_ENDPOINT,
        durationMs,
        healthMetrics: { error: 'Failed to retrieve health metrics' }
      });
    }
  }
});
