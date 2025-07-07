import * as admin from 'firebase-admin';
import { FirestoreCollection } from '../functions/src/common/firestore-collections';

// Extend NodeJS.ProcessEnv to include our custom environment variables
declare global {
  namespace NodeJS {
    interface ProcessEnv {
      FIRESTORE_EMULATOR_HOST?: string;
    }
  }
}

// Configuration - Update these values to match your emulator setup
const EMULATOR_PROJECT_ID = 'alpha-vantage-proxy-api'; // Match your emulator project ID
const EMULATOR_FIRESTORE_HOST = 'localhost';
const EMULATOR_FIRESTORE_PORT = 8080; // Default Firestore emulator port

/**
 * Script to migrate documents from 'tracked_symbols' to 'tracked-symbols' collection
 * in the local Firestore emulator.
 * 
 * Prerequisites:
 * 1. Make sure Firebase emulators are running:
 *    `firebase emulators:start`
 * 
 * 2. Run this script with:
 *    `npx ts-node scripts/migrate-tracked-symbols.ts`
 * 
 * 3. After successful migration, update your frontend code to use 'tracked-symbols'
 */
async function runMigration() {
  console.log('Starting migration of tracked symbols collection...');
  
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
    const OLD_COLLECTION = 'tracked_symbols';
    const NEW_COLLECTION = FirestoreCollection.TRACKED_SYMBOLS;
    const BATCH_SIZE = 500;
    
    console.log(`Migrating from '${OLD_COLLECTION}' to '${NEW_COLLECTION}'`);
    
    // Get all documents from old collection
    const oldDocsSnapshot = await db.collection(OLD_COLLECTION).get();
    const totalDocs = oldDocsSnapshot.size;
    
    if (totalDocs === 0) {
      console.log('No documents to migrate');
      return;
    }
    
    console.log(`Found ${totalDocs} documents to migrate`);
    
    // Process in batches
    let migratedCount = 0;
    const batches: Promise<FirebaseFirestore.WriteResult[]>[] = [];
    let currentBatch = db.batch();
    let operationCount = 0;
    
    for (const doc of oldDocsSnapshot.docs) {
      const newDocRef = db.collection(NEW_COLLECTION).doc(doc.id);
      currentBatch.set(newDocRef, doc.data());
      operationCount++;
      migratedCount++;
      
      if (operationCount >= BATCH_SIZE) {
        console.log(`Committing batch of ${operationCount} operations`);
        batches.push(currentBatch.commit());
        currentBatch = db.batch();
        operationCount = 0;
      }
    }
    
    // Commit any remaining operations
    if (operationCount > 0) {
      console.log(`Committing final batch of ${operationCount} operations`);
      batches.push(currentBatch.commit());
    }
    
    // Wait for all batches to complete
    await Promise.all(batches);
    
    console.log(`✅ Successfully migrated ${migratedCount} documents`);
    console.log(`\nNext steps:`);
    console.log('1. Verify the data in the Firestore emulator UI');
    console.log('2. Update your frontend code to use the new collection name');
    console.log('3. (Optional) Delete the old collection with the cleanup script');
    
  } catch (error) {
    console.error('❌ Migration failed:', error);
    process.exit(1);
  }
}

// Run the migration
runMigration().catch(console.error);
