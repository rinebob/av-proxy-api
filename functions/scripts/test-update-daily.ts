import { db, admin } from '../src/firebase-admin-init';
import { AlphaVantageEndpoint } from '@shared/alpha-vantage';
import { AlphaVantageHandlerFactory } from '../src/v2/alpha-vantage/alpha-vantage-factory';

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
  console.log('Starting test of updateDailyTimeSeriesHandler...');
  try {
    console.log('Calling updateDailyTimeSeriesHandler...');
    await updateDailyTimeSeriesHandler();
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