import { Component, computed, effect, inject, signal, viewChild, AfterViewInit } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { BreakpointObserver, Breakpoints } from '@angular/cdk/layout';
import { CommonModule } from '@angular/common';
import { Title } from '@angular/platform-browser';
import { Router, RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { MatToolbarModule } from '@angular/material/toolbar';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatSidenavModule, MatSidenav } from '@angular/material/sidenav';
import { MatListModule } from '@angular/material/list';
import { MatSnackBar } from '@angular/material/snack-bar';
import { MatTooltipModule } from '@angular/material/tooltip';
import { User } from 'firebase/auth';
import { map, shareReplay, map as rxMap, startWith } from 'rxjs/operators';

import { AuthService } from './core/auth/auth.service';
import { environment } from '../environments/environment';
import { NAV_ITEMS } from './core/config/nav-menu-items';
import { NavItem } from './core/models/nav-item.model';
import { ManualFirestoreWriteToggleComponent } from './core/admin/manual-firestore-write-toggle/manual-firestore-write-toggle.component';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [
    CommonModule, 
    RouterOutlet, 
    MatToolbarModule, 
    MatButtonModule, 
    MatIconModule, 
    MatSidenavModule,
    MatListModule,
    RouterLink, 
    RouterLinkActive,
    MatTooltipModule,
    ManualFirestoreWriteToggleComponent
  ],
  templateUrl: './app.component.html',
  styleUrls: ['./app.component.scss']
})
export class AppComponent {
  readonly sidenav = viewChild<MatSidenav>('sidenav');
  
  private authService = inject(AuthService);
  private router = inject(Router);
  private snackBar = inject(MatSnackBar);
  private titleService = inject(Title);
  private breakpointObserver = inject(BreakpointObserver);

  // Navigation items from config
  readonly navItems = NAV_ITEMS;
  
  // Sidenav state
  private isHandset$ = this.breakpointObserver.observe(Breakpoints.Handset)
    .pipe(
      map(result => result.matches),
      shareReplay()
    );
  isHandset = toSignal(this.isHandset$, { initialValue: false });
  isSidenavOpen = true;

  // Signals
  currentUser = toSignal<User | null>(this.authService.user$);
  isAuthenticated = computed(() => !!this.currentUser());
  // IMPORTANT: keep as a signal so it reacts to async custom-claims load
  isAdmin = this.authService.isAdmin;

  readonly currentUrl = toSignal(
    this.router.events.pipe(
      rxMap(() => this.router.url),
      startWith(this.router.url)
    ),
    { initialValue: this.router.url }
  );
  isLoginRoute = computed(() => this.currentUrl().startsWith('/login'));

  filteredNavItems = computed<NavItem[]>(() => {
    // Hide all items on login route or when not authenticated
    if (!this.isAuthenticated() || this.isLoginRoute()) {
      return [];
    }
    return this.navItems.filter(item => {
      // Show all items for admin, only non-admin items for regular users
      if (this.isAdmin()) return true;
      return item.requiredRole === 'user' && !item.isDebug;
    });
  });

  constructor() {
    // Keep the sidenav state in sync with auth, route, and screen size
    effect(() => {
      // Track dependencies
      this.isAuthenticated();
      this.isLoginRoute();
      this.isHandset();
      
      const sNav = this.sidenav();
      
      if (sNav) {
        sNav.close();
      }
    });
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

  toggleSidenav() {
    const sNav = this.sidenav();
    if (sNav) {
      sNav.toggle();
    }
  }

  onNavItemClick() {
    if (this.breakpointObserver.isMatched(Breakpoints.Handset)) {
      const sNav = this.sidenav();
      if (sNav) {
        sNav.close();
      }
    }
  }
}
