import { FIREBASE_CONFIG } from "./secrets";

export const environment = {
    production: false,
    firebaseConfig: {
      ...FIREBASE_CONFIG
    }
  };
