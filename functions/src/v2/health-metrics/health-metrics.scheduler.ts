import { onSchedule } from 'firebase-functions/v2/scheduler';
import { AV_IMPLEMENTED_ENDPOINTS } from '@shared/alpha-vantage';
import { HealthMetricsService } from './health-metrics.service';
import { createLogger } from '../utils/utils';
import { HEALTH_METRICS_SCHEDULE } from '../common/function-schedules';

const logger = createLogger('health-metrics-scheduler');
const healthMetricsService = new HealthMetricsService();

/**
 * Scheduled function that checks endpoint health according to the configured schedule
 * This only updates the latest health status without creating history entries
 */
export const healthMetricsScheduler = onSchedule({
  schedule: HEALTH_METRICS_SCHEDULE,
  timeoutSeconds: 300, // 5 minutes
  memory: '1GiB',
  maxInstances: 1,
}, async (event) => {
  const startTime = Date.now();
  logger.info('------- Starting scheduled health metrics check for all endpoints -------');

  try {
    // Use the centrally-maintained allowlist of implemented endpoints
    // Extend AV_IMPLEMENTED_ENDPOINTS as additional endpoint handlers are added
    const endpoints = Array.from(AV_IMPLEMENTED_ENDPOINTS);
    logger.info(`Checking health for ${endpoints.length} endpoints`);

    // Process each endpoint
    for (const endpoint of endpoints) {
      const endpointStartTime = Date.now();
      logger.info(`Checking health for endpoint: ${endpoint}`);
      
      try {
        // Only check health, don't record history
        await healthMetricsService.checkEndpointHealth(endpoint);
        logger.info(`Health check completed for ${endpoint} in ${Date.now() - endpointStartTime}ms`);
      } catch (error: unknown) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        logger.error(`Error checking health for ${endpoint}: ${errorMessage}`);
        if (error instanceof Error && error.stack) {
          logger.debug(`Stack trace for ${endpoint}: ${error.stack}`);
        }
      }
    }

    logger.info(`Completed all health checks in ${Date.now() - startTime}ms`);
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logger.error(`Error in health check scheduler: ${errorMessage}`);
    if (error instanceof Error && error.stack) {
      logger.debug(`Stack trace: ${error.stack}`);
    }
    throw error;
  }
});

/**
 * Nightly retention job: purge history documents older than 30 days.
 * Runs once daily at 08:00 UTC. Adjust schedule if needed.
 */
export const purgeOldHealthHistory = onSchedule({
  schedule: '0 8 * * *', // daily at 08:00 UTC
  timeoutSeconds: 540, // 9 minutes
  memory: '1GiB',
  maxInstances: 1,
}, async () => {
  const startedAt = Date.now();
  const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;
  const cutoff = new Date(Date.now() - THIRTY_DAYS_MS);

  logger.info('Starting nightly purge of old health history', { cutoff: cutoff.toISOString() });

  try {
    const { deletedCount } = await healthMetricsService.purgeOldHistory(cutoff, 5000);

    logger.info('Completed nightly purge of old health history', {
      deletedCount,
      durationMs: Date.now() - startedAt,
    });
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logger.error('Error during nightly purge of old health history', {
      error: errorMessage,
      stack: error instanceof Error ? error.stack : undefined,
      durationMs: Date.now() - startedAt,
    });
    throw error;
  }
});

/**
 * Nightly retention job: purge REQUEST_LOGS older than 30 days.
 * Runs once daily at 08:10 UTC to stagger slightly after the history purge.
 */
export const purgeOldRequestLogs = onSchedule({
  schedule: '10 8 * * *', // daily at 08:10 UTC
  timeoutSeconds: 540, // 9 minutes
  memory: '1GiB',
  maxInstances: 1,
}, async () => {
  const startedAt = Date.now();
  const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;
  const cutoff = new Date(Date.now() - THIRTY_DAYS_MS);

  logger.info('Starting nightly purge of old request logs', { cutoff: cutoff.toISOString() });

  try {
    const { deletedCount } = await healthMetricsService.purgeOldRequestLogs(cutoff, 5000);

    logger.info('Completed nightly purge of old request logs', {
      deletedCount,
      durationMs: Date.now() - startedAt,
    });
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logger.error('Error during nightly purge of old request logs', {
      error: errorMessage,
      stack: error instanceof Error ? error.stack : undefined,
      durationMs: Date.now() - startedAt,
    });
    throw error;
  }
});

// Export all scheduler functions
export * from './health-metrics.service';
