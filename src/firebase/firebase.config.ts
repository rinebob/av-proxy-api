import { initializeApp, FirebaseApp } from "firebase/app";
import { FIREBASE_CONFIG } from "../environments/secrets/secrets";

// Your web app's Firebase configuration
const firebaseConfig = {
    ...FIREBASE_CONFIG
};

// Initialize Firebase App
const app: FirebaseApp = initializeApp(firebaseConfig);

// Export the initialized app instance
export { app, firebaseConfig };
