import { FIREBASE_CONFIG } from "./secrets";

export const environment = {
  production: false,
  useEmulator: true,
  firebaseConfig: {
    ...FIREBASE_CONFIG
  },
  // Local emulator URL for all Cloud Functions
  functionsBaseUrl: 'http://localhost:5001/alpha-vantage-proxy-api/us-central1',
  // Production URL (will be used in environment.prod.ts)
  // functionsBaseUrl: 'https://us-central1-alpha-vantage-proxy-api.cloudfunctions.net'
};
