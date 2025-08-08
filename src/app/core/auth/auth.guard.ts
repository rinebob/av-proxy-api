import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { take, tap } from 'rxjs/operators';

import { AuthService } from './auth.service';

export const authGuard: CanActivateFn = (route, state) => {
  const authService = inject(AuthService);
  const router: Router = inject(Router);

  return authService.isAuthenticated().pipe(
    take(1), // Ensure the observable completes after the first emission
    tap(loggedIn => {
      if (!loggedIn) {
        console.log('AuthGuard: User not logged in, redirecting to /login');
        router.navigate(['/login']); // Redirect to login if not logged in
      }
    })
  );
};
