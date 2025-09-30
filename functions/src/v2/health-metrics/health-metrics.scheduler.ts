import { onSchedule } from 'firebase-functions/v2/scheduler';
import { AV_IMPLEMENTED_ENDPOINTS } from '@shared/alpha-vantage';
import { RefreshStatus } from '@shared/firestore';
import { HealthMetricsService } from './health-metrics.service';
import { createLogger } from '../utils/utils';

const logger = createLogger('health-metrics-scheduler');
const healthMetricsService = new HealthMetricsService();

/**
 * Scheduled function that runs every 5 minutes to update health metrics
 */
export const checkAllEndpoints = onSchedule({
  schedule: 'every 5 minutes',
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

    let successCount = 0;
    let failureCount = 0;

    // Process each endpoint
    for (const endpoint of endpoints) {
        logger.info(`------- Starting endpoint ${endpoint} -------`);
      const endpointStartTime = Date.now();
      
      try {
        // Get the current health status
        const metrics = await healthMetricsService.getEndpointHealth(endpoint);
        const refreshStatus = metrics.refreshStatus;
        
        // Record the status check
        await healthMetricsService.recordRefreshAttempt(
          endpoint,
          RefreshStatus.SUCCESS,
          undefined,
          Date.now() - endpointStartTime
        );
        
        successCount++;
        
        logger.debug(`Checked endpoint: ${endpoint}`, { 
          status: refreshStatus,
          durationMs: Date.now() - endpointStartTime 
        });
      } catch (error) {
        failureCount++;
        
        await healthMetricsService.recordRefreshAttempt(
          endpoint,
          RefreshStatus.FAILURE,
          error instanceof Error ? error.message : String(error),
          Date.now() - endpointStartTime
        );
        
        logger.error(`Failed to check endpoint: ${endpoint}`, {
          error: error instanceof Error ? error.message : String(error),
          stack: error instanceof Error ? error.stack : undefined
        });
      }
      logger.info(`------- Completed endpoint ${endpoint} -------`);
      console.log('')
      console.log('')
      console.log('')
    }

    // Log summary
    const duration = Date.now() - startTime;
    logger.info('Completed health metrics check', {
      totalEndpoints: endpoints.length,
      successCount,
      failureCount,
      durationMs: duration
    });

  } catch (error) {
    logger.error('Fatal error in health metrics scheduler', {
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
      durationMs: Date.now() - startTime
    });
    
    // Re-throw to mark the function as failed
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
  } catch (error) {
    logger.error('Error during nightly purge of old health history', {
      error: error instanceof Error ? error.message : String(error),
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
  } catch (error) {
    logger.error('Error during nightly purge of old request logs', {
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
      durationMs: Date.now() - startedAt,
    });
    throw error;
  }
});

// Export all scheduler functions
export * from './health-metrics.service';
