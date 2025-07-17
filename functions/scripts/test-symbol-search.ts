import { AvSymbolSearchHandler } from '../src/v2/alpha-vantage/handlers/av-symbol-search.handler';
import { db } from '../src/firebase-admin-init';
import { FirestoreCollection } from '../src/v2/common/firestore-collections';
import * as dotenv from 'dotenv';
import * as path from 'path';
import axios from 'axios';

// Load environment variables from .env.alpha-vantage-proxy-api
const envPath = path.resolve(__dirname, '..', '.env.alpha-vantage-proxy-api');
dotenv.config({ path: envPath });

// Parse command line arguments
const args = process.argv.slice(2);
const isProduction = args.includes('--prod');
const isDebug = args.includes('--debug');
const keywords = args.find(arg => !arg.startsWith('--')) || 'microsoft';

// Environment configuration
const API_KEY = process.env['LOCAL_EMULATOR_ALPHAVANTAGE_API_KEY'];
if (!API_KEY) {
  console.error('Error: LOCAL_EMULATOR_ALPHAVANTAGE_API_KEY is not set in .env.alpha-vantage-proxy-api');
  process.exit(1);
}

console.log('=== Symbol Search Test Script ===');
console.log(`Mode: ${isProduction ? 'Production' : 'Emulator'}`);
console.log(`Keywords: ${keywords}`);
console.log(`Debug mode: ${isDebug ? 'ON' : 'OFF'}`);

async function testInEmulator(keywords: string) {
  // Set up emulator configuration
  process.env.FIRESTORE_EMULATOR_HOST = process.env.FIRESTORE_EMULATOR_HOST || 'localhost:8080';
  process.env['GCLOUD_PROJECT'] = process.env['GCLOUD_PROJECT'] || 'alpha-vantage-proxy-api';

  console.log('\n=== Testing with Emulator ===');
  console.log(`Emulator Host: ${process.env.FIRESTORE_EMULATOR_HOST}`);

  try {
    // Initialize Firestore emulator settings
    if (!(db as any)._settingsFrozen) {
      (db as any).settings({
        host: process.env.FIRESTORE_EMULATOR_HOST,
        ssl: false
      });
    }

    const handler = new AvSymbolSearchHandler();
    const startTime = Date.now();
    const response = await handler.fetch({ keywords });
    const duration = Date.now() - startTime;
    
    logResponse(keywords, response.data, duration);
    
    if (response.data.bestMatches?.length > 0) {
      await verifyFirestoreUpdate(response.data.bestMatches[0]['1. symbol']);
    }
  } catch (error) {
    console.error('Error in emulator test:', error);
  }
}

