import { Component, inject, NgZone } from '@angular/core';
import { FormBuilder, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { Router, RouterModule } from '@angular/router';
import { 
  Auth, 
  GoogleAuthProvider, 
  signInWithPopup, 
  signInWithEmailAndPassword, 
  createUserWithEmailAndPassword 
} from '@angular/fire/auth'; 
import { CommonModule } from '@angular/common';
import { MaterialModule } from '../shared/material.module';

@Component({
  selector: 'app-login',
  standalone: true,
  imports: [
    CommonModule,
    ReactiveFormsModule,
    RouterModule,
    MaterialModule
  ],
  templateUrl: './login.component.html',
  styleUrls: ['./login.component.scss']
})
export class LoginComponent {
  private auth: Auth = inject(Auth);
  private router: Router = inject(Router);
  private zone = inject(NgZone);
  private fb = inject(FormBuilder);

  loginForm: FormGroup;
  isLoginMode = true;
  isLoading = false;
  authError: string | null = null;
  hidePassword = true;
  selectedTab = 0; // 0 for login, 1 for signup

  constructor() {
    this.loginForm = this.fb.group({
      email: [{value: '', disabled: false}, [Validators.required, Validators.email]],
      password: [{value: '', disabled: false}, [Validators.required, Validators.minLength(6)]]
    });

    this.auth.onAuthStateChanged(user => {
      if (user) {
        console.log('LoginComponent: User already logged in, redirecting to /stock-data');
        this.router.navigate(['/stock-data']);
      }
    });
  }

  async onEmailSubmit() {
    if (this.loginForm.invalid || this.isLoading) return;
    
    // Disable form controls while submitting
    this.loginForm.disable();

    this.isLoading = true;
    this.authError = null;
    const { email, password } = this.loginForm.value;

    try {
      if (this.isLoginMode) {
        await this.zone.run(async () => {
          await signInWithEmailAndPassword(this.auth, email, password);
        });
      } else {
        await this.zone.run(async () => {
          await createUserWithEmailAndPassword(this.auth, email, password);
        });
      }
      this.router.navigate(['/stock-data']);
    } catch (error: any) {
      console.error('Authentication error:', error);
      this.authError = this.getErrorMessage(error.code || 'auth/error');
    } finally {
      this.isLoading = false;
      // Re-enable form controls after submission is complete
      this.loginForm.enable();
    }
  }

  async loginWithGoogle(): Promise<void> {
    if (this.isLoading) return;
    
    this.isLoading = true;
    this.authError = null;
    
    // Disable form controls while submitting
    this.loginForm.disable();

    try {
      await this.zone.run(async () => {
        const provider = new GoogleAuthProvider();
        const credential = await signInWithPopup(this.auth, provider);
        if (credential.user) {
          this.router.navigate(['/stock-data']);
        }
      });
    } catch (error: any) {
      console.error('Google login error:', error);
      this.authError = this.getErrorMessage(error.code || 'auth/error');
    } finally {
      this.isLoading = false;
      // Re-enable form controls after submission is complete
      this.loginForm.enable();
    }
  }

  onTabChange(event: any) {
    this.selectedTab = event.index;
    this.authError = null;
    
    // Reset form when switching tabs
    this.loginForm.reset();
    
    // Clear all errors
    Object.keys(this.loginForm.controls).forEach(key => {
      const control = this.loginForm.get(key);
      control?.setErrors(null);
    });
  }

  switchMode() {
    this.isLoginMode = !this.isLoginMode;
    this.authError = null;
    this.loginForm.reset();
  }

  private getErrorMessage(code: string): string {
    const errorMessages: { [key: string]: string } = {
      'auth/email-already-in-use': 'This email is already in use.',
      'auth/invalid-email': 'Please enter a valid email address.',
      'auth/operation-not-allowed': 'This operation is not allowed.',
      'auth/weak-password': 'Password should be at least 6 characters.',
      'auth/user-not-found': 'No account found with this email.',
      'auth/wrong-password': 'Incorrect password. Please try again.',
      'auth/too-many-requests': 'Too many attempts. Please try again later.',
      'auth/popup-closed-by-user': 'Sign in was cancelled.',
      'auth/popup-blocked': 'Popup was blocked. Please allow popups for this site.',
      'auth/network-request-failed': 'Network error. Please check your connection.',
      'auth/error': 'An error occurred. Please try again.'
    };

    return errorMessages[code] || 'An unknown error occurred.';
  }
}
