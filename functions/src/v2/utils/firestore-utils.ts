// Shared Firestore utilities for data refreshers
import { FirestoreCollection } from '../common/firestore-collections';
import { ApiProvider } from '../common/data-providers';
import { EndpointSymbolUsage } from '../common/common-fn';

/**
 * Configuration for resolving Firestore paths
 */
export interface FirestorePathConfig {
  /** The Firestore path template, may contain {symbol} placeholder */
  firestorePath: string;
  
  /** Whether and how this endpoint uses symbols */
  symbolUsage?: EndpointSymbolUsage;
  
  /** The endpoint name for logging and identification */
  endpointName: string;
}



/**
 * Resolves the Firestore path for a given endpoint configuration and optional symbol.
 * For symbol endpoints, the symbol will be substituted into the path.
 * For non-symbol endpoints, the path is used as-is.
 * @param config The endpoint configuration containing path and symbol usage
 * @param symbol Optional symbol for endpoints that support it
 * @throws {Error} If the config is invalid or if a symbol is required but not provided
 */
export function resolveFirestorePath(config: FirestorePathConfig, symbol?: string): string {
  if (!config?.firestorePath) {
    throw new Error(`No Firestore path configured for endpoint: ${config.endpointName}`);
  }
  
  // For endpoints that require a symbol, validate and substitute it
  if (config.symbolUsage && config.symbolUsage !== EndpointSymbolUsage.NOT_SUPPORTED) {
    if (!symbol) {
      throw new Error(`Symbol is required for endpoint: ${config.endpointName}`);
    }
    return config.firestorePath.replace('{symbol}', symbol);
  }
  
  // For non-symbol endpoints, return the path as-is
  return config.firestorePath;
}

/**
 * Resolves the refresh history subcollection path for a given endpoint configuration and optional symbol.
 * @param config The endpoint configuration containing path and symbol usage
 * @param symbol Optional symbol for endpoints that support it
 */
export function resolveRefreshHistoryPath(config: FirestorePathConfig, symbol?: string): string {
  const basePath = resolveFirestorePath(config, symbol);
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
