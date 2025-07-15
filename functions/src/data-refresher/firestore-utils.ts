// Shared Firestore utilities for data refreshers
import { FirestoreCollection } from '../common/firestore-collections';
import { ApiProvider } from '../common/data-providers';
import { ALL_BENZINGA_REQUEST_CONFIGS } from '../api/benzinga/request-configs/bz-request-configs';

/**
 * Resolves the Firestore path for a given endpoint and symbol using config.
 */
/**
 * Resolves the Firestore path for a given endpoint, symbol, and newsId using config.
 * Pass symbol for symbol-based endpoints, newsId for news endpoints, or both if needed.
 */
export function resolveFirestorePath(endpointName: string, symbol?: string, newsId?: string): string {
  const config = ALL_BENZINGA_REQUEST_CONFIGS[endpointName];
  if (!config || !config.firestorePath) {
    throw new Error(`No Firestore path config for endpoint ${endpointName}`);
  }
  let path = config.firestorePath;
  if (path.includes('{symbol}')) {
    path = path.replace('{symbol}', symbol || '');
  }
  if (path.includes('{newsId}')) {
    path = path.replace('{newsId}', newsId || '');
  }
  return path; // Ensures correct doc path for both symbol-based and newsId-based endpoints
}

/**
 * Resolves the refresh history subcollection path for a given endpoint and symbol.
 */
export function resolveRefreshHistoryPath(endpointName: string, symbol?: string): string {
  // Use FirestoreCollection.REFRESH_HISTORY for consistency
  return resolveFirestorePath(endpointName, symbol) + `/${FirestoreCollection.REFRESH_HISTORY}`;
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
