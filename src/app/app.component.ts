import { Component, inject, Signal, computed, NgZone } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { Router, RouterOutlet } from '@angular/router';
import { AuthService } from './auth/auth.service';
import { User, Auth } from '@angular/fire/auth';
import { MatToolbarModule } from '@angular/material/toolbar';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { CommonModule } from '@angular/common';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [
    CommonModule,
    RouterOutlet,
    MatToolbarModule,
    MatButtonModule,
    MatIconModule
  ],
  templateUrl: './app.component.html',
  styleUrls: ['./app.component.scss']
})
export class AppComponent {
  // Services
  private authService = inject(AuthService);
  private afAuth = inject(Auth);
  private router = inject(Router);
  private zone = inject(NgZone);
  
  // Signals
  title = 'AV Proxy API';
  currentUser = toSignal(this.authService.user$);
  isAuthenticated = computed(() => !!this.currentUser());

  constructor() {
    // Attempt to "touch" Firebase Auth early within the zone
    this.zone.run(() => {
      if (this.afAuth) {
        // Simple access to warm up Auth
        const user = this.afAuth.currentUser;
      }
    });
  }

  async handleLogout(): Promise<void> {
    try {
      await this.authService.logout();
      // No need to navigate here as the AuthService already handles navigation
    } catch (error: unknown) {
      console.error('Logout failed in AppComponent:', error);
      // You might want to show a user-friendly error message here
    }
  }
}
