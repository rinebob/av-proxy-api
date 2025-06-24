import { Component, computed, inject, OnInit, NgZone } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router, RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { AuthService } from './auth/auth.service';
import { User, Auth } from '@angular/fire/auth';
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
export class AppComponent implements OnInit {
  private authService = inject(AuthService);
  private afAuth = inject(Auth);
  private router = inject(Router);
  private zone = inject(NgZone);
  
  // Signals
  currentUser = toSignal<User | null>(this.authService.user$);
  isAuthenticated = computed(() => !!this.currentUser());

  ngOnInit(): void {
    // Initialize any required services or data
    // Attempt to "touch" Firebase Auth early within the zone
    this.zone.run(() => {
      if (this.afAuth) {
        // Accessing currentUser to warm up Auth
        const user = this.afAuth.currentUser;
        if (user) {
          console.log('Current user on init:', user.uid);
        }
      }
    });
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
