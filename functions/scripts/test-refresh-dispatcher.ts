import * as admin from 'firebase-admin';
import { DataMaintainerEndpoint } from '../src/common/common-dm';
import { TRACKED_SYMBOLS } from '../src/common/firestore-collections';

// Initialize Firebase Admin
const serviceAccount = require('../../service-account.json');
admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
  databaseURL: `https://${process.env.GCLOUD_PROJECT}.firebaseio.com`
});

const db = admin.firestore();

// Test data
const TEST_SYMBOL = 'AAPL';
const TEST_ENDPOINTS: DataMaintainerEndpoint[] = [
  DataMaintainerEndpoint.TIME_SERIES_DAILY_ADJUSTED,
  DataMaintainerEndpoint.GLOBAL_QUOTE,
  DataMaintainerEndpoint.COMPANY_OVERVIEW
];

async function testRefreshDispatcher() {
  console.log('Starting refresh dispatcher test...');
  
  // 1. Add a test symbol to tracked symbols if it doesn't exist
  const symbolRef = db.collection(TRACKED_SYMBOLS).doc(TEST_SYMBOL);
  const symbolDoc = await symbolRef.get();
  
  if (!symbolDoc.exists) {
    console.log(`Adding test symbol ${TEST_SYMBOL} to tracked symbols...`);
    await symbolRef.set({
      symbol: TEST_SYMBOL,
      isActive: true,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      lastUpdated: admin.firestore.FieldValue.serverTimestamp()
    });
    console.log(`Added ${TEST_SYMBOL} to tracked symbols`);
  } else {
    console.log(`Test symbol ${TEST_SYMBOL} already exists`);
  }
  
  // 2. Import and call the refreshAllData function
  const { refreshAllData } = await import('../src/data-maintainer/refreshDispatcher');
  
  console.log('Running refreshAllData...');
  try {
    await refreshAllData();
    console.log('Refresh completed successfully');
    
    // 3. Verify data was refreshed
    console.log('Verifying data was refreshed...');
    for (const endpoint of TEST_ENDPOINTS) {
      const docRef = db.collection('market_data')
        .doc(TEST_SYMBOL)
        .collection('data_points')
        .doc(endpoint);
      
      const doc = await docRef.get();
      if (doc.exists) {
        const data = doc.data();
        console.log(`✅ ${endpoint} data exists`);
        console.log(`   Last refreshed: ${data?.lastRefreshed?.toDate?.() || 'N/A'}`);
        console.log(`   Status: ${data?.status || 'N/A'}`);
      } else {
        console.log(`❌ ${endpoint} data does not exist`);
      }
    }
  } catch (error) {
    console.error('Error during refresh:', error);
    process.exit(1);
  }
  
  console.log('Test completed');
  process.exit(0);
}

// Run the test
testRefreshDispatcher().catch(console.error);
