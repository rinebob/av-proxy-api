import { HttpInterceptorFn, HttpRequest, HttpHandlerFn, HttpErrorResponse } from '@angular/common/http';
import { inject } from '@angular/core';
import { Router } from '@angular/router';
import { from, throwError } from 'rxjs';
import { catchError, switchMap, take } from 'rxjs/operators';

import { AuthService } from './auth.service';
import { StockDataUrl } from '../../common/fe-common-app';
import { DataMaintainerBackendUrls } from '../../feat/data-maintainer-view/common/fe-common-dm-api';
import { AlphaVantageBackendUrls } from '../../feat/data-maintainer-view/common/fe-common-av-api';
import { API_BASES } from '../api/api.tokens';

const pr = false;

export const authInterceptor: HttpInterceptorFn = (
  req: HttpRequest<unknown>,
  next: HttpHandlerFn
) => {
  const authService = inject(AuthService);
  const router = inject(Router);
  const apiBases = inject(API_BASES);
  
  // Get all possible backend URLs
  const backendUrls = [
    ...Object.values(StockDataUrl),
    ...DataMaintainerBackendUrls,
    ...AlphaVantageBackendUrls,
    apiBases.health,
    apiBases.av,
    apiBases.dm,
    apiBases.benzinga,
  ];

  if (pr) console.group(' Auth Interceptor - Request Info');
  if (pr) console.log('Request URL:', req.url);
  if (pr) console.log('Request Method:', req.method);

  // Skip for non-backend requests
  const isBackendRequest = backendUrls.some(backendUrl => {
    if (pr) console.log(`Checking backend URL: ${backendUrl}`);
    
    // For absolute URLs, check if the request URL starts with the backend URL
    if (req.url.startsWith('http')) {
      const matches = req.url.startsWith(backendUrl as string);
      if (pr) console.log(`  - Absolute URL check: ${matches ? ' MATCH' : ' NO MATCH'}`);
      return matches;
    }
    
    // For relative URLs, check if the path matches any backend URL path
    try {
      const urlObj = new URL(backendUrl as string, window.location.origin);
      const pathMatch = req.url.startsWith(urlObj.pathname);
      if (pr) console.log(`  - Relative path check (${urlObj.pathname}): ${pathMatch ? ' MATCH' : ' NO MATCH'}`);
      return pathMatch;
    } catch (e) {
      // Fallback to simple includes check if URL parsing fails
      const includesMatch = req.url.includes(backendUrl as string);
      if (pr) console.warn(`  - Fallback includes check (${backendUrl}): ${includesMatch ? ' MATCH' : ' NO MATCH'}`, e);
      return includesMatch;
    }
  });

  if (pr) console.log(`Is backend request: ${isBackendRequest ? ' YES' : ' NO'}`);
  if (pr) console.groupEnd();

  if (!isBackendRequest) {
    return next(req);
  }

  return authService.idToken$.pipe(
    take(1),
    switchMap(token => {
      if (!token) {
        router.navigate(['/login'], { 
          queryParams: { returnUrl: router.routerState.snapshot.url } 
        });
        return throwError(() => new Error('authSvc aI No authentication token available'));
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
