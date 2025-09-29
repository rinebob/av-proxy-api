import type { RefreshRequestLog } from '@shared/health-metrics';

/** Shared grouping type for endpoint panels */
export interface EndpointGroup {
  endpointId: string;
  events: RefreshRequestLog[];
  latest?: RefreshRequestLog;
}