async function testInProduction(keywords: string, debug: boolean = false) {
  console.log('\n=== Testing in Production ===');
  
  const projectId = process.env['GCLOUD_PROJECT'];
  if (!projectId) {
    console.error('Error: GCLOUD_PROJECT environment variable is not set');
    process.exit(1);
  }

  try {
    // First, show the raw Alpha Vantage response
    console.log('\n=== 1. RAW ALPHA VANTAGE RESPONSE ===');
    const avUrl = `https://www.alphavantage.co/query?function=SYMBOL_SEARCH&keywords=${encodeURIComponent(keywords)}&apikey=${process.env['ALPHA_VANTAGE_API_KEY']}`;
    console.log(`\nSending request to: ${avUrl}`);
    
    const avStartTime = Date.now();
    const avResponse = await axios.get(avUrl);
    const avDuration = Date.now() - avStartTime;
    
    console.log(`Status: ${avResponse.status}`);
    console.log(`Duration: ${avDuration}ms`);
    console.log('Response:', JSON.stringify(avResponse.data, null, 2));
    
    // Then show our Firebase function response
    console.log('\n=== 2. OUR FIREBASE FUNCTION RESPONSE ===');
  
    // Use the Cloud Run URL directly from the deployment output
    const cloudRunUrl = 'https://alphavantageapiv2-lsluydmucq-uc.a.run.app';
    const functionUrl = `${cloudRunUrl}/SYMBOL_SEARCH`;
  
    console.log(`Sending request to: ${functionUrl}?keywords=${encodeURIComponent(keywords)}`);
  
    try {
      const response = await axios.get(functionUrl, {
        params: { keywords }
      });
      
      console.log('Status:', response.status);
      
      // Handle nested response structure
      const responseData = response.data?.data?.data || response.data?.data || response.data;
      console.log('Response:', JSON.stringify(responseData, null, 2));
      
      // If we have bestMatches in the response, log them
      if (responseData?.bestMatches?.length > 0) {
        console.log('\nFound matches:');
        responseData.bestMatches.forEach((match: any, index: number) => {
          console.log(`\nMatch ${index + 1}:`);
          console.log(`  Symbol: ${match['1. symbol']}`);
          console.log(`  Name: ${match['2. name']}`);
          console.log(`  Region: ${match['4. region']}`);
          console.log(`  Match Score: ${match['9. matchScore']}`);
        });
      } else {
        console.log('No matches found in response');
      }
    } catch (error: any) {
      console.error('Error in production test:', error.message);
      if (error.response) {
        console.error('Response data:', error.response.data);
        console.error('Response status:', error.response.status);
        console.error('Response headers:', error.response.headers);
      }
    }
  } catch (error: any) {
    console.error('Error in production test:');
    if (error.response) {
      console.error(`Status: ${error.response.status}`);
      console.log('Response:', JSON.stringify(error.response.data, null, 2));
      if (error.response.data?.details) {
        console.error('Details:', error.response.data.details);
      }
    } else if (error.request) {
      console.error('No response received:', error.request);
    } else {
      console.error('Error:', error.message);
    }
  }
}

function logResponse(keywords: string, data: any, duration: number) {
  console.log('\n=== Response ===');
  console.log(`Keywords: ${keywords}`);
  console.log(`Duration: ${duration}ms`);
  console.log(`Message: ${data.message || 'N/A'}`);
  
  if (data.bestMatches?.length > 0) {
    logMatches(data.bestMatches);
  } else {
    console.log('No matches found');
  }
}

function logMatches(matches: any[]) {
  console.log('\n=== Best Matches ===');
  matches.forEach((match, index) => {
    console.log(`\nMatch #${index + 1}:`);
    console.log(`  Symbol: ${match['1. symbol']}`);
    console.log(`  Name: ${match['2. name']}`);
    console.log(`  Type: ${match['3. type']}`);
    console.log(`  Region: ${match['4. region']}`);
    console.log(`  Market: ${match['5. marketOpen']} - ${match['6. marketClose']} ${match['7. timezone']}`);
    console.log(`  Currency: ${match['8. currency']}`);
    console.log(`  Match Score: ${match['9. matchScore']}`);
  });
}

async function verifyFirestoreUpdate(symbol: string) {
  console.log(`\nVerifying Firestore update for symbol: ${symbol}`);
  const docRef = db.collection(FirestoreCollection.TRACKED_SYMBOLS).doc(symbol);
  
  try {
    await new Promise(resolve => setTimeout(resolve, 1000));
    const doc = await docRef.get();
    
    if (doc.exists) {
      console.log(`✅ Symbol ${symbol} exists in Firestore`);
      console.log('Document data:', doc.data());
    } else {
      console.log(`❌ Symbol ${symbol} not found in Firestore`);
    }
  } catch (error) {
    console.error('Error verifying Firestore update:', error);
  }
}

// Main execution
(async () => {
  try {
    if (isProduction) {
      await testInProduction(keywords, isDebug);
    } else {
      await testInEmulator(keywords);
    }
  } catch (error) {
    console.error('Test failed:', error);
    process.exit(1);
  } finally {
    process.exit(0);
  }
})();
