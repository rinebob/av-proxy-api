import type { RefreshRequestLog } from '@shared/health-metrics';

// Shared UI label enum for Health view header segments
export enum HealthFilterLabel {
  ENDPOINTS = 'Endpoints',
  SYMBOLS = 'Symbols',
  RANGE = 'Range',
  SORT = 'Sort',
}

// Common label strings used across the Health view
export const HEALTH_LABEL_ALL = 'All';
export const HEALTH_LABEL_EM_DASH = '—';

/** Shared grouping type for endpoint panels */
export interface EndpointGroup {
  endpointId: string;
  events: RefreshRequestLog[];
  latest?: RefreshRequestLog;
}
