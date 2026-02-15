import { db, admin } from '../../src/firebase-admin-init';
import { AlphaVantageEndpoint } from '@shared/alpha-vantage';
import { AlphaVantageHandlerFactory } from '../../src/v2/alpha-vantage/alpha-vantage-factory';

console.log('Script started');
console.log('Initializing Firebase Admin...');

// Initialize Firebase Admin
try {
  db;
  admin;
  console.log('Firebase Admin initialized successfully');
} catch (error) {
  console.error('Failed to initialize Firebase Admin:', error);
  process.exit(1);
}

async function testDailyUpdate() {
  console.log('Starting test of daily time series update...');
  try {
    // Create a handler for daily adjusted time series
    const handler = AlphaVantageHandlerFactory.createHandler(AlphaVantageEndpoint.TIME_SERIES_DAILY_ADJUSTED);
    
    // Test with a specific symbol
    const symbol = 'AAPL'; // or get this from command line args if needed
    console.log(`Fetching daily time series for ${symbol}...`);
    
    const result = await handler.fetch({ symbol });
    console.log('Successfully fetched time series data:', {
      symbol,
      dataPoints: result.data?.data ? Object.keys(result.data.data).length : 0,
      metadata: result.data?.meta
    });
    
    console.log('Test completed successfully');
  } catch (error) {
    console.error('Test failed with error:', error);
    process.exit(1);
  } finally {
    console.log('Test execution completed');
    process.exit(0);
  }
}

// Execute the test
console.log('About to start test...');
testDailyUpdate().catch(error => {
  console.error('Unhandled error in test:', error);
  process.exit(1);
});