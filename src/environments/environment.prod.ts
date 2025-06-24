import { FIREBASE_CONFIG } from "./secrets";

export const environment = {
  production: true,
  useEmulator: false,  // Always false in production
  firebaseConfig: {
    ...FIREBASE_CONFIG
  },
  // Base URL for all Cloud Functions in production
  functionsBaseUrl: 'https://us-central1-alpha-vantage-proxy-api.cloudfunctions.net'
};
