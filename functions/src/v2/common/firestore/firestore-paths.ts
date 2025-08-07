import { FirestoreCollection } from '@shared/firestore';
import { DATA_PROVIDERS, ApiProvider } from '@shared/core';

// ----------- Canonical Time Series Path Utilities -----------
/**
 * Canonical doc ID for AV/BZ time series: e.g. "av-daily-adjusted"
 */
export function getTimeSeriesDocId(endpoint: string, vendor: ApiProvider): string {
  const vendorPrefix = DATA_PROVIDERS[vendor].prefix;
  const endpointName = endpoint
    .replace(/^TIME_SERIES_/, '')
    .replace(/_/g, '-')
    .toLowerCase();
  return `${vendorPrefix}-${endpointName}`;
}

/**
 * Canonical Firestore doc path for symbol time series.
 * E.g. symbol-data/AAPL/time-series/av-daily-adjusted
 */
export function getSymbolTimeSeriesDocPath(symbol: string, endpoint: string, vendor: ApiProvider): string {
  const docId = getTimeSeriesDocId(endpoint, vendor);
  return `${FirestoreCollection.SYMBOL_DATA}/${symbol.toUpperCase()}/${FirestoreCollection.TIME_SERIES}/${docId}`;
}
