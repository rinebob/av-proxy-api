import { db } from '../../../firebase-admin-init';
import { 
  AlphaVantageEndpoint, 
} from '../../common/common-av';
import { TimeSeriesInterval } from '../../common/common-fn';
import { OutputSize } from '../../common/common-av';
import { Timestamp } from 'firebase-admin/firestore';
import type { EndpointConfig } from '../../common/types';
import { RefreshLoggerService } from '../../services/refresh-logger.service';
import { ApiProvider } from '../../common/data-providers';
import { RefreshEvent, RefreshStatus, RefreshTrigger } from '../../common/refresh.types';
import { getSymbolTimeSeriesDocPath } from '../../common/firestore/firestore-paths';
import { AV_TIME_SERIES_ENDPOINT_CONFIGS } from '../request-configs/av-endpoint-configs';
import { AvDailyTimeSeriesHandler } from '../handlers/av-daily-time-series.handler';

/**
 * Saves Alpha Vantage STANDARD (non-time-series) data to Firestore and logs refresh event using RefreshLoggerService.
 */
export async function saveAvData(
  data: any,
  symbol: string,
  endpoint: AlphaVantageEndpoint,
  endpointConfig: EndpointConfig
): Promise<void> {
    console.log(`aFH sAD saveAvData called. symbol: ${symbol}, endpoint: ${endpoint}`);
  const { firestorePath, ttl } = endpointConfig;

  if (typeof ttl !== 'number') {
    throw new Error('ttl (ttlSeconds) must be provided in endpoint config');
  }

  const startTime = Date.now();

  try {
    // 1. Prepare document path
    if (!firestorePath) {
      throw new Error(`No firestorePath configured for endpoint: ${endpoint}. A firestorePath must be provided.`);
    }
    const docPath = firestorePath.replace('{symbol}', symbol);
    const docRef = db.doc(docPath);

    // 2. Write data property only
    await docRef.set({ data }, { merge: true });

    // 3. Log refresh event using RefreshLoggerService
    const refreshLogger = new RefreshLoggerService();
    await refreshLogger.logRefreshEvent(
      {
        vendor: ApiProvider.ALPHA_VANTAGE,
        endpoint,
        symbol,
        ttlSeconds: ttl,
        docPath, // canonical Firestore path must be provided
      },
      {
        refreshedBy: 'system',
        status: RefreshStatus.SUCCESS,
        triggeredBy: RefreshTrigger.SCHEDULER,
        durationMs: Date.now() - startTime,
        httpStatus: 200
        // Add other RefreshEvent fields as needed
      }
    );

    console.log(`aFH sAD Saved STANDARD data for ${symbol}/${endpoint} at path: ${docPath}`);
  } catch (error) {
    console.error('aFH sAD Error saving data to Firestore:', error);
    throw error;
  }
}

/**
 * Saves Alpha Vantage TIME SERIES data to Firestore, using the normalized, non-deprecated schema.
 */
