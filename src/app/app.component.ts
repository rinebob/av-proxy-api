import { Component, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router, RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { MatToolbarModule } from '@angular/material/toolbar';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatSnackBar } from '@angular/material/snack-bar';
import { Title } from '@angular/platform-browser';
import { AuthService } from './core/auth/auth.service';
import { toSignal } from '@angular/core/rxjs-interop';
import { User } from 'firebase/auth';
import { environment } from '../environments/environment';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [
    CommonModule, 
    RouterOutlet, 
    MatToolbarModule, 
    MatButtonModule, 
    MatIconModule, 
    RouterLink, 
    RouterLinkActive
  ],
  templateUrl: './app.component.html',
  styleUrls: ['./app.component.scss']
})
export class AppComponent {
  private authService = inject(AuthService);
  private router = inject(Router);
  private snackBar = inject(MatSnackBar);
  private titleService = inject(Title);

  // Signals
  currentUser = toSignal<User | null>(this.authService.user$);
  isAuthenticated = computed(() => !!this.currentUser());

  isAdmin(): boolean {
    const userEmail = this.currentUser()?.email;
    return userEmail ? environment.adminEmails.includes(userEmail) : false;
  }

  ngOnInit(): void {
    this.titleService.setTitle('Savant API');
  }

  async handleLogout(): Promise<void> {
    try {
      await this.authService.logout();
      // No need to navigate here as the AuthService already handles navigation
    } catch (error: unknown) {
      console.error('Logout failed in AppComponent:', error);
      // Consider showing a user-friendly error message here
    }
  }
}
