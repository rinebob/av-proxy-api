import { FIREBASE_CONFIG } from "./secrets";

export const environment = {
  DM_API_URL: 'http://localhost:5001/alpha-vantage-proxy-api/us-central1/fetchAndStoreData',
  production: false,
  useEmulator: true,
  firebaseConfig: {
    ...FIREBASE_CONFIG
  }
};
