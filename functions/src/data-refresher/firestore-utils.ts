// Shared Firestore utilities for data refreshers
import { FirestoreCollection } from '../common/firestore-collections';
import { ApiProvider } from '../common/data-providers';
import { BZ_NEWS_REQUEST_CONFIGS } from '../api/benzinga/request-configs/bz-news-request-configs';
import { BZ_CALENDAR_REQUEST_CONFIGS } from '../api/benzinga/request-configs/bz-calendar-request-configs';

// Combine all Benzinga configs
const ALL_BENZINGA_CONFIGS = {
  ...BZ_NEWS_REQUEST_CONFIGS,
  ...BZ_CALENDAR_REQUEST_CONFIGS,
} as const;

/**
 * Resolves the Firestore path for a given endpoint by substituting the symbol.
 * Only use this function for endpoints that require a symbol.
 * @throws {Error} If the endpoint config is not found or if no symbol is provided
 */
export function resolveFirestorePath(endpointName: string, symbol: string): string {
  const config = ALL_BENZINGA_CONFIGS[endpointName as keyof typeof ALL_BENZINGA_CONFIGS];
  if (!config?.firestorePath) {
    throw new Error(`No Firestore path config found for endpoint: ${endpointName}`);
  }
  if (!symbol) {
    throw new Error(`Symbol is required for endpoint: ${endpointName}`);
  }
  return config.firestorePath.replace('{symbol}', symbol);
}

/**
 * Resolves the refresh history subcollection path for a given endpoint and symbol.
 */
export function resolveRefreshHistoryPath(endpointName: string, symbol?: string): string {
  const basePath = symbol 
    ? resolveFirestorePath(endpointName, symbol)
    : ALL_BENZINGA_CONFIGS[endpointName as keyof typeof ALL_BENZINGA_CONFIGS]?.firestorePath || '';
  return `${basePath}/${FirestoreCollection.REFRESH_HISTORY}`;
}

/**
 * Generates a human-readable, sortable, unique Firestore doc ID for a refresh event.
 */
export function getRefreshEventDocId(
  provider: ApiProvider,
  endpoint: string,
  date: Date,
  symbol?: string
): string {
  const pad = (n: number) => n.toString().padStart(2, '0');
  const YYYY = date.getFullYear();
  const MM = pad(date.getMonth() + 1);
  const DD = pad(date.getDate());
  const HH = pad(date.getHours());
  const mm = pad(date.getMinutes());
  const ss = pad(date.getSeconds());
  const base = `${provider}-${endpoint}-${YYYY}${MM}${DD}-${HH}${mm}${ss}`;
  return symbol ? `${base}-${symbol}` : base;
}
