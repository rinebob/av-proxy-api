import { Routes } from '@angular/router';

import { LoginComponent } from './core/login/login.component';
import { StockDataComponent } from './feat/stock-data/stock-data.component';
import { BzCalendarViewComponent } from './feat/bz-calendar-view/bz-calendar-view.component';
import { CompanyLogoGalleryComponent } from './feat/company-logo-gallery/company-logo-gallery.component';
import { DataMaintainerViewComponent } from './feat/data-maintainer-view/data-maintainer-view.component';
import { authGuard } from './core/auth/auth.guard';
import { SymbolManagerComponent } from './feat/symbol-manager-view/components/symbol-manager/symbol-manager.component';
import { FirestoreDebugComponent } from './feat/debug-view/components/firestore-debug/firestore-debug.component';

export const routes: Routes = [
  { path: 'login', component: LoginComponent },
  { path: 'stock-data', component: StockDataComponent, canActivate: [authGuard] },
  { path: 'calendars', component: BzCalendarViewComponent, canActivate: [authGuard] },
  { path: 'data-maintainer', component: DataMaintainerViewComponent, canActivate: [authGuard] },
  { path: 'symbol-manager', component: SymbolManagerComponent, canActivate: [authGuard] },
  { path: 'logos', component: CompanyLogoGalleryComponent, canActivate: [authGuard] },
  { path: 'fs-debug', component: FirestoreDebugComponent, canActivate: [authGuard] },
  // Redirect root path to login by default
  { path: '', redirectTo: '/login', pathMatch: 'full' },
  // Fallback for any other route (optional, can also redirect to a 404 page or login)
  // { path: '**', redirectTo: '/stock-data' }
];
