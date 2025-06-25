import { initializeApp, getApps, getApp, App } from 'firebase-admin/app';
import { getFirestore, Firestore } from 'firebase-admin/firestore';
import * as admin from 'firebase-admin';

// Initialize Firebase Admin
let app: App;
let db: Firestore;

if (!getApps().length) {
  try {
    const isEmulator = process.env.FUNCTIONS_EMULATOR === 'true';
    console.log(`Initializing Firebase Admin. Emulator mode: ${isEmulator}`);

    // For production, this will use Application Default Credentials.
    // For local dev, it requires GOOGLE_APPLICATION_CREDENTIALS to be set.
    const appConfig = {
      credential: admin.credential.applicationDefault(),
      // The databaseURL is not strictly necessary for Firestore but good practice.
      databaseURL: `https://${process.env.GCLOUD_PROJECT}.firebaseio.com`,
    };

    app = initializeApp(appConfig);
    db = getFirestore(app);
    db.settings({ ignoreUndefinedProperties: true });

    // If using emulators, point the SDK to them.
    if (isEmulator) {
      console.log('Connecting to Firebase Emulators...');
      
      // Point to the auth emulator
      // This env var is read by the Admin SDK's auth().verifyIdToken() method.
      process.env.FIREBASE_AUTH_EMULATOR_HOST = 'localhost:9099';
      console.log(`FIREBASE_AUTH_EMULATOR_HOST set to: ${process.env.FIREBASE_AUTH_EMULATOR_HOST}`);

      // Firestore emulator host is set via another env var by the shell.
      // We can log it for confirmation.
      console.log(`FIRESTORE_EMULATOR_HOST is: ${process.env.FIRESTORE_EMULATOR_HOST}`);
    }
    
    console.log('Firebase Admin SDK initialized successfully.');

  } catch (error) {
    console.error('Failed to initialize Firebase Admin:', error);
    throw error;
  }
} else {
  // Use existing app if already initialized
  app = getApp();
  db = getFirestore(app);
  console.log('Using existing Firebase Admin SDK instance.');
}

export { app, db, admin };