export async function saveAvTimeSeriesData(
  data: any[],
  symbol: string,
  endpoint: AlphaVantageEndpoint,
  interval: TimeSeriesInterval
): Promise<void> {
    console.log(`aFH sATSD saveAvTimeSeriesData called. symbol: ${symbol}, endpoint: ${endpoint}, interval: ${interval}`);
  // Compute metadata fields
  const histDataPoints = Array.isArray(data) ? data.length : 0;
  const histStartDate = histDataPoints > 0 && data[histDataPoints - 1]?.date
    ? Timestamp.fromDate(new Date(data[histDataPoints - 1].date))
    : Timestamp.now();
  const histEndDate = histDataPoints > 0 && data[0]?.date
    ? Timestamp.fromDate(new Date(data[0].date))
    : Timestamp.now();
  const firstQuoteDate = histStartDate;

  // Canonical doc path for time series
  const docPath = getSymbolTimeSeriesDocPath(symbol, endpoint, ApiProvider.ALPHA_VANTAGE);
  const docRef = db.doc(docPath);

  try {
    const startTime = Date.now();
    // Fetch existing refreshHistory if present
    const existingDoc = await docRef.get();
    let refreshHistory: RefreshEvent[] = [];
    if (existingDoc.exists && Array.isArray(existingDoc.data()?.refreshHistory)) {
      refreshHistory = existingDoc.data()!.refreshHistory;
    }

    // Prepare document data
    const docData = {
      data,
      metadata: {
        symbol,
        interval,
        histDataPoints,
        histStartDate,
        histEndDate,
        firstQuoteDate,
        quoteDataPoints: 0 // update if you have quote data
      },
      refreshHistory // preserve/merge history, or [] for new doc
    };

    console.log(`aFH sATSD Will write to Firestore path: ${docPath}`);
    await docRef.set(docData, { merge: true });
    console.log(`aFH sATSD Saved TIME SERIES data for ${symbol}/${endpoint} at path: ${docPath}`);

    // Log refresh event and update refreshHistory using the canonical service
    const refreshLogger = new RefreshLoggerService();
    // You need the TTL for this endpoint; get it from AV_TIME_SERIES_ENDPOINT_CONFIGS or pass as param
    const endpointConfig = AV_TIME_SERIES_ENDPOINT_CONFIGS[endpoint];
    if (!endpointConfig || typeof endpointConfig.ttl !== 'number') {
        throw new Error(`aFH sATSD TTL (ttlSeconds) must be specified in AV_TIME_SERIES_ENDPOINT_CONFIGS for endpoint: ${endpoint}`);
      }
    const ttlSeconds = endpointConfig.ttl;
    await refreshLogger.logRefreshEvent(
      {
        vendor: ApiProvider.ALPHA_VANTAGE,
        endpoint,
        symbol,
        ttlSeconds,
        docPath,
      },
      {
        refreshedBy: 'system',
        status: RefreshStatus.SUCCESS,
        triggeredBy: RefreshTrigger.SCHEDULER,
        durationMs: Date.now() - startTime,
        // Optionally add more event fields
      }
    );
  } catch (error) {
    console.error('aFH sATSD Error saving time series data to Firestore:', error);
    throw error;
  }
}

/**
 * Ensures the time series exists for a symbol/interval in Firestore.
 * If missing, fetches full time series from Alpha Vantage and writes it.
 * Returns true if initialized (or already exists), false if fetch failed.
 */
export async function initializeTimeSeriesIfMissing(
  symbol: string,
  interval: TimeSeriesInterval,
  endpoint: AlphaVantageEndpoint,
): Promise<boolean> {
  // Canonical doc path for time series
  const docPath = getSymbolTimeSeriesDocPath(symbol, endpoint, ApiProvider.ALPHA_VANTAGE);
  const dataRef = db.doc(docPath);
  const doc = await dataRef.get();
  if (doc.exists) return true;

  console.log(`[initTSIM] No time series found at path: ${docPath}. Fetching full...`);
  console.log(`[initTSIM] Will write to Firestore path: ${docPath}`);

  // Fetch the full time series from Alpha Vantage using canonical config and handler
  const endpointConfig = AV_TIME_SERIES_ENDPOINT_CONFIGS[endpoint];
  if (!endpointConfig) {
    throw new Error(`[initTSIM] No time series config found for endpoint: ${endpoint}`);
  }
  let handler;
  switch (endpoint) {
    case AlphaVantageEndpoint.TIME_SERIES_DAILY:
      handler = new AvDailyTimeSeriesHandler(endpointConfig);
      break;
    // TODO: Add cases for WEEKLY, MONTHLY, etc. with their respective handlers
    default:
      throw new Error(`[initTSIM] No handler implemented for endpoint: ${endpoint}`);
  }
  const response = await handler.fetch({ symbol, outputsize: OutputSize.COMPACT });
  let data = response.data;

  if (!data || !Array.isArray(data) || data.length === 0) {
    console.log(`[initTSIM] No data received from AV for ${symbol} [${interval}] at path: ${docPath}`);
    return false;
  }

  // Emulator-aware truncation for local testing
  const isEmulator = process.env.FUNCTIONS_EMULATOR === 'true' || !!process.env.FIRESTORE_EMULATOR_HOST;
  console.log('[initTSIM] Emulator detected?: ', isEmulator);
  if (isEmulator) {
    console.log('[initTSIM] Emulator detected: truncating time series data to first 10 records.');
    data = data.slice(0, 10);
    console.log(`[initTSIM] Data length after truncation: ${data.length}`);
  }

  // Handler is responsible for saving data and logging refresh event
  // Do NOT call saveAvTimeSeriesData here!

  console.log(`[initTSIM] Initialized time series at path: ${docPath} (${data.length} entries)`);
  return true;
}
