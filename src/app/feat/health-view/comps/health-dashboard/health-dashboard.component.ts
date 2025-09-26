import { ChangeDetectionStrategy, Component, OnInit, OnDestroy, inject } from '@angular/core';
import { MatIconModule } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';
import { MatToolbarModule } from '@angular/material/toolbar';
import { MatTabsModule } from '@angular/material/tabs';
import { HealthSummaryCardsComponent } from '../summary-cards/health-summary-cards.component';
import { HealthFiltersBarComponent } from '../filters-bar/health-filters-bar.component';
import { HealthRequestLogTableComponent } from '../request-log-table/health-request-log-table.component';
import { HealthEndpointDetailComponent } from '../endpoint-detail/health-endpoint-detail.component';
import { HealthSymbolDrawerComponent } from '../symbol-drawer/health-symbol-drawer.component';
import { HealthViewBase } from '../health-view-base/health-view-base.component';

// Firestore listener bits
import { doc, onSnapshot, Unsubscribe } from 'firebase/firestore';
import { Firestore } from '@angular/fire/firestore';

// Endpoints map to listen for time-series
import { AV_TIME_SERIES_ENDPOINT_CONFIGS } from '@shared/alpha-vantage';
import { FirestoreCollection } from '@shared/firestore';
import { TsToIsoPipe } from '../../pipes/ts-to-iso.pipe';

@Component({
  selector: 'app-health-dashboard',
  standalone: true,
  imports: [
    MatIconModule,
    MatButtonModule,
    MatToolbarModule,
    MatTabsModule,
    HealthSummaryCardsComponent,
    HealthFiltersBarComponent,
    HealthRequestLogTableComponent,
    HealthEndpointDetailComponent,
    HealthSymbolDrawerComponent,
    TsToIsoPipe,
  ],
  templateUrl: './health-dashboard.component.html',
  styleUrls: ['./health-dashboard.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class HealthDashboardComponent extends HealthViewBase implements OnInit, OnDestroy {
  private _unsubs: Unsubscribe[] = [];
  private _cooldownMs = 5000;
  private _lastRefreshAt = 0;

  // Use AngularFire's Firestore instance to avoid multiple Firestore providers
  private readonly afs = inject(Firestore);

  ngOnInit(): void {
    // Kick off initial loads
    this.healthStore.refreshAll();

    // Listen to latest status docs for all time-series endpoints
    const endpoints = Object.keys(AV_TIME_SERIES_ENDPOINT_CONFIGS);
    for (const endpointId of endpoints) {
      const ref = doc(
        this.afs as any,
        FirestoreCollection.HEALTH_METRICS,
        endpointId,
        FirestoreCollection.LATEST,
        FirestoreCollection.STATUS,
      );
      const unsub = onSnapshot(ref, () => this.onBackendUpdate());
      this._unsubs.push(unsub);
    }
  }

  ngOnDestroy(): void {
    for (const u of this._unsubs) {
      try { u(); } catch {}
    }
    this._unsubs = [];
  }

  private onBackendUpdate(): void {
    const now = Date.now();
    if (now - this._lastRefreshAt < this._cooldownMs) return;
    this._lastRefreshAt = now;
    this.healthStore.refreshAll();
  }
}
