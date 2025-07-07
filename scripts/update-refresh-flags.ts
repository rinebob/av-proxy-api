import * as admin from 'firebase-admin';
import { FirestoreCollection } from '../functions/src/common/firestore-collections';

// Configuration - Update these values to match your emulator setup
const EMULATOR_PROJECT_ID = 'alpha-vantage-proxy-api';
const EMULATOR_FIRESTORE_HOST = 'localhost';
const EMULATOR_FIRESTORE_PORT = 8080;

// Symbols that should have refreshEnabled: true
const ENABLED_SYMBOLS = new Set(['NVDA', 'AAPL']);

async function updateRefreshFlags() {
  console.log('Starting update of refresh flags...');
  
  try {
    // Set the Firestore emulator host before initializing the app
    process.env['FIRESTORE_EMULATOR_HOST'] = `${EMULATOR_FIRESTORE_HOST}:${EMULATOR_FIRESTORE_PORT}`;
    
    // Initialize the Admin SDK with emulator settings
    if (!admin.apps.length) {
      admin.initializeApp({
        projectId: EMULATOR_PROJECT_ID,
        credential: admin.credential.applicationDefault(),
        storageBucket: `${EMULATOR_PROJECT_ID}.appspot.com`
      });
    }
    
    const db = admin.firestore();
    const BATCH_SIZE = 500;
    
    // Get all documents from tracked-symbols
    const snapshot = await db.collection(FirestoreCollection.TRACKED_SYMBOLS).get();
    const totalDocs = snapshot.size;
    
    if (totalDocs === 0) {
      console.log('No documents to update');
      return;
    }
    
    console.log(`Found ${totalDocs} documents to process`);
    
    // Process in batches
    let updatedCount = 0;
    let currentBatch = db.batch();
    let operationCount = 0;
    
    for (const doc of snapshot.docs) {
      const symbol = doc.id;
      const shouldEnable = ENABLED_SYMBOLS.has(symbol);
      
      // Only update if the field doesn't exist or needs to be changed
      if (doc.get('refreshEnabled') !== shouldEnable) {
        currentBatch.update(doc.ref, { refreshEnabled: shouldEnable });
        operationCount++;
        updatedCount++;
        
        if (operationCount >= BATCH_SIZE) {
          console.log(`Committing batch of ${operationCount} operations`);
          await currentBatch.commit();
          currentBatch = db.batch();
          operationCount = 0;
        }
      }
    }
    
    // Commit any remaining operations
    if (operationCount > 0) {
      console.log(`Committing final batch of ${operationCount} operations`);
      await currentBatch.commit();
    }
    
    console.log(`Successfully updated refresh flags for ${updatedCount} symbols`);
    console.log('Refresh flags update completed!');
    
  } catch (error) {
    console.error('Error during refresh flags update:', error);
    throw error;
  }
}

// Run the update
updateRefreshFlags().catch(console.error);
