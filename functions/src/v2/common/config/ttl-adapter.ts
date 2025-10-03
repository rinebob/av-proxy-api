import { ApiProvider } from '@shared/core';
import { AlphaVantageEndpoint, AV_ENDPOINT_CONFIGS, AV_TIME_SERIES_ENDPOINT_CONFIGS } from '@shared/alpha-vantage';
import benzinga from '@shared/benzinga';

/**
 * TTL Adapter
 *
 * Single source for retrieving TTL seconds for any provider/endpoint.
 * Today it reads from endpoint config defaults. In the future, we can check
 * Firestore overrides here before falling back to config values.
 */

export function getTtlSecondsForAlphaVantage(endpoint: AlphaVantageEndpoint): number | undefined {
  const cfg: any = (AV_ENDPOINT_CONFIGS as any)[endpoint] || (AV_TIME_SERIES_ENDPOINT_CONFIGS as any)[endpoint];
  return cfg?.ttl as number | undefined;
}

export function getTtlSecondsForBenzinga(endpointKey: string): number | undefined {
  // Primary map used by refresher today: calendar endpoints
  const calendarCfg: any = (benzinga as any)?.BZ_CALENDAR_REQUEST_CONFIGS?.[endpointKey];
  if (calendarCfg?.ttl != null) return calendarCfg.ttl as number;
  // Extend with additional Benzinga maps as they are added to @shared
  return undefined;
}

export function getTtlSeconds(provider: ApiProvider, endpointKey: string): number | undefined {
  switch (provider) {
    case ApiProvider.ALPHA_VANTAGE:
      return getTtlSecondsForAlphaVantage(endpointKey as unknown as AlphaVantageEndpoint);
    case ApiProvider.BENZINGA:
      return getTtlSecondsForBenzinga(endpointKey);
    default:
      return undefined;
  }
}
