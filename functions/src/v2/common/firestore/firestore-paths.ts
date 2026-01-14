import { FirestoreCollection } from '@shared/firestore';
import { DATA_PROVIDERS, ApiProvider } from '@shared/core';
import { AlphaVantageEndpoint } from '@shared/alpha-vantage';
import { TradingPhase } from '@shared/health-metrics';

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
 * If isSplitAdjusted=true, uses 'sa-time-series' collection.
 */
export function getSymbolTimeSeriesDocPath(symbol: string, endpoint: string, vendor: ApiProvider, isSplitAdjusted = false): string {
  const docId = getTimeSeriesDocId(endpoint, vendor);
  const collection = isSplitAdjusted ? 'sa-time-series' : FirestoreCollection.TIME_SERIES;
  return `${FirestoreCollection.SYMBOL_DATA}/${symbol.toUpperCase()}/${collection}/${docId}`;
}

// ----------- Year-sharded helpers (non-intraday) -----------
export function getSymbolTimeSeriesYearsCollectionPath(symbol: string, endpoint: string, vendor: ApiProvider, isSplitAdjusted = false): string {
  return `${getSymbolTimeSeriesDocPath(symbol, endpoint, vendor, isSplitAdjusted)}/years`;
}

export function getSymbolTimeSeriesYearDocPath(symbol: string, endpoint: string, vendor: ApiProvider, year: number, isSplitAdjusted = false): string {
  return `${getSymbolTimeSeriesYearsCollectionPath(symbol, endpoint, vendor, isSplitAdjusted)}/${String(year)}`;
}

export function getYearFromEpochMillis(epochMillis: number): number {
  return new Date(epochMillis).getUTCFullYear();
}

// ----------- Single-doc helper (e.g., monthly 'all') -----------
/**
 * Returns a valid Firestore document path for the monthly "all" bars document.
 * Structure:
 *   symbol-data/{symbol}/time-series/{docId}/all/data
 */
export function getSymbolTimeSeriesAllDocPath(symbol: string, endpoint: string, vendor: ApiProvider, isSplitAdjusted = false): string {
  // Use a subcollection "all" with a fixed doc id "data" to ensure an even number of segments.
  return `${getSymbolTimeSeriesDocPath(symbol, endpoint, vendor, isSplitAdjusted)}/all/data`;
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

// ----------- Time-Series Job helpers (AV-only for now) -----------

/**
 * Returns the canonical document path for a time-series refresh job
 * for Alpha Vantage time-series endpoints.
 *
 * Structure:
 *   system/time-series-jobs/{marketDate}/jobs/{symbol-endpoint-phase}
 *
 * This path is used by the AV refresh manager to log per-symbol,
 * per-date job state for the job-based time-series pipeline.
 */
export function getTimeSeriesJobDocPath(
  marketDate: string, // YYYY-MM-DD (ET trading date)
  symbol: string,
  endpoint: AlphaVantageEndpoint,
  phase: TradingPhase,
): string {
  const safeSymbol = symbol.toUpperCase();
  const jobId = `${safeSymbol}-${endpoint}-${phase}`;
  // Top-level collection "time-series-jobs" with per-date documents
  // and a nested "jobs" subcollection for per-symbol jobs.
  return `${FirestoreCollection.TIME_SERIES_JOBS}/${marketDate}/${FirestoreCollection.JOBS}/${jobId}`;
}
