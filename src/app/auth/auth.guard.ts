import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { Auth, authState } from '@angular/fire/auth'; // Import Auth and authState
import { map, take, tap } from 'rxjs/operators';

export const authGuard: CanActivateFn = (route, state) => {
  const auth: Auth = inject(Auth);
  const router: Router = inject(Router);

  return authState(auth).pipe( // Use authState to get an observable of the user's auth state
    take(1), // Take the first emission to avoid ongoing subscriptions
    map(user => !!user), // Map the user object to a boolean (true if user exists, false otherwise)
    tap(loggedIn => {
      if (!loggedIn) {
        console.log('AuthGuard: User not logged in, redirecting to /login');
        router.navigate(['/login']); // Redirect to login if not logged in
      }
    })
  );
};
