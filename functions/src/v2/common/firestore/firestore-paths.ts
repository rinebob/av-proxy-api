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

// ----------- Year-sharded helpers (non-intraday) -----------
export function getSymbolTimeSeriesYearsCollectionPath(symbol: string, endpoint: string, vendor: ApiProvider): string {
  return `${getSymbolTimeSeriesDocPath(symbol, endpoint, vendor)}/years`;
}

export function getSymbolTimeSeriesYearDocPath(symbol: string, endpoint: string, vendor: ApiProvider, year: number): string {
  return `${getSymbolTimeSeriesYearsCollectionPath(symbol, endpoint, vendor)}/${String(year)}`;
}

export function getYearFromEpochMillis(epochMillis: number): number {
  return new Date(epochMillis).getUTCFullYear();
}

// ----------- Single-doc helper (e.g., monthly 'all') -----------
export function getSymbolTimeSeriesAllDocPath(symbol: string, endpoint: string, vendor: ApiProvider): string {
  return `${getSymbolTimeSeriesDocPath(symbol, endpoint, vendor)}/all`;
}

// ----------- Day/Bar helpers (intraday only; currently optional) -----------
export function getSymbolTimeSeriesDaysCollectionPath(symbol: string, endpoint: string, vendor: ApiProvider): string {
  return `${getSymbolTimeSeriesDocPath(symbol, endpoint, vendor)}/days`;
}

export function getSymbolTimeSeriesDayDocPath(
  symbol: string,
  endpoint: string,
  vendor: ApiProvider,
  yyyymmdd: string
): string {
  return `${getSymbolTimeSeriesDaysCollectionPath(symbol, endpoint, vendor)}/${yyyymmdd}`;
}

export function getBarDocIdFromEpochMillis(epochMillis: number): string {
  return new Date(epochMillis).toISOString();
}

export function getSymbolTimeSeriesBarsCollectionPath(
  symbol: string,
  endpoint: string,
  vendor: ApiProvider,
  yyyymmdd: string
): string {
  return `${getSymbolTimeSeriesDayDocPath(symbol, endpoint, vendor, yyyymmdd)}/bars`;
}

export function getSymbolTimeSeriesBarDocPath(
  symbol: string,
  endpoint: string,
  vendor: ApiProvider,
  yyyymmdd: string,
  barIsoDocId: string
): string {
  return `${getSymbolTimeSeriesBarsCollectionPath(symbol, endpoint, vendor, yyyymmdd)}/${barIsoDocId}`;
}
