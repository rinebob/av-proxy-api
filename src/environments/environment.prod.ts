import { FIREBASE_CONFIG } from "./secrets";

export const environment = {
    production: true,
    firebaseConfig: {
      ...FIREBASE_CONFIG
    }
  };
