import { Injectable, inject, NgZone } from '@angular/core';
import { 
  Auth, 
  idToken, 
  authState, 
  User, 
  signOut, 
  GoogleAuthProvider, 
  signInWithPopup,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  sendPasswordResetEmail
} from '@angular/fire/auth';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';
import { Router } from '@angular/router';

@Injectable({
  providedIn: 'root'
})
export class AuthService {
  private auth: Auth = inject(Auth);
  private router: Router = inject(Router);
  private zone = inject(NgZone);

  // Observable for the current user's ID token
  // Emits null if no user is signed in or token is unavailable
  readonly idToken$: Observable<string | null> = idToken(this.auth);

  // Observable for the current authentication state (User object or null)
  readonly authState$: Observable<User | null> = authState(this.auth);

  // Observable for the current user object (User or null)
  readonly user$: Observable<User | null> = authState(this.auth);

  constructor() { 
    // You can log auth state changes here for debugging if needed
    this.authState$.subscribe(user => {
      if (user) {
        console.log('AuthService: User is signed in', user.uid);
      } else {
        console.log('AuthService: User is signed out');
      }
    });
  }

  // Method to get the current token once (useful for interceptors or one-off checks)
  // idToken observable already provides the current token and updates on change.
  // This is essentially a pass-through but can be useful for clarity or if you add more logic.
  getCurrentToken(): Observable<string | null> {
    return this.idToken$;
  }

  async login(email: string, password: string): Promise<User> {
    try {
      const userCredential = await signInWithEmailAndPassword(this.auth, email, password);
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
    return this.authState$.pipe(
      map((user: User | null) => !!user)
    );
  }
}

