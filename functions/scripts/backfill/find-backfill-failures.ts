/**
 * Find all permanent failure symbols from the backfill runs.
 * 
 * Usage:
 *   npm run ts:scripts scripts/find-backfill-failures.ts
 */

import { db } from '../src/firebase-admin-init';
import { FirestoreCollection } from '@shared/firestore';

const DAILY_RUN_ID = '2026-01-24-SAT-POST-TIME_SERIES_DAILY_ADJUSTED-FULL_BACKFILL';
const WEEKLY_RUN_ID = '2026-01-24-SAT-POST-TIME_SERIES_WEEKLY_ADJUSTED-FULL_BACKFILL';
const MONTHLY_RUN_ID = '2026-01-24-SAT-POST-TIME_SERIES_MONTHLY_ADJUSTED-FULL_BACKFILL';

async function findFailures(runId: string, interval: string): Promise<string[]> {
  const jobsRef = db.collection(`${FirestoreCollection.BACKFILL_RUNS}/${runId}/jobs`);
  const failedJobsSnap = await jobsRef.where('status', '==', 'PERMANENT_FAILURE').get();
  
  const failures: string[] = [];
  
  failedJobsSnap.forEach((doc) => {
    const data = doc.data();
    failures.push(data.symbol);
  });
  
  if (failures.length > 0) {
    console.log(`\n${interval.toUpperCase()} Failures (${failures.length}):`);
    failures.forEach((symbol) => {
      console.log(`  - ${symbol}`);
    });
  } else {
    console.log(`\n${interval.toUpperCase()}: No failures ✓`);
  }
  
  return failures;
}

async function main() {
  console.log('Finding permanent failure symbols from backfill runs...\n');
  console.log('='.repeat(60));
  
  const dailyFailures = await findFailures(DAILY_RUN_ID, 'daily');
  const weeklyFailures = await findFailures(WEEKLY_RUN_ID, 'weekly');
  const monthlyFailures = await findFailures(MONTHLY_RUN_ID, 'monthly');
  
  console.log('\n' + '='.repeat(60));
  console.log('\nSummary:');
  console.log(`  Daily:   ${dailyFailures.length} failures`);
  console.log(`  Weekly:  ${weeklyFailures.length} failures`);
  console.log(`  Monthly: ${monthlyFailures.length} failures`);
  console.log(`  Total:   ${dailyFailures.length + weeklyFailures.length + monthlyFailures.length} failures`);
  
  // Find symbols that failed across multiple intervals
  const allFailures = new Set([...dailyFailures, ...weeklyFailures, ...monthlyFailures]);
  const multiIntervalFailures = Array.from(allFailures).filter((symbol) => {
    const count = [dailyFailures, weeklyFailures, monthlyFailures].filter((arr) => arr.includes(symbol)).length;
    return count > 1;
  });
  
  if (multiIntervalFailures.length > 0) {
    console.log(`\nSymbols failing in multiple intervals (${multiIntervalFailures.length}):`);
    multiIntervalFailures.forEach((symbol) => {
      const intervals: string[] = [];
      if (dailyFailures.includes(symbol)) intervals.push('D');
      if (weeklyFailures.includes(symbol)) intervals.push('W');
      if (monthlyFailures.includes(symbol)) intervals.push('M');
      console.log(`  - ${symbol} [${intervals.join(', ')}]`);
    });
  }
  
  process.exit(0);
}

main().catch((error) => {
  console.error('Error:', error);
  process.exit(1);
});
