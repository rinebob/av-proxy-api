import { FIREBASE_CONFIG } from "./secrets";

export const environment = {
  production: true,
  useEmulator: false,  // Always false in production
  firebaseConfig: {
    ...FIREBASE_CONFIG
  },
  // Production Cloud Functions URL
  apiBaseUrl: 'https://us-central1-alpha-vantage-proxy-api.cloudfunctions.net'
};
