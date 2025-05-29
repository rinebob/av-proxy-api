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
      if (token) {
        const clonedReq = req.clone({
          setHeaders: {
            Authorization: `Bearer ${token}`
          }
        });
        console.log('AuthInterceptor: Token added to request for', req.url);
        return next(clonedReq);
      } else {
        console.warn('AuthInterceptor: No token available for backend request to', req.url);
        // For now, let the request proceed; backend will handle unauthorized access.
        // Consider returning EMPTY or throwing an error to block client-side.
        return next(req);
      }
    }),
    catchError(error => {
      // Only log error message, not the full error object
      console.error('AuthInterceptor: Error in token processing -', error.message);
      return next(req);
    })
  );
};

