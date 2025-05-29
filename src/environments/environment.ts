import { FIREBASE_CONFIG } from "./secrets";

export const environment = {
    production: false,
    useEmulator: true,  // Set to false in environment.prod.ts
    firebaseConfig: {
      ...FIREBASE_CONFIG
    }
  };
