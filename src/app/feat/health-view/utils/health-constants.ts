import { AlphaVantageEndpoint } from '@shared/alpha-vantage';
import type { RefreshRequestLog } from '@shared/health-metrics';

/** Shared grouping type for endpoint panels */
export interface EndpointGroup {
  endpointId: string;
  events: RefreshRequestLog[];
  latest?: RefreshRequestLog;
}

/** Preferred display order for well-known endpoints */
export const ENDPOINT_PRIORITY: string[] = [
  AlphaVantageEndpoint.TIME_SERIES_DAILY_ADJUSTED,
  AlphaVantageEndpoint.TIME_SERIES_WEEKLY_ADJUSTED,
  AlphaVantageEndpoint.TIME_SERIES_MONTHLY_ADJUSTED,
  AlphaVantageEndpoint.OVERVIEW,
  AlphaVantageEndpoint.HISTORICAL_OPTIONS,
];

/** Quick lookup for rank comparison */
export const PRIORITY_INDEX = new Map(ENDPOINT_PRIORITY.map((id, i) => [id, i] as const));
