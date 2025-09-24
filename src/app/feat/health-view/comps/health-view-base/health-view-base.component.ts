import { inject } from '@angular/core';
import { HealthDashboardStore } from '../../store/health-dashboard.store';

/**
 * Base class for Health View components. Not a component itself.
 * Extend this class in view-level and child-level components to access
 * a shared HealthDashboardStore instance without re-injecting it everywhere.
 */
export abstract class HealthViewBase {
  public readonly healthStore = inject(HealthDashboardStore);
}
