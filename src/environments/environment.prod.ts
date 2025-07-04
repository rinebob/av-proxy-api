import { FIREBASE_CONFIG } from "./secrets";

export const environment = {
  production: true,
  useEmulator: false,  // Always false in production
  firebaseConfig: {
    ...FIREBASE_CONFIG
  },
  adminEmails: [
    'rinebob111185@gmail.com',
    // Add other admin emails as needed
  ]
};
