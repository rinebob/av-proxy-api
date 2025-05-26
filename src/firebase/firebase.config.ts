import { initializeApp, FirebaseApp } from "firebase/app";
import { environment } from "../environments/environment";

// Initialize Firebase App
const app: FirebaseApp = initializeApp(environment.firebaseConfig);

// Export the initialized app instance
export { app };
