import * as admin from 'firebase-admin';
import { FieldValue } from 'firebase-admin/firestore';

// Initialize Firebase Admin SDK if not already initialized
if (!admin.apps.length) {
  // Prefer default initialization so runtime provides correct project/credentials
  admin.initializeApp();

  // Optional: connect to Firestore emulator only if explicitly set via env
  const emulatorHost = process.env.FIRESTORE_EMULATOR_HOST;
  if (emulatorHost) {
    // Example: localhost:8080
    const [host, portStr] = emulatorHost.split(':');
    const port = Number(portStr) || undefined;
    // Apply settings in a single call; include ignoreUndefinedProperties always
    admin.firestore().settings({
      host: port ? `${host}:${port}` : host,
      ssl: false,
      ignoreUndefinedProperties: true,
    });
  } else {
    // Ensure undefined values are ignored in all environments
    admin.firestore().settings({ ignoreUndefinedProperties: true });
  }

  // One-time startup diagnostics (non-sensitive)
  // Helps detect accidental emulator usage or missing env during deploy
  try {
    const projectId = process.env.GCP_PROJECT || process.env.GCLOUD_PROJECT || process.env.FIREBASE_CONFIG;
    console.log('[firebase-admin-init] Admin initialized', {
      emulator: !!process.env.FIRESTORE_EMULATOR_HOST,
      projectIdMeta: projectId ? String(projectId).substring(0, 80) : 'unknown',
      nodeVersion: process.version,
    });
  } catch {
    // no-op
  }
}

// Initialize Firestore
const db = admin.firestore();

// Export the initialized instances
export { admin, db };
export { FieldValue };
