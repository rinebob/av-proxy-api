/**
 * Sets up environment variables for Firebase Emulator Suite usage.
 * Call this before importing any firebase-admin or Firestore code in scripts.
 */
export function setupEmulator() {
  const disable = (process.env.USE_EMULATOR_SCRIPTS || '').toLowerCase();
  if (disable === '0' || disable === 'false' || disable === 'off') {
    return;
  }
  process.env.FIRESTORE_EMULATOR_HOST = process.env.FIRESTORE_EMULATOR_HOST || 'localhost:8080';
  process.env['FUNCTIONS_EMULATOR'] = 'true';
  process.env['FIREBASE_AUTH_EMULATOR_HOST'] = 'localhost:9099';
  process.env['GCLOUD_PROJECT'] = process.env['GCLOUD_PROJECT'] || 'alpha-vantage-proxy-api';
  // Optionally log for debug
  console.log('fn scripts setupEmulator - Firebase Emulator configured:');
  console.log(`- Firestore: ${process.env.FIRESTORE_EMULATOR_HOST}`);
  console.log(`- Auth: ${process.env['FIREBASE_AUTH_EMULATOR_HOST']}`);
  console.log(`- Project: ${process.env['GCLOUD_PROJECT']}`);
}
