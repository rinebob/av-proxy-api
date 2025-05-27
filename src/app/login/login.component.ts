import { Component, inject } from '@angular/core';
import { CommonModule } from '@angular/common'; 
import { Router } from '@angular/router';
import { Auth, GoogleAuthProvider, signInWithPopup, authState } from '@angular/fire/auth';
import { take } from 'rxjs/operators';

@Component({
  selector: 'app-login',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './login.component.html',
  styleUrls: ['./login.component.scss']
})
export class LoginComponent {
  private auth: Auth = inject(Auth);
  private router: Router = inject(Router);
  isLoading = false;
  authError: any = null;

  constructor() {
    authState(this.auth).pipe(take(1)).subscribe(user => {
      if (user) {
        console.log('LoginComponent: User already logged in, redirecting to /stock-data');
        this.router.navigate(['/stock-data']);
      }
    });
  }

  async loginWithGoogle() {
    this.isLoading = true;
    this.authError = null;
    const provider = new GoogleAuthProvider();
    try {
      const credential = await signInWithPopup(this.auth, provider);
      console.log('Logged in user:', credential.user);
      // Navigate to the home page or a protected route after successful login
      this.router.navigate(['/']); // Adjust as needed, e.g., to '/stock-data'
    } catch (error) {
      console.error('Login error:', error);
      this.authError = error;
    } finally {
      this.isLoading = false;
    }
  }
}
