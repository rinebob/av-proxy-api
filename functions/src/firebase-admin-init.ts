import { initializeApp, getApps, getApp, App } from 'firebase-admin/app';
import { getFirestore, Firestore } from 'firebase-admin/firestore';

// Initialize Firebase Admin
let app: App;
let db: Firestore;

if (!getApps().length) {
  // Initialize the default app if it doesn't exist
  app = initializeApp();
  db = getFirestore(app);
  
  // Set Firestore settings if needed
  db.settings({ ignoreUndefinedProperties: true });
  
  console.log('Firebase Admin SDK initialized successfully');
} else {
  // Use existing app if already initialized
  app = getApp();
  db = getFirestore(app);
}

export { app, db };
