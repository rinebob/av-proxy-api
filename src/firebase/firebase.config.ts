import { initializeApp, FirebaseApp } from "firebase/app";

// Your web app's Firebase configuration
const firebaseConfig = {
    apiKey: "AIzaSyB3Pr7nLxdN0Nt75Lnh8f6TEHY2eBkt6DQ",
    authDomain: "alpha-vantage-proxy-api.firebaseapp.com",
    projectId: "alpha-vantage-proxy-api",
    storageBucket: "alpha-vantage-proxy-api.firebasestorage.app",
    messagingSenderId: "29825344315",
    appId: "1:29825344315:web:a4b3fdbe30b43e6a820d1e"
};

// Initialize Firebase App
const app: FirebaseApp = initializeApp(firebaseConfig);

// Export the initialized app instance
export { app, firebaseConfig };
