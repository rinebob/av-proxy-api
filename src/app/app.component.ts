import { Component, computed, inject, signal, ViewChild } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router, RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { MatToolbarModule } from '@angular/material/toolbar';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatSidenavModule, MatSidenav } from '@angular/material/sidenav';
import { MatListModule } from '@angular/material/list';
import { MatSnackBar } from '@angular/material/snack-bar';
import { Title } from '@angular/platform-browser';
import { AuthService } from './core/auth/auth.service';
import { toSignal } from '@angular/core/rxjs-interop';
import { User } from 'firebase/auth';
import { environment } from '../environments/environment';
import { NAV_ITEMS } from './core/config/nav-menu-items';
import { NavItem } from './core/models/nav-item.model';
import { MatTooltipModule } from '@angular/material/tooltip';
import { BreakpointObserver, Breakpoints } from '@angular/cdk/layout';
import { map, shareReplay } from 'rxjs/operators';

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
    MatTooltipModule
  ],
  templateUrl: './app.component.html',
  styleUrls: ['./app.component.scss']
})
export class AppComponent {
  @ViewChild('sidenav') sidenav!: MatSidenav;
  
  private authService = inject(AuthService);
  private router = inject(Router);
  private snackBar = inject(MatSnackBar);
  private titleService = inject(Title);
  private breakpointObserver = inject(BreakpointObserver);

  // Navigation items from config
  readonly navItems = NAV_ITEMS;
  
  // Sidenav state
  isHandset$ = this.breakpointObserver.observe(Breakpoints.Handset)
    .pipe(
      map(result => result.matches),
      shareReplay()
    );
  isSidenavOpen = true;

  // Signals
  currentUser = toSignal<User | null>(this.authService.user$);
  isAuthenticated = computed(() => !!this.currentUser());
  isAdmin = computed<boolean>(() => {
    const userEmail = this.currentUser()?.email;
    return userEmail ? environment.adminEmails.includes(userEmail) : false;
  });
  
  filteredNavItems = computed<NavItem[]>(() => {
    return this.navItems.filter(item => {
      // Show all items for admin, only non-admin items for regular users
      if (this.isAdmin()) return true;
      return item.requiredRole === 'user' && !item.isDebug;
    });
  });

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
    this.sidenav.toggle();
  }

  onNavItemClick() {
    if (this.breakpointObserver.isMatched(Breakpoints.Handset)) {
      this.sidenav.close();
    }
  }
}
