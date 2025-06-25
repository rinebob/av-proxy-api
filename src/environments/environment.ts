import { FIREBASE_CONFIG } from "./secrets";

export const environment = {
  production: false,
  useEmulator: true,
  firebaseConfig: {
    ...FIREBASE_CONFIG
  }
};
