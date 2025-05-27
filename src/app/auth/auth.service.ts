import { Injectable, inject } from '@angular/core';
import { Auth, idToken, authState, User } from '@angular/fire/auth';
import { Observable } from 'rxjs';

@Injectable({
  providedIn: 'root'
})
export class AuthService {
  private auth: Auth = inject(Auth);

  // Observable for the current user's ID token
  // Emits null if no user is signed in or token is unavailable
  readonly idToken$: Observable<string | null> = idToken(this.auth);

  // Observable for the current authentication state (User object or null)
  readonly authState$: Observable<User | null> = authState(this.auth);

  // Observable for the current user object (User or null)
  readonly user$: Observable<User | null> = authState(this.auth);

  constructor() { 
    // You can log auth state changes here for debugging if needed
    // this.authState$.subscribe(user => {
    //   if (user) {
    //     console.log('AuthService: User is signed in', user.uid);
    //   } else {
    //     console.log('AuthService: User is signed out');
    //   }
    // });
  }

  // Method to get the current token once (useful for interceptors or one-off checks)
  // idToken observable already provides the current token and updates on change.
  // This is essentially a pass-through but can be useful for clarity or if you add more logic.
  getCurrentToken(): Observable<string | null> {
    return this.idToken$;
  }

  // You can add login/logout methods here if needed, e.g.:
  // import { GoogleAuthProvider, signInWithPopup, signOut } from '@angular/fire/auth';
  // async loginWithGoogle() {
  //   const provider = new GoogleAuthProvider();
  //   try {
  //     const credential = await signInWithPopup(this.auth, provider);
  //     return credential.user;
  //   } catch (error) {
  //     console.error('Login failed:', error);
  //     return null;
  //   }
  // }

  // async logout() {
  //   try {
  //     await signOut(this.auth);
  //   } catch (error) {
  //     console.error('Logout failed:', error);
  //   }
  // }
}

