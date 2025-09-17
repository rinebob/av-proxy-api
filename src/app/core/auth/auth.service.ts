import { Injectable, inject, NgZone, effect, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { Router } from '@angular/router';
import { HttpClient } from '@angular/common/http';
import { 
  Auth,
  getIdTokenResult,
  idToken, 
  authState, 
  User, 
  signOut, 
  GoogleAuthProvider, 
  signInWithPopup,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  sendPasswordResetEmail,
} from '@angular/fire/auth';
import { Observable, from } from 'rxjs';
import { map } from 'rxjs/operators';

@Injectable({
  providedIn: 'root'
})
export class AuthService {
  private auth: Auth = inject(Auth);
  private router: Router = inject(Router);
  private zone = inject(NgZone);
  private http = inject(HttpClient);

  // Observable for the current user's ID token
  // Emits null if no user is signed in or token is unavailable
  readonly idToken$: Observable<string | null> = idToken(this.auth);

  // Observable for the current user object (User or null)
  readonly user$: Observable<User | null> = authState(this.auth);

  // Signal for the current user object (User or null)
  readonly user = toSignal(this.user$);

  // Signal for admin status
  readonly isAdmin = signal<boolean>(false);

  // Token refresh in progress flag to prevent multiple refresh attempts
  private refreshInProgress = false;
  private refreshPromise: Promise<string | null> | null = null;

  constructor() { 
    // Effect to log auth state changes
    effect(async () => {
      const user = this.user();
      if (user) {
        console.log('AuthService: User is signed in', {
          uid: user.uid,
          email: user.email,
          emailVerified: user.emailVerified,
          isAnonymous: user.isAnonymous,
          lastSignInTime: user.metadata?.lastSignInTime,
          creationTime: user.metadata?.creationTime
        });
        
        // Log ID token details
        // Force-refresh to ensure custom claims are current (important for emulator and after role updates)
        let freshToken: string | null = null;
        try {
          freshToken = await user.getIdToken(true);
        } catch {}
        await this.logTokenDetails(user, freshToken ?? undefined);
        const tokenResult = await getIdTokenResult(user);
        this.isAdmin.set(!!tokenResult.claims['admin']);
      } else {
        console.log('AuthService: No user is currently signed in');
        this.isAdmin.set(false);
      }
    });
  }

  private async logTokenDetails(user: User, token?: string): Promise<void> {
    try {
      const t = token ?? await user.getIdToken();
      const decoded = JSON.parse(atob(t.split('.')[1]));
      console.log('AuthService: Current ID token details:', {
        uid: decoded.user_id || decoded.uid,
        email: decoded.email,
        auth_time: new Date(decoded.auth_time * 1000).toISOString(),
        issued_at: new Date(decoded.iat * 1000).toISOString(),
        expires_at: new Date(decoded.exp * 1000).toISOString(),
        token_length: t.length
      });
    } catch (error) {
      console.error('AuthService: Error decoding ID token:', error);
    }
  }

  // Refresh the current user's ID token
  async refreshToken(forceRefresh = false): Promise<string | null> {
    const user = this.auth.currentUser;
    if (!user) {
      console.warn('AuthService: Cannot refresh token - no user is signed in');
      return null;
    }

    // If we already have a refresh in progress, return that promise
    if (this.refreshInProgress && !forceRefresh) {
      console.log('AuthService: Token refresh already in progress, returning existing promise');
      return this.refreshPromise!;
    }

    try {
      this.refreshInProgress = true;
      console.log('AuthService: Refreshing ID token...');
      
      // Create a new promise for the refresh operation
      this.refreshPromise = new Promise<string | null>(async (resolve) => {
        try {
          // Force refresh the token
          const token = await user.getIdToken(true);
          console.log('AuthService: Successfully refreshed ID token');
          await this.logTokenDetails(user, token);
          resolve(token);
        } catch (error) {
          console.error('AuthService: Error refreshing token:', error);
          // If refresh fails, sign out the user
          await this.logout();
          resolve(null);
        } finally {
          // Reset the refresh state
          this.refreshInProgress = false;
          this.refreshPromise = null;
        }
      });

      return await this.refreshPromise;
    } catch (error) {
      console.error('AuthService: Error in refreshToken:', error);
      this.refreshInProgress = false;
      this.refreshPromise = null;
      return null;
    }
  }

  // Method to get the current token once with optional force refresh
  getCurrentToken(forceRefresh = false): Promise<string | null> {
    const user = this.auth.currentUser;
    if (!user) {
      return Promise.resolve(null);
    }
    return user.getIdToken(forceRefresh);
  }

  // Get the current user's ID token as an Observable
  getTokenObservable(forceRefresh = false): Observable<string | null> {
    return from(this.getCurrentToken(forceRefresh));
  }

  async login(email: string, password: string): Promise<User> {
    try {
      const userCredential = await signInWithEmailAndPassword(this.auth, email, password);
      // Force token refresh on login to ensure we have a fresh token
      await userCredential.user.getIdToken(true);
      return userCredential.user;
    } catch (error) {
      console.error('Login failed:', error);
      throw error;
    }
  }

  async signup(email: string, password: string): Promise<User> {
    try {
      const userCredential = await createUserWithEmailAndPassword(this.auth, email, password);
      return userCredential.user;
    } catch (error) {
      console.error('Signup failed:', error);
      throw error;
    }
  }

  async signInWithGoogle(): Promise<User> {
    try {
      const provider = new GoogleAuthProvider();
      const userCredential = await signInWithPopup(this.auth, provider);
      // Force token refresh on login to ensure we have a fresh token
      await userCredential.user.getIdToken(true);
      return userCredential.user;
    } catch (error) {
      console.error('Google Sign-in failed:', error);
      throw error;
    }
  }

  async resetPassword(email: string): Promise<void> {
    try {
      await sendPasswordResetEmail(this.auth, email);
    } catch (error) {
      console.error('Password reset failed:', error);
      throw error;
    }
  }

  async logout(): Promise<void> {
    try {
      await this.zone.run(async () => {
        await signOut(this.auth);
        console.log('User logged out successfully');
        this.router.navigate(['/login']);
      });
    } catch (error: unknown) {
      console.error('Logout failed:', error);
      throw error;
    }
  }

  isAuthenticated(): Observable<boolean> {
    return this.user$.pipe(
      map((user: User | null) => !!user)
    );
  }
}
