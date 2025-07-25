import { FirestoreCollection } from '../src/v2/common/firestore/firestore-collections';
import { TimeSeriesDocument } from '../src/v2/common/common-av';
import * as dotenv from 'dotenv';
import * as path from 'path';
import { db } from '../src/firebase-admin-init';

// Load environment variables from .env.alpha-vantage-proxy-api
const envPath = path.resolve(__dirname, '..', '.env.alpha-vantage-proxy-api');
dotenv.config({ path: envPath });

// Parse command line arguments
const parseArgs = () => {
  const args = process.argv.slice(2);
  
  if (args.length === 0) {
    console.error('Error: No symbol provided. Usage: npx ts-node test-symbol-add.ts <symbol> [--debug] [--prod]');
    process.exit(1);
  }
  
  const symbol = args[0].toUpperCase();
  const isDebug = args.includes('--debug');
  const isProduction = args.includes('--prod');
  
  return { symbol, isDebug, isProduction };
};

// Initialize Firebase Admin with emulator settings
function setupEmulator() {
  // Set emulator environment variables if not already set
  process.env.FIRESTORE_EMULATOR_HOST = process.env.FIRESTORE_EMULATOR_HOST || 'localhost:8080';
  process.env['FUNCTIONS_EMULATOR'] = 'true';
  process.env['FIREBASE_AUTH_EMULATOR_HOST'] = 'localhost:9099';
  process.env['GCLOUD_PROJECT'] = process.env['GCLOUD_PROJECT'] || 'alpha-vantage-proxy-api';
  
  console.log('Firebase Emulator configured:');
  console.log(`- Firestore: ${process.env.FIRESTORE_EMULATOR_HOST}`);
  console.log(`- Auth: ${process.env['FIREBASE_AUTH_EMULATOR_HOST']}`);
  console.log(`- Project: ${process.env['GCLOUD_PROJECT']}`);
}

// Main function to run the test
async function main() {
  const { symbol, isDebug, isProduction } = parseArgs();
  
  console.log('=== Symbol Add Test Script ===');
  console.log(`Mode: ${isProduction ? 'Production' : 'Emulator'}`);
  console.log(`Symbol: ${symbol}`);
  console.log(`Debug mode: ${isDebug ? 'ON' : 'OFF'}`);
  console.log('=========================\n');
  
  if (isProduction) {
    console.error('Production testing not yet implemented for symbol add');
    process.exit(1);
  } else {
    // Setup emulator configuration
    setupEmulator();
    
    // Hardcoded values for other parameters
    const region = 'US';
    const currency = 'USD';
    const matchScore = 1.0;
    
    await testInEmulator(symbol, region, currency, matchScore, isDebug);
  }
}

async function testInEmulator(
  symbol: string, 
  region: string,
  currency: string,
  matchScore: number,
  isDebug: boolean = false
) {
  console.log('\n=== Testing with Emulator ===');
  console.log(`Emulator Host: ${process.env.FIRESTORE_EMULATOR_HOST}`);

  try {
    await addSymbolToTracked(symbol, region, currency, matchScore);
    console.log(`✅ Successfully added ${symbol} to tracked symbols`);
    
    // Wait a bit for the function to process
    console.log('Waiting for function to process...');
    await new Promise(resolve => setTimeout(resolve, 5000));
    
    // Verify the data was added to Firestore
    await verifyFirestoreUpdate(symbol);
  } catch (error) {
    console.error('Error in emulator test:', error);
  }
}

async function addSymbolToTracked(symbol: string, region: string, currency: string, matchScore: number) {
  // Ensure symbol is in uppercase for consistency
  const symbolUpper = symbol.toUpperCase();
  const now = new Date();
  const symbolDoc = {
    symbol: symbolUpper,
    name: `Test ${symbolUpper}`,
    type: 'Equity',
    region,
    marketOpen: '09:30',
    marketClose: '16:00',
    timezone: 'America/New_York',
    currency,
    matchScore: matchScore.toString(),
    isActive: true,
    refreshEnabled: true,
    lastUpdated: now,
    createdAt: now,
    // Optional test metadata
    testRun: true,
  };

  // Use the uppercase symbol as the document ID
  await db.collection(FirestoreCollection.TRACKED_SYMBOLS).doc(symbolUpper).set(symbolDoc, { merge: true });
  console.log(`Added/updated document for ${symbolUpper} in tracked-symbols`);
}

async function verifyFirestoreUpdate(symbol: string) {
  console.log('\n=== Verifying Firestore Update ===');
  
  try {
    // Check if the time series data was created
    const timeSeriesRef = db.collection(FirestoreCollection.TIME_SERIES)
      .doc(symbol)
      .collection(FirestoreCollection.DAILY)
      .doc(`av-${FirestoreCollection.DAILY}`);
    
    const doc = await timeSeriesRef.get();
    
    if (!doc.exists) {
      console.error('❌ Time series document was not found at path:', timeSeriesRef.path);
      return false;
    }
    
    const data = doc.data() as TimeSeriesDocument;
    console.log('✅ Found time series document with data points:', data?.metadata?.histDataPoints || 0);
    return true;
  } catch (error) {
    console.error('Error verifying Firestore update:', error);
    return false;
  }
}

// Run the main function
if (require.main === module) {
  main().catch(console.error);
}
