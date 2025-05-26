import { ApplicationConfig, provideZoneChangeDetection } from '@angular/core';
import { provideRouter } from '@angular/router';
import { provideHttpClient } from '@angular/common/http';

import { initializeApp, provideFirebaseApp } from '@angular/fire/app';
import { connectAuthEmulator, getAuth, provideAuth } from '@angular/fire/auth';
import { connectFirestoreEmulator, getFirestore, provideFirestore } from '@angular/fire/firestore';
import { connectFunctionsEmulator, getFunctions, provideFunctions } from '@angular/fire/functions';

import { environment } from '../environments/environment';
import { routes } from './app.routes';
import { app } from '../firebase/firebase.config'; // Adjust the path

export const appConfig: ApplicationConfig = {
  providers: [
    provideZoneChangeDetection({ eventCoalescing: true }),
    provideRouter(routes),
    provideHttpClient(), 

    provideFirebaseApp(() => initializeApp(environment.firebaseConfig)),

    provideAuth(() => {
      const auth = getAuth(app);
       if (!environment.production) {
        connectAuthEmulator(auth, 'http://127.0.0.1:9099');
      }
      return auth;
    }),

    provideFirestore(() => {
      const firestore = getFirestore(app);
      if (!environment.production) {
        connectFirestoreEmulator(firestore, '127.0.0.1', 8080);
      }
      return firestore;
    }),

    provideFunctions(() => {
      const functions = getFunctions(app);
       if (!environment.production) {
        connectFunctionsEmulator(functions, '127.0.0.1', 5001);
      }
      return functions;
    }),
      
  ]
};



