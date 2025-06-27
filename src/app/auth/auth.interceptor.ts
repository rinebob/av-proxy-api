import { HttpInterceptorFn, HttpRequest, HttpHandlerFn, HttpErrorResponse } from '@angular/common/http';
import { inject } from '@angular/core';
import { Router } from '@angular/router';
import { Observable, from, throwError } from 'rxjs';
import { catchError, switchMap, take } from 'rxjs/operators';
import { AuthService } from './auth.service';
import { StockDataUrl } from '../common/fe-common-app';

export const authInterceptor: HttpInterceptorFn = (
  req: HttpRequest<unknown>,
  next: HttpHandlerFn
) => {
  const authService = inject(AuthService);
  const router = inject(Router);
  const backendUrls = Object.values(StockDataUrl);

  // Skip for non-backend requests
  if (!backendUrls.some(url => req.url.startsWith(url as string))) {
    return next(req);
  }

  return authService.idToken$.pipe(
    take(1),
    switchMap(token => {
      if (!token) {
        router.navigate(['/login'], { 
          queryParams: { returnUrl: router.routerState.snapshot.url } 
        });
        return throwError(() => new Error('No authentication token available'));
      }

      // Clone the request and add the authorization header
      const authReq = req.clone({
        setHeaders: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        }
      });

      // Send the request with the auth token
      return next(authReq).pipe(
        catchError(error => {
          if (error instanceof HttpErrorResponse && error.status === 401) {
            // Handle 401 errors (e.g., token expired)
            return from(authService.refreshToken()).pipe(
              switchMap(newToken => {
                if (!newToken) {
                  authService.logout();
                  router.navigate(['/login'], { 
                    queryParams: { 
                      returnUrl: router.routerState.snapshot.url,
                      sessionExpired: 'true'
                    } 
                  });
                  return throwError(() => new Error('Session expired'));
                }
                
                // Retry the request with the new token
                const retryReq = req.clone({
                  setHeaders: {
                    'Authorization': `Bearer ${newToken}`,
                    'Content-Type': 'application/json'
                  }
                });
                return next(retryReq);
              })
            );
          }
          return throwError(() => error);
        })
      );
    })
  );
};
