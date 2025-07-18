import { getApp, App } from 'firebase-admin/app';
import { getFirestore, Firestore, FieldValue } from 'firebase-admin/firestore';
import * as admin from 'firebase-admin';

// Initialize Firebase Admin SDK
let app: App;
let db: Firestore;

if (process.env.FUNCTIONS_EMULATOR === 'true') {
  // In emulator mode, the SDK is initialized automatically, 
  // but we can still configure it if needed.
  if (!admin.apps.length) {
    admin.initializeApp({
      // Point to the emulator's Firestore if needed
      // credential: admin.credential.applicationDefault(),
      // databaseURL: 'http://localhost:8080'
    });
    console.log('Firebase Admin SDK initialized for EMULATOR.');
  } else {
    console.log('Firebase Admin SDK already initialized for EMULATOR.');
  }
} else {
  // In a deployed environment, initialize with parameter-less call.
  // It automatically uses the correct service account and credentials.
  if (!admin.apps.length) {
    admin.initializeApp();
    console.log('Firebase Admin SDK initialized for PRODUCTION.');
  } else {
    console.log('Firebase Admin SDK already initialized for PRODUCTION.');
  }
}

// Initialize Firestore
app = getApp();
db = getFirestore(app);
db.settings({ ignoreUndefinedProperties: true });

// If using emulators, point the SDK to them.
if (process.env.FUNCTIONS_EMULATOR === 'true') {
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

// Export the initialized instances
export { admin, db, FieldValue };
