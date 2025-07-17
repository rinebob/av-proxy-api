import { onSchedule, ScheduleOptions } from 'firebase-functions/v2/scheduler';
import { symbolManagerService } from './symbolManager.service';
import { INACTIVE_SYMBOL_CLEANUP_SCHEDULE } from '../v2/common/function-schedules';

// Define schedule options
const DAILY_SCHEDULE: ScheduleOptions = {
  schedule: INACTIVE_SYMBOL_CLEANUP_SCHEDULE,
  timeZone: 'America/Los_Angeles',
  timeoutSeconds: 540, // 9 minutes
  memory: '1GiB'
};

/**
 * Scheduled function to clean up inactive symbols
 */
export const cleanupInactiveSymbols = onSchedule(DAILY_SCHEDULE, async (event) => {
  try {
    console.log('Starting cleanup of inactive symbols...');
    const { deactivated } = await symbolManagerService.cleanupInactiveSymbols(30);
    console.log(`Cleanup completed. Deactivated ${deactivated} symbols.`);
  } catch (error) {
    console.error('Error during cleanupInactiveSymbols:', error);
    throw error;
  }
});
