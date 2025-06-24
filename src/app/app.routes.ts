import { Routes } from '@angular/router';

import { LoginComponent } from './login/login.component';
import { StockDataComponent } from './stock-data/stock-data.component';
import { BenzingaPageComponent } from './benzinga-page/benzinga-page.component';
import { authGuard } from './auth/auth.guard';

export const routes: Routes = [
  { path: 'login', component: LoginComponent },
  { path: 'stock-data', component: StockDataComponent, canActivate: [authGuard] },
  { path: 'benz', component: BenzingaPageComponent, canActivate: [authGuard] },
  // Redirect root path to stock-data by default
  { path: '', redirectTo: '/login', pathMatch: 'full' },
  // Fallback for any other route (optional, can also redirect to a 404 page or login)
  // { path: '**', redirectTo: '/stock-data' }
];
