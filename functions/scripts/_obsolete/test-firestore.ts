import { onRequest } from 'firebase-functions/v2/https';
import { defineString } from 'firebase-functions/params';
import { db } from '../../src/firebase-admin-init';

const region = defineString('REGION', { default: 'us-central1' });

async function testFirestoreConnection() {
  console.log('Starting Firestore connection test...');
  
  try {
    console.log('1. Attempting to list collections...');
    const collections = await db.listCollections();
    console.log('✅ Successfully listed collections:', collections.map(c => c.id));

    console.log('\n2. Attempting to read test document...');
    const testDoc = await db.collection('test').doc('test').get();
    
    if (testDoc.exists) {
      console.log('✅ Test document exists:', testDoc.data());
    } else {
      console.log('ℹ️ Test document does not exist (this is expected)');
      
      // Try writing a test document
      console.log('\n3. Attempting to write test document...');
      await db.collection('test').doc('test').set({
        message: 'This is a test document',
        timestamp: new Date().toISOString()
      });
      console.log('✅ Successfully wrote test document');
      
      // Read it back
      const newDoc = await db.collection('test').doc('test').get();
      console.log('✅ Successfully read back test document:', newDoc.data());
    }
    
    console.log('\n🔥 Firestore test completed successfully!');
    return true;
    
  } catch (error: unknown) {
    const err = error as Error & { code?: string; details?: any };
    console.error('\n❌ Firestore test failed with error:');
    console.error(err);
    
    if ('code' in err) {
      console.error('Error code:', err.code);
      console.error('Error message:', err.message);
      
      if (err.details) {
        console.error('Error details:', err.details);
      }
    }
    
    return false;
  }
}

// Execute the test when run directly
if (require.main === module) {
  console.log('Running Firestore connection test...');
  testFirestoreConnection()
    .then(success => {
      console.log(success ? '✅ All tests passed!' : '❌ Some tests failed');
      process.exit(success ? 0 : 1);
    })
    .catch(error => {
      console.error('Unhandled error in test:', error);
      process.exit(1);
    });
}

// Export for use in HTTP function
export const testFirestore = onRequest(
  {
    // Pass the Param directly to avoid evaluating .value() at deploy time
    region,
    cors: true,
  },
  async (req, res) => {
    try {
      const success = await testFirestoreConnection();
      res.status(200).json({ 
        success: success, 
        message: success ? 'Firestore test completed successfully' : 'Firestore test failed'
      });
    } catch (error: unknown) {
      const err = error as Error & { code?: string; details?: any };
      console.error('Firestore test error:', {
        message: err.message,
        code: err.code,
        stack: err.stack
      });
      res.status(500).json({ 
        success: false, 
        error: err.message,
        code: err.code
      });
    }
  }
);
