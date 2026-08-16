import { ApplicationConfig, provideZoneChangeDetection, NgZone, Injector, provideAppInitializer } from '@angular/core';
import { provideRouter } from '@angular/router';
import { provideHttpClient, withInterceptors } from '@angular/common/http';
import { provideAnimations } from '@angular/platform-browser/animations';
import { authInterceptor } from './core/auth/auth.interceptor';

// Import FirebaseApp and service types for return type annotations
import { initializeApp, provideFirebaseApp, FirebaseApp } from '@angular/fire/app';
import { connectAuthEmulator, getAuth, provideAuth, Auth } from '@angular/fire/auth';
import { connectFirestoreEmulator, getFirestore, provideFirestore, Firestore } from '@angular/fire/firestore';
import { connectFunctionsEmulator, getFunctions, provideFunctions, Functions } from '@angular/fire/functions';

// Material modules
import { provideNativeDateAdapter } from '@angular/material/core';

import { registerLicense } from '@syncfusion/ej2-base';
import { SYNC_FUSION_LICENSE_KEY } from '../secrets/syncfusion-license';

registerLicense(SYNC_FUSION_LICENSE_KEY);

import { environment } from '../environments/environment';
import { routes } from './app.routes';
import { API_BASES, type ApiBases } from './core/api/api.tokens';
import { Observable } from 'rxjs';

export const appConfig: ApplicationConfig = {
  providers: [
    provideZoneChangeDetection({ eventCoalescing: true }),
    provideAnimations(),
    provideNativeDateAdapter(),
    provideRouter(routes),
    provideHttpClient(
      withInterceptors([authInterceptor])
    ),

    provideFirebaseApp(() => initializeApp(environment.firebaseConfig)),

    provideAuth((injector: Injector): Auth => {
      const zone = injector.get(NgZone);
      const firebaseApp = injector.get(FirebaseApp); // Get FirebaseApp from DI
      return zone.run(() => {
        const auth = getAuth(firebaseApp); // Use DI-provided firebaseApp
        if (!environment.production && environment.useEmulator) {
          connectAuthEmulator(auth, 'http://127.0.0.1:9099');
          console.log('Auth emulator connected in app.config (within zone.run using DI FirebaseApp)');
        }
        return auth;
      });
    }),

    provideFirestore((injector: Injector): Firestore => {
      const zone = injector.get(NgZone);
      const firebaseApp = injector.get(FirebaseApp); // Get FirebaseApp from DI
      return zone.run(() => {
        const firestore = getFirestore(firebaseApp); // Use DI-provided firebaseApp
        if (!environment.production && environment.useEmulator) {
          connectFirestoreEmulator(firestore, '127.0.0.1', 8080);
          console.log('Firestore emulator connected in app.config (within zone.run using DI FirebaseApp)');
        }
        return firestore;
      });
    }),

    provideFunctions((injector: Injector): Functions => {
      const zone = injector.get(NgZone);
      const firebaseApp = injector.get(FirebaseApp); // Get FirebaseApp from DI
      return zone.run(() => {
        const functions = getFunctions(firebaseApp); // Use DI-provided firebaseApp
        if (!environment.production && environment.useEmulator) {
          connectFunctionsEmulator(functions, '127.0.0.1', 5001);
          console.log('Functions emulator connected in app.config (within zone.run using DI FirebaseApp)');
        }
        return functions;
      });
    }),

    // Centralized API bases (health, av, dm, benzinga, partner)
    /**
     * @topic #17 — SA UI — AV Hilbert Transform Endpoint Integration (opened 2026-08-15)
     */
    {
      provide: API_BASES,
      deps: [FirebaseApp],
      useFactory: (app: FirebaseApp): ApiBases => {
        const projectId = app.options.projectId as string;
        const fnBase = (!environment.production && environment.useEmulator)
          ? `http://127.0.0.1:5001/${projectId}/us-central1`
          : `https://us-central1-${projectId}.cloudfunctions.net`;
        return {
          health: fnBase,
          av: fnBase,
          dm: fnBase,
          benzinga: fnBase,
          partner: fnBase,
        };
      },
    },
  ]
};
