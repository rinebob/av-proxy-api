import { inject } from '@angular/core';
import {
  HttpEvent,
  HttpInterceptorFn,
  HttpRequest,
  HttpHandlerFn
} from '@angular/common/http';
import { Observable } from 'rxjs';
import { switchMap, take, catchError } from 'rxjs/operators';
import { AuthService } from './auth.service';
import { StockDataUrl } from '../common/common-app'; // To identify backend URLs

export const authInterceptor: HttpInterceptorFn = (
  req: HttpRequest<unknown>,
  next: HttpHandlerFn
): Observable<HttpEvent<unknown>> => {
  const authService = inject(AuthService);
  const backendUrls = Object.values(StockDataUrl);

  const isBackendRequest = backendUrls.some(url => req.url.startsWith(url as string));

  if (!isBackendRequest) {
    return next(req); // Not a backend request, pass through without modification
  }

  return authService.idToken$.pipe(
    take(1), // Get the current token once
    switchMap(token => {
      console.log('AuthInterceptor: Processing request to', req.url);
      console.log('AuthInterceptor: Has token?', !!token);
      if (token) {
        try {
          // Decode the token to see its contents (client-side only for debugging)
          const decodedToken = JSON.parse(atob(token.split('.')[1]));
          console.log('AuthInterceptor: Token UID:', decodedToken.uid);
          console.log('AuthInterceptor: Token email:', decodedToken.email);
          console.log('AuthInterceptor: Token issued at:', new Date(decodedToken.iat * 1000).toISOString());
          console.log('AuthInterceptor: Token expires at:', new Date(decodedToken.exp * 1000).toISOString());
        } catch (e) {
          console.warn('AuthInterceptor: Could not decode token:', e);
        }
        
        const clonedReq = req.clone({
          setHeaders: {
            Authorization: `Bearer ${token}`,
            'X-Debug-Request': 'true' // Add a debug header
          }
        });
        console.log('AuthInterceptor: Added token to request headers');
        return next(clonedReq);
      } else {
        console.warn('AuthInterceptor: No token available for backend request to', req.url);
        // Add debug header even without token
        const clonedReq = req.clone({
          setHeaders: {
            'X-Debug-Request': 'true'
          }
        });
        return next(clonedReq);
      }
    }),
    catchError(error => {
      // Only log error message, not the full error object
      console.error('AuthInterceptor: Error in token processing -', error.message);
      return next(req);
    })
  );
};

