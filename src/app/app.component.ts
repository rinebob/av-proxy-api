import { Component, computed, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { AuthService } from './auth/auth.service';
import { User } from '@angular/fire/auth';
import { MatToolbarModule } from '@angular/material/toolbar';
import { toSignal } from '@angular/core/rxjs-interop';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [
    CommonModule,
    RouterOutlet,
    RouterLink,
    RouterLinkActive,
    MatButtonModule,
    MatIconModule,
    MatToolbarModule
  ],
  templateUrl: './app.component.html',
  styleUrls: ['./app.component.scss']
})
export class AppComponent {
  private authService = inject(AuthService);
  
  // Signals
  currentUser = toSignal<User | null>(this.authService.user$);
  isAuthenticated = computed(() => !!this.currentUser());

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
