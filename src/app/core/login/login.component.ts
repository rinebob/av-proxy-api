import { Component, inject, signal } from '@angular/core';
import { FormBuilder, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { Router, RouterModule } from '@angular/router';
import { AuthService } from '../auth/auth.service';
import { CommonModule } from '@angular/common';
import { MaterialModule } from '../../shared/material.module';

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
  readonly googleLogoUrl = 'https://www.gstatic.com/firebasejs/ui/2.0.0/images/auth/google.svg';
  private authService = inject(AuthService);
  private router = inject(Router);
  private fb = inject(FormBuilder);

  loginForm: FormGroup = this.fb.group({
    email: ['', [Validators.required, Validators.email]],
    password: ['', [Validators.required, Validators.minLength(6)]]
  });

  // Component state as signals
  isLoginMode = signal(true);
  isLoading = signal(false);
  isGoogleLoading = signal(false);
  authError = signal<string | null>(null);
  hidePassword = signal(true);

  async onEmailSubmit() {
    if (this.loginForm.invalid) return;

    this.isLoading.set(true);
    this.authError.set(null);
    const { email, password } = this.loginForm.value;

    try {
      if (this.isLoginMode()) {
        await this.authService.login(email, password);
      } else {
        await this.authService.signup(email, password);
      }
      this.router.navigate(['/stock-data']);
    } catch (error: any) {
      this.authError.set(this.getErrorMessage(error.code || 'auth/error'));
    } finally {
      this.isLoading.set(false);
    }
  }

  async onGoogleLogin(): Promise<void> {
    this.isGoogleLoading.set(true);
    this.authError.set(null);
    try {
      await this.authService.signInWithGoogle();
      this.router.navigate(['/stock-data']);
    } catch (error: any) {
      this.authError.set(this.getErrorMessage(error.code || 'auth/error'));
    } finally {
      this.isGoogleLoading.set(false);
    }
  }

  switchMode() {
    this.isLoginMode.update(prev => !prev);
    this.authError.set(null);
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
