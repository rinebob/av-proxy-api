// IMPORTANT: Set all environment variables BEFORE importing any other modules.
// This ensures that firebase-admin-init initializes with the correct emulator settings.
import * as dotenv from 'dotenv';
dotenv.config({ path: '../../.env.alpha-vantage-proxy-api' });

if (!process.env['NODE_ENV'] || process.env['NODE_ENV'] !== 'production') {
  process.env['FUNCTIONS_EMULATOR'] = 'true';
  process.env['FIRESTORE_EMULATOR_HOST'] = 'localhost:8080';
  process.env['FIREBASE_AUTH_EMULATOR_HOST'] = 'localhost:9099';
  process.env['GCLOUD_PROJECT'] = 'alpha-vantage-proxy-api';
}

// Now that environment is configured, import the db instance.
import { db } from '../src/firebase-admin-init';
import axios from 'axios';
import { TrackedSymbol } from '../src/v2/common/common-dm';
import { FirestoreCollection } from '../src/v2/common/firestore/firestore-collections';

const args = process.argv.slice(2);
const isProduction = args.includes('--prod');
const isDebug = args.includes('--debug');
const symbol = args.find(arg => !arg.startsWith('--'))?.toUpperCase();

if (!symbol) {
  console.error('Error: No symbol provided. Usage: npx ts-node test-save-tracked-symbol.ts <symbol> [--prod] [--debug]');
  process.exit(1);
}

console.log('=== Save Tracked Symbol Test Script ===');
console.log(`Mode: ${isProduction ? 'Production' : 'Emulator'}`);
console.log(`Symbol: ${symbol}`);
console.log(`Debug mode: ${isDebug ? 'ON' : 'OFF'}`);

async function testInEmulator(symbol: string) {
  const projectId = process.env['GCLOUD_PROJECT'];
  const region = 'us-central1'; // Or your function's region
  const functionName = 'saveTrackedSymbol';
  const url = `http://localhost:5001/${projectId}/${region}/${functionName}`;

  console.log('\n=== Testing with Emulator ===');
  console.log(`Calling function at: ${url}`);

  try {
    const testSymbol: Omit<TrackedSymbol, 'createdAt' | 'lastUpdated'> = {
      symbol: symbol,
      name: `${symbol} Test Company`,
      type: 'Equity',
      region: 'United States',
      marketOpen: '09:30',
      marketClose: '16:00',
      timezone: 'UTC-05',
      currency: 'USD',
      matchScore: '1.0'
    };

    const response = await axios.post(url, 
      { data: testSymbol },
      {
        headers: {
          // In the emulator, a valid token is not strictly required unless your rules are tight.
          // A non-empty string is often sufficient to populate `request.auth`.
          Authorization: 'Bearer owner',
          'Content-Type': 'application/json',
        },
      }
    );

    console.log('\n=== Function Response ===');
    console.log(response.data);

    await verifyFirestoreUpdate(symbol);

  } catch (error) {
    if (axios.isAxiosError(error)) {
      console.error('Axios Error:', error.response?.data || error.message);
    } else {
      console.error('Error calling function:', error);
    }
  }
}

async function testInProduction(symbol: string) {
    console.log('\nProduction test script is not implemented for this function yet.');
    console.log('Please run against the emulator.');
}

async function verifyFirestoreUpdate(symbol: string) {
  console.log(`\nVerifying Firestore for symbol: ${symbol}...`);
  try {
    const docId = symbol.toUpperCase();
    const docRef = db.collection(FirestoreCollection.TRACKED_SYMBOLS).doc(docId);
    const doc = await docRef.get();

    if (doc.exists) {
      console.log('✅ Success: Document found in Firestore.');
      if (isDebug) {
        console.log('Document data:', doc.data());
      }
    } else {
      console.error('❌ Error: Document not found in Firestore.');
    }
  } catch (error) {
    console.error('❌ Error verifying Firestore:', error);
  }
}

if (isProduction) {
  testInProduction(symbol);
} else {
  testInEmulator(symbol);
}