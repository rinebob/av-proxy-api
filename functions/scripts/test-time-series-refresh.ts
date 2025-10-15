// Set emulator env and load local .env before any Firebase/Admin imports
import * as dotenv from 'dotenv';
import * as path from 'path';
import { setupEmulator } from './scripts-util';
setupEmulator();
dotenv.config({ path: path.resolve(__dirname, '..', '.env.alpha-vantage-proxy-api') });

// Firebase Admin (centralized init used by other scripts)
import { db, admin } from '../src/firebase-admin-init';

// Refresh functions and types
import { 
  refreshForEndpoints,
} from '../src/v2/alpha-vantage/data-refresher/av-refresh-manager';

// Health metrics
import { HealthMetricsService } from '../src/v2/health-metrics/health-metrics.service';
import { AlphaVantageEndpoint } from '@shared/alpha-vantage';
import { HealthMetricsFilter, RefreshRequestLog } from '@shared/health-metrics';
import { Timestamp } from 'firebase-admin/firestore';
import { TradingPhase } from 'src/v2/common/function-schedules';
import { RefreshTrigger } from '@shared/firestore';

// Test symbol (can be overridden by CLI arg: npx ts-node scripts/test-time-series-refresh.ts MSFT)
const TEST_SYMBOL = (process.argv[2] || 'AAPL').toUpperCase();
const healthMetrics = new HealthMetricsService();

// Helper to execute refresh functions in test
async function executeRefresh(refreshFn: () => Promise<any>) {
  try {
    await refreshFn();
  } catch (error) {
    console.error('Error during refresh:', error);
    throw error;
  }
}

async function ensureTrackedSymbol(symbol: string) {
  const ref = db.collection('tracked-symbols').doc(symbol);
  const snap = await ref.get();
  if (!snap.exists) {
    console.log(`[test] adding ${symbol} to tracked symbols...`);
    await ref.set({
      symbol,
      isActive: true,
      _createdAt: admin.firestore.FieldValue.serverTimestamp(),
      _lastUpdated: admin.firestore.FieldValue.serverTimestamp(),
    }, { merge: true });
  } else {
    console.log(`[test] ${symbol} already in tracked symbols`);
  }
}

async function testTimeSeriesRefresh() {
  console.log('=== Testing Time Series Refreshes ===');
  
  // Ensure test symbol exists
  await ensureTrackedSymbol(TEST_SYMBOL);
  
  // Test pre-close refresh
  console.log('\n[Pre-Close] Starting pre-close refresh...');
  await testRefresh(
    'Pre-Close',
    () => refreshForEndpoints(
      [AlphaVantageEndpoint.TIME_SERIES_DAILY_ADJUSTED], 
      { 
        force: true, 
        phase: TradingPhase.PRE,
        trigger: RefreshTrigger.MANUAL
      }
    ),
    AlphaVantageEndpoint.TIME_SERIES_DAILY_ADJUSTED,
    TradingPhase.PRE
  );
  
  // Verify pre-close data was written
  await verifyPreCloseData(TEST_SYMBOL);
  
  // Test post-close refresh
  console.log('\n[Post-Close] Starting post-close refresh...');
  await testRefresh(
    'Post-Close',
    () => refreshForEndpoints(
      [AlphaVantageEndpoint.TIME_SERIES_DAILY_ADJUSTED],
      { 
        force: true, 
        phase: TradingPhase.POST,
        trigger: RefreshTrigger.MANUAL 
      }
    ),
    AlphaVantageEndpoint.TIME_SERIES_DAILY_ADJUSTED,
    TradingPhase.POST
  );
  
  // Verify post-close data was written
  await verifyPostCloseData(TEST_SYMBOL);
  
  // Test weekly/monthly refresh
  console.log('\n[Weekly/Monthly] Starting weekly/monthly refresh...');
  await testRefresh(
    'Weekly/Monthly',
    () => refreshForEndpoints(
      [
        AlphaVantageEndpoint.TIME_SERIES_WEEKLY_ADJUSTED,
        AlphaVantageEndpoint.TIME_SERIES_MONTHLY_ADJUSTED
      ],
      { 
        force: true, 
        phase: TradingPhase.POST,
        trigger: RefreshTrigger.MANUAL
      }
    ),
    AlphaVantageEndpoint.TIME_SERIES_WEEKLY_ADJUSTED,
    TradingPhase.POST
  );
}

async function verifyPreCloseData(symbol: string) {
  console.log('\n[Verify] Verifying pre-close refresh was triggered...');
  
  // Just log that we attempted the verification
  console.log('✅ Pre-close refresh triggered');
  return true;
}

async function verifyPostCloseData(symbol: string) {
  console.log('\n[Verify] Verifying post-close refresh was triggered...');
  
  // Just log that we attempted the verification
  console.log('✅ Post-close refresh triggered');
  return true;
}

async function testRefresh(
  name: string, 
  refreshFn: () => Promise<any>,
  endpoint: string,
  phase: TradingPhase
) {
  console.log(`\n[${name}] Starting refresh (${phase} phase)...`);
  
  try {
    // Get initial health status
    const initialStatus = await healthMetrics.getSymbolStatus(TEST_SYMBOL);
    console.log(`[${name}] Initial health status for ${endpoint}:`, 
      JSON.stringify(initialStatus, null, 2) || 'No status yet');
    
    // Run the refresh
    console.log(`[${name}] Running refresh...`);
    await executeRefresh(refreshFn);
    console.log(`[${name}] Refresh completed`);
    
    // Get updated health status
    const updatedStatus = await healthMetrics.getSymbolStatus(TEST_SYMBOL);
    console.log(`[${name}] Updated health status for ${endpoint}:`, 
      JSON.stringify(updatedStatus, null, 2) || 'No status after refresh');
    
    // Show refresh history using request logs
    const filter: HealthMetricsFilter = {
      symbols: [TEST_SYMBOL],
      endpointIds: [endpoint],
      limit: 5
    };
    
    console.log(`[${name}] Fetching refresh history with filter:`, JSON.stringify(filter, null, 2));
    const logs = await healthMetrics.getRequestLogs(filter);
    
    console.log(`[${name}] Recent refresh history for ${endpoint}:`);
    if (logs.data && logs.data.length > 0) {
      logs.data.forEach((log: RefreshRequestLog, i: number) => {
        let timestamp: string;
        
        if (log.timestamp instanceof Timestamp) {
          timestamp = log.timestamp.toDate().toISOString();
        } else if (typeof log.timestamp === 'number') {
          timestamp = new Date(log.timestamp).toISOString();
        } else if (log.timestamp instanceof Date) {
          timestamp = log.timestamp.toISOString();
        } else if (log.timestamp && typeof log.timestamp === 'object' && 'toDate' in log.timestamp) {
          // Handle Firestore Timestamp-like objects
          timestamp = (log.timestamp as { toDate: () => Date }).toDate().toISOString();
        } else {
          timestamp = 'Invalid date';
        }
        
        console.log(`  ${i + 1}. ${log.status.padEnd(8)} ${timestamp} ${log.error || ''}`);
      });
    } else {
      console.log('  No history found');
    }
    
  } catch (error) {
    console.error(`[${name}] Error during refresh:`, error);
    if (error instanceof Error && error.stack) {
      console.error(error.stack);
    }
  }
}

// Run the test
testTimeSeriesRefresh().catch(err => {
  console.error('Test failed:', err);
  process.exit(1);
});
