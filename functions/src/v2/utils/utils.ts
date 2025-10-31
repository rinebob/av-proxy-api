import axios from 'axios';
import { db } from '../../firebase-admin-init';
import { defineSecret } from "firebase-functions/params";

import { authenticateFirebaseUser } from './auth';

import { AlphaVantageDailyTimeSeriesResponse, AlphaVantageGlobalQuoteResponse, ALPHAVANTAGE_BASE_URL } from '@shared/alpha-vantage';
import { MarketClosureReason } from '@shared/core';

// Create a union type for all possible Alpha Vantage API responses
export type AlphaVantageResponse = AlphaVantageDailyTimeSeriesResponse | AlphaVantageGlobalQuoteResponse;

// ------------------------------
// Structured Logger (Reusable)
// ------------------------------
export type LogLevel = 'error' | 'warn' | 'info' | 'debug';
const LEVELS: Record<LogLevel, number> = { error: 0, warn: 1, info: 2, debug: 3 };
/**
 * Create a structured JSON logger with level-based filtering.
 * Logs are emitted as single JSON objects for easy querying in Cloud Run.
 * @param component A short name of the component/file to tag each entry.
 * @returns An object with debug/info/warn/error functions.
 */
export function createLogger(component: string) {
  const envLevel = (process.env.LOG_LEVEL || 'info').toLowerCase() as LogLevel;
  const threshold = LEVELS[envLevel] ?? LEVELS.info;
  const should = (level: LogLevel) => LEVELS[level] <= threshold;
  function log(level: LogLevel, event: string, payload: Record<string, unknown> = {}) {
    if (!should(level)) return;
    const entry = {
      component,
      event,
      level,
      timestamp: new Date().toISOString(),
      ...payload,
    } as const;
    console.log(JSON.stringify(entry));
  }
  return {
    info: (event: string, payload?: Record<string, unknown>) => log('info', event, payload),
    warn: (event: string, payload?: Record<string, unknown>) => log('warn', event, payload),
    error: (event: string, payload?: Record<string, unknown>) => log('error', event, payload),
    debug: (event: string, payload?: Record<string, unknown>) => log('debug', event, payload),
  };
}

const logger = createLogger('utils');

export const HUMAN_LOGS = process.env.HUMAN_LOGS === 'true';
/**
 * Print a human-friendly line (disabled unless HUMAN_LOGS=true).
 * Use for local debugging while keeping JSON logs clean in production.
 */
export function hr(component: string, message: string, ...args: unknown[]) {
  if (!HUMAN_LOGS) return;
  console.log(`${component} ${message}`, ...args);
}
/**
 * Emit one or more blank lines to the human log stream.
 * @param count Number of blank lines to print (default 1).
 */
export function hrBlank(count = 1) {
  if (!HUMAN_LOGS) return;
  for (let i = 0; i < count; i++) console.log('');
}

// ---------------------------------------
// US Market (NYSE) Holiday Utilities (ET)
// ---------------------------------------
function observedDate(year: number, month1to12: number, day: number): { m: number; d: number } {
  const actual = new Date(Date.UTC(year, month1to12 - 1, day));
  const dow = actual.getUTCDay(); // 0=Sun..6=Sat
  if (dow === 6) { // Saturday -> observed Friday
    const obs = new Date(Date.UTC(year, month1to12 - 1, day - 1));
    return { m: obs.getUTCMonth() + 1, d: obs.getUTCDate() };
  }
  if (dow === 0) { // Sunday -> observed Monday
    const obs = new Date(Date.UTC(year, month1to12 - 1, day + 1));
    return { m: obs.getUTCMonth() + 1, d: obs.getUTCDate() };
  }
  return { m: month1to12, d: day };
}

function nthWeekdayOfMonthUtc(year: number, month1to12: number, weekday0Sun6Sat: number, nth: number): Date {
  const first = new Date(Date.UTC(year, month1to12 - 1, 1));
  const firstDow = first.getUTCDay();
  const delta = (weekday0Sun6Sat - firstDow + 7) % 7;
  const day = 1 + delta + (nth - 1) * 7;
  return new Date(Date.UTC(year, month1to12 - 1, day));
}

function lastWeekdayOfMonthUtc(year: number, month1to12: number, weekday0Sun6Sat: number): Date {
  const firstNext = new Date(Date.UTC(year, month1to12, 1));
  const lastPrev = new Date(firstNext.getTime() - 24 * 3600 * 1000);
  const lastDow = lastPrev.getUTCDay();
  const delta = (lastDow - weekday0Sun6Sat + 7) % 7;
  const day = lastPrev.getUTCDate() - delta;
  return new Date(Date.UTC(year, month1to12 - 1, day));
}

// Anonymous Gregorian algorithm for Easter Sunday (UTC mechanics sufficient for date-only matching)
function easterSundayUtc(year: number): Date {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31); // 3=March, 4=April
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return new Date(Date.UTC(year, month - 1, day));
}

/** Returns true if the provided ET-local date falls on a US market holiday (NYSE). */
export function isUsMarketHolidayEt(etDate: Date): boolean {
  const year = etDate.getFullYear();
  const month = etDate.getMonth() + 1; // 1-12
  const day = etDate.getDate();

  // Fixed-date with observance rules
  const nyObs = observedDate(year, 1, 1);
  if (nyObs.m === month && nyObs.d === day) return true; // New Year's Day
  const june19Obs = observedDate(year, 6, 19);
  if (june19Obs.m === month && june19Obs.d === day) return true; // Juneteenth
  const july4Obs = observedDate(year, 7, 4);
  if (july4Obs.m === month && july4Obs.d === day) return true; // Independence Day
  const xmasObs = observedDate(year, 12, 25);
  if (xmasObs.m === month && xmasObs.d === day) return true; // Christmas

  // MLK Day: third Monday in January
  const mlk = nthWeekdayOfMonthUtc(year, 1, 1, 3);
  if (month === 1 && day === mlk.getUTCDate()) return true;

  // Presidents' Day: third Monday in February
  const presidents = nthWeekdayOfMonthUtc(year, 2, 1, 3);
  if (month === 2 && day === presidents.getUTCDate()) return true;

  // Good Friday: two days before Easter Sunday
  const easter = easterSundayUtc(year);
  const goodFriday = new Date(easter.getTime() - 2 * 24 * 3600 * 1000);
  if (month === (goodFriday.getUTCMonth() + 1) && day === goodFriday.getUTCDate()) return true;

  // Memorial Day: last Monday in May
  const memorial = lastWeekdayOfMonthUtc(year, 5, 1);
  if (month === 5 && day === memorial.getUTCDate()) return true;

  // Labor Day: first Monday in September
  const labor = nthWeekdayOfMonthUtc(year, 9, 1, 1);
  if (month === 9 && day === labor.getUTCDate()) return true;

  // Thanksgiving Day: fourth Thursday in November
  const thanksgiving = nthWeekdayOfMonthUtc(year, 11, 4, 4);
  if (month === 11 && day === thanksgiving.getUTCDate()) return true;

  return false;
}

/**
 * Returns whether the US market is closed now (ET), with a reason for logging.
 * reason = 'WEEKEND' | 'HOLIDAY' | null
 */
export function getMarketClosureInfo(): { closed: boolean; reason: MarketClosureReason | null; etDate: string } {
  const tz = 'America/New_York';
  const now = new Date();
  const etNow = new Date(now.toLocaleString('en-US', { timeZone: tz }));
  const dowEt = etNow.getDay(); // 0=Sun..6=Sat
  const etDateStr = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
  if (dowEt === 0 || dowEt === 6) return { closed: true, reason: MarketClosureReason.WEEKEND, etDate: etDateStr };
  if (isUsMarketHolidayEt(etNow)) return { closed: true, reason: MarketClosureReason.HOLIDAY, etDate: etDateStr };
  return { closed: false, reason: null, etDate: etDateStr };
}

/** Convenience boolean wrapper around getMarketClosureInfo() */
export function isMarketClosedEtNow(): boolean {
  return getMarketClosureInfo().closed;
}

/** Components used in refresh logging for stronger typing/consistency */
export enum RefreshLogComponent {
  RunManager = 'runRefreshAlphaVantageDataV2',
  RefreshForEndpoints = 'refreshForEndpoints',
}

/** Define the Alpha Vantage API key as a Firebase Function parameter
* The key 'ALPHAVANTAGE_API_KEY' is what you'll see in the .env.<project-id> file
* and what you'd set in the Google Cloud Console if managing directly.
* The CLI command `firebase functions:config:set alphavantage.key="YOUR_KEY"`
* actually creates an entry that defineString can pick up if the key name matches.
* Let's use a clear name for the parameter.
*/
export const alphaVantageApiKeyParam = defineSecret("ALPHAVANTAGE_API_KEY");

// Secrets for auth config (production). In emulator, fall back to process.env.
const allowedServiceAccountsSecret = defineSecret("ALLOWED_SERVICE_ACCOUNT_EMAILS");
const expectedGoogleAudienceSecret = defineSecret("EXPECTED_GOOGLE_AUDIENCE");

// Only load .env in non-production environment
if (process.env.FUNCTIONS_EMULATOR === 'true') {
  require('dotenv').config({ path: './local-dev.env.alpha-vantage-proxy-api' });
}

export { db };

/**
 * Authenticates an incoming request by validating the Firebase ID token.
 * @param req The Express request object.
 * @param res The Express response object.
 * @returns A promise that resolves to the decoded ID token, or null if authentication fails.
 */
/**
 * Sets the required CORS headers on the response.
 * @param res The Express response object.
 */
export function setCorsHeaders(res: any): void {
  res.set('Access-Control-Allow-Origin', '*');
  res.set('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.set('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-API-KEY, x-debug-request');
  res.set('Access-Control-Max-Age', '3600');
}

/**
 * Handles CORS preflight OPTIONS requests.
 * @param req The Express request object.
 * @param res The Express response object.
 * @returns True if the request was an OPTIONS request and was handled, false otherwise.
 */
export function handleOptionsRequest(req: any, res: any): boolean {
  if (req.method === 'OPTIONS') {
    setCorsHeaders(res);
    res.status(204).send('');
    return true;
  }
  return false;
}

export async function authenticateRequest(
  req: any,
  res: any
): Promise<any | null> {
  try {
    const idToken = req.headers.authorization?.split('Bearer ')[1];
    if (!idToken) {
      setCorsHeaders(res); // Ensure CORS headers on error response
      res.status(401).json({ error: 'Unauthorized', message: 'No authentication token provided.' });
      return null;
    }

    const decodedToken = await authenticateFirebaseUser(idToken);
    if (!decodedToken) {
      setCorsHeaders(res); // Ensure CORS headers on error response
      res.status(403).json({
        error: 'Forbidden',
        message: 'Invalid or expired authentication token.'
      });
      return null;
    }
    return decodedToken;
  } catch (error) {
    // handleApiError should ideally handle CORS, but we add it here for safety
    setCorsHeaders(res);
    handleApiError(error, res, 'authenticateRequest');
    return null;
  }
}

/**
 * Validate a Google OIDC ID token via tokeninfo endpoint and return decoded info if valid.
 * WARNING: This calls Google's tokeninfo endpoint; suitable for low-QPS internal admin calls.
 */
async function validateGoogleOidcToken(idToken: string): Promise<any | null> {
  try {
    const { data } = await axios.get('https://oauth2.googleapis.com/tokeninfo', {
      params: { id_token: idToken },
      timeout: 5000,
    });
    // data.iss should be Google accounts; email may be present for service accounts
    if (!data || !data.iss) return null;
    const iss = String(data.iss);
    if (iss !== 'https://accounts.google.com' && iss !== 'accounts.google.com') return null;
    return data; // includes fields like email, aud, sub, exp, etc.
  } catch (e) {
    return null;
  }
}

// Allowlisted service accounts are read from environment only.
// Use uppercase key everywhere to satisfy Firebase env loader requirements.
// i.e. ALLOWED_SERVICE_ACCOUNT_EMAILS="maintenance-bot@alpha-vantage-proxy-api.iam.gserviceaccount.com"

/**
 * Read the allowlist of service account emails.
 * Source: process.env.ALLOWED_SERVICE_ACCOUNT_EMAILS (comma-separated).
 * Values are normalized to lowercase and trimmed.
 */
function getAllowedServiceAccounts(): string[] {
  // Emulator/local: use process.env
  if (process.env.FUNCTIONS_EMULATOR === 'true') {
    const raw = process.env.ALLOWED_SERVICE_ACCOUNT_EMAILS || '';
    return raw
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)
      .map((s) => s.toLowerCase());
  }
  // Production: use Secret Manager (mounted by Functions)
  try {
    const raw = allowedServiceAccountsSecret.value();
    const str = typeof raw === 'string' ? raw : String(raw || '');
    return str
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)
      .map((s) => s.toLowerCase());
  } catch {
    return [];
  }
}

// Optional: expected Google audience (Cloud Run base URL) for Google ID tokens.
// If provided, we will require aud to match exactly to mitigate token confusion.

/**
 * Optional expected Google audiences for Google ID tokens.
 * Supports comma-separated values so you can accept multiple audiences
 * (e.g., shared CF base host and specific function URLs).
 * If provided, the audience (aud) must match one of the configured entries.
 * @returns Array of accepted audiences (normalized, trimmed). Empty array means "no audience enforcement".
 */
function getExpectedGoogleAudiences(): string[] {
  const parse = (val: string | null | undefined): string[] =>
    (val || '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);

  // Emulator/local
  if (process.env.FUNCTIONS_EMULATOR === 'true') {
    const raw = process.env.EXPECTED_GOOGLE_AUDIENCE || process.env.PARTNER_AUDIENCE || '';
    return parse(raw);
  }
  // Production from Secret Manager
  try {
    const raw = expectedGoogleAudienceSecret.value();
    const str = typeof raw === 'string' ? raw : String(raw || '');
    return parse(str);
  } catch {
    return [];
  }
}

/**
 * Parse a JWT payload without verification to quickly inspect iss/aud.
 * Use only for hints before full verification (e.g., tokeninfo/Admin SDK).
 * @param token The JWT string.
 * @returns The decoded payload object or null on failure.
 */
function decodeJwtPayload(token: string): any | null {
  try {
    const parts = token.split('.');
    if (parts.length < 2) return null;
    const payload = parts[1]
      .replace(/-/g, '+')
      .replace(/_/g, '/');
    const json = Buffer.from(payload, 'base64').toString('utf8');
    return JSON.parse(json);
  } catch {
    return null;
  }
}

/**
 * Accept either Firebase ID token OR Google OIDC from an allowlisted service account.
 * New logic: detect token type by iss/aud. If Google OIDC (iss accounts.google.com) with matching audience,
 * validate via tokeninfo and allow when email is in allowlist. Skip Firebase verification on Google tokens to
 * avoid audience mismatch errors. If Firebase token (aud equals Firebase project), verify via Admin SDK.
 */
export async function authenticateRequestEither(
  req: any,
  res: any
): Promise<any | { serviceAccountEmail: string } | null> {
  try {
    const authHeader = req.headers.authorization;
    const idToken = authHeader?.startsWith('Bearer ') ? authHeader.split(' ')[1] : authHeader;
    if (!idToken) {
      setCorsHeaders(res);
      res.status(401).json({ error: 'Unauthorized', message: 'No authentication token provided.' });
      return null;
    }

    const decoded = decodeJwtPayload(idToken) || {};
    const iss = String(decoded.iss || '');
    const aud = String(decoded.aud || '');
    const expectedGoogleAuds = getExpectedGoogleAudiences();
    const firebaseProjectId = process.env.GCLOUD_PROJECT || process.env.GCP_PROJECT || process.env.FIREBASE_CONFIG && (() => {
      try { return JSON.parse(String(process.env.FIREBASE_CONFIG)).projectId as string; } catch { return ''; }
    })() || '';

    // Branch 1: Google OIDC service-to-service path
    const isGoogleIssuer = iss === 'https://accounts.google.com' || iss === 'accounts.google.com';
    const googleAudOk = expectedGoogleAuds.length === 0 || expectedGoogleAuds.includes(aud);
    createLogger('auth').debug('either.detect', { isGoogleIssuer, iss, aud, expectedGoogleAuds, googleAudOk, hasAuthHeader: !!authHeader });

    if (isGoogleIssuer && googleAudOk) {
      // Verify with tokeninfo (low-QPS acceptable). Do NOT attempt Firebase verification on Google tokens.
      const decodedOidc = await validateGoogleOidcToken(idToken);
      createLogger('auth').debug('either.google.tokeninfo', {
        valid: !!decodedOidc,
        iss: decodedOidc?.iss,
        aud: decodedOidc?.aud,
        hasEmail: !!decodedOidc?.email,
      });
      if (decodedOidc) {
        // If expected audiences are configured, enforce that aud matches one of them.
        if (expectedGoogleAuds.length > 0 && !expectedGoogleAuds.includes(String(decodedOidc.aud))) {
          createLogger('auth').warn('either.google.aud_mismatch', { expectedGoogleAuds, got: decodedOidc.aud });
          setCorsHeaders(res);
          res.status(403).json({ error: 'Forbidden', message: 'Google ID token audience mismatch.' });
          return null;
        }
        const email = String(decodedOidc.email || '').toLowerCase();
        const allowed = getAllowedServiceAccounts();
        createLogger('auth').debug('either.google.allowlist', { email, allowedCount: allowed.length, allowedSample: allowed.slice(0, 3) });
        if (email && allowed.includes(email)) {
          createLogger('auth').info('either.google.allowed', { email });
          return { serviceAccountEmail: email };
        }
        createLogger('auth').warn('either.google.denied', { reason: 'email_not_allowlisted', email });
      }
      setCorsHeaders(res);
      res.status(403).json({ error: 'Forbidden', message: 'Invalid or unauthorized Google ID token.' });
      return null;
    }

    // Branch 2: Firebase ID token path (end-user/browser calls)
    // Firebase ID tokens typically have aud equal to the Firebase project ID (or project number). We enforce projectId if available.
    const decodedFirebase = await authenticateFirebaseUser(idToken).catch(() => null);
    createLogger('auth').debug('either.firebase.verify', { valid: !!decodedFirebase, firebaseProjectId });
    if (decodedFirebase) {
      // If we can read aud from decoded (when Admin SDK returns it), prefer checking against projectId when available.
      const tokenAud = String((decodedFirebase as any)?.aud || '');
      createLogger('auth').debug('either.firebase.aud', { tokenAud });
      if (!firebaseProjectId || tokenAud === firebaseProjectId || !tokenAud) {
        createLogger('auth').info('either.firebase.allowed', { uid: (decodedFirebase as any)?.uid });
        return decodedFirebase;
      }
      // If aud present and mismatched, reject to avoid accepting tokens for wrong project.
      createLogger('auth').warn('either.firebase.denied', { reason: 'aud_mismatch', expected: firebaseProjectId, got: tokenAud });
      setCorsHeaders(res);
      res.status(403).json({ error: 'Forbidden', message: 'Firebase token audience mismatch.' });
      return null;
    }

    // Fallback: try Google OIDC without relying on iss/aud decode (in case of missing fields in unsigned decode)
    const decodedOidc = await validateGoogleOidcToken(idToken);
    createLogger('auth').debug('either.google.fallback.tokeninfo', {
      valid: !!decodedOidc,
      aud: decodedOidc?.aud,
      hasEmail: !!decodedOidc?.email,
    });
    if (decodedOidc) {
      if (expectedGoogleAuds.length > 0 && !expectedGoogleAuds.includes(String(decodedOidc.aud))) {
        createLogger('auth').warn('either.google.fallback.aud_mismatch', { expectedGoogleAuds, got: decodedOidc.aud });
        setCorsHeaders(res);
        res.status(403).json({ error: 'Forbidden', message: 'Google ID token audience mismatch.' });
        return null;
      }
      const email = String(decodedOidc.email || '').toLowerCase();
      const allowed = getAllowedServiceAccounts();
      createLogger('auth').debug('either.google.fallback.allowlist', { email, allowedCount: allowed.length });
      if (email && allowed.includes(email)) {
        createLogger('auth').info('either.google.fallback.allowed', { email });
        return { serviceAccountEmail: email };
      }
      createLogger('auth').warn('either.google.fallback.denied', { reason: 'email_not_allowlisted', email });
    }

    setCorsHeaders(res);
    res.status(403).json({ error: 'Forbidden', message: 'Invalid or unauthorized token.' });
    return null;
  } catch (error) {
    setCorsHeaders(res);
    handleApiError(error, res, 'authenticateRequestEither');
    return null;
  }
}

/**
 * Retrieves the Alpha Vantage API key from environment or secret.
 * @returns {string} The API key. Throws an error if not found.
 */
export function getAlphaVantageApiKey(): string {
  if (process.env.FUNCTIONS_EMULATOR === 'true') {
    const localKey = process.env.LOCAL_EMULATOR_ALPHAVANTAGE_API_KEY;
    if (localKey) {
      logger.info('Using local emulator API key from process.env.');
      return localKey;
    }
    throw new Error("Local emulator API key not set in environment.");
  }
  // In deployed environment, use the secret
  const apiKey = alphaVantageApiKeyParam.value();
  if (!apiKey) {
    logger.error("FATAL: ALPHAVANTAGE_API_KEY secret not found or loaded.");
    throw new Error("Server configuration error: Missing Alpha Vantage API key.");
  }
  return apiKey;
}

/**
 * Fetches data from the Alphavantage API for a specified function and symbol.
 * @param params An object containing all necessary parameters for the API call (e.g., function, symbol, outputsize).
 * @param apiKey The Alpha Vantage API key.
 * @returns A promise that resolves to the API response.
 * @throws An error if the API call fails.
 */
export async function fetchStockData(
  params: { [key: string]: string }, 
  apiKey: string
): Promise<AlphaVantageResponse> {
  logger.info('----------- Utils fetchStockData ---------------');
    // Construct the query parameters for the Alpha Vantage API call
    const queryParams = new URLSearchParams({
        ...params,
        apikey: apiKey,
    });

    const url = `${ALPHAVANTAGE_BASE_URL}?${queryParams.toString()}`;
    logger.info(`ut fSD Fetching data from URL: ${url}`);

    try {
        const response = await axios.get<AlphaVantageResponse>(url);

        logger.info(`ut fSD response: ${response}`);
        
        // The Alpha Vantage API sometimes returns a 200 OK sttus even for errors,
        // with the error message in the response body. We need to check for this.
        const responseData = response.data;
        logger.info(`ut fSD responseData: ${responseData}`);

        if (responseData['Error Message']) {
            logger.error('ut_fSD_api_error', { errorMessage: responseData['Error Message'] });
            // We will throw an error here so it can be caught by the handleApiError utility
            throw new Error(`API Error: ${responseData['Error Message']}`);
        }

        if (responseData['Note']) {
            logger.warn('ut_fSD_rate_limit_note', { note: responseData['Note'] });
            // Throw a specific error for rate limiting that can be handled downstream
            throw new Error(`ut fSD RATE_LIMIT: ${responseData['Note']}`);
        }

        return responseData;
    } catch (error: any) {
        // Log the detailed error and re-throw it to be handled by the calling function's catch block
        logger.error('ut_fSD_fetch_error', { symbol: params.symbol, error: String(error?.message || error) });
        // Re-throw the original error to preserve stack trace and allow for specific handling
        throw error;
    }
}

/**
 * Validates the HTTP request method
 */
export function validateRequestMethod(req: any, res: any): boolean {
  if (req.method !== 'GET') {
    logger.warn('validateRequestMethod.non_get', { method: req.method });
    res.status(405).json({ 
      error: 'Method Not Allowed',
      message: 'Please send a GET request.'
    });
    return false;
  }
  return true;
}

/**
 * Handles errors from API calls and sends appropriate HTTP responses
 * @param error The error object caught in a try-catch block
 * @param res The Express response object
 * @param context Optional context string for logging
 * @returns True if the error was handled, false otherwise
 */
export function handleApiError(error: any, res: any, context: string = ''): boolean {
  setCorsHeaders(res); // Ensure CORS headers are set on all error responses
  const contextPrefix = context ? `${context} - ` : '';
  
  // Check for rate limit error first and handle without stack trace
  if (error.message?.startsWith('RATE_LIMIT:')) {
    const rateLimitMessage = error.message.replace('RATE_LIMIT:', '').trim();
    logger.warn(`${contextPrefix}Rate limit error:`, rateLimitMessage);
    res.status(429).json({
      error: 'ut hAE Rate Limit Exceeded',
      message: rateLimitMessage,
      code: 'RATE_LIMIT_EXCEEDED'
    });
    return true;
  }
  
  // For other errors, log the full error
  logger.error('handleApiError.process_error', { context: contextPrefix.trim(), error: String(error) });
  
  // If we have an error response from Alpha Vantage
  if (error.response?.data) {
    const errorData = error.response.data;
    logger.error('handleApiError.provider_response', { context: contextPrefix.trim(), providerError: errorData });
    
    if (errorData['Error Message']) {
      res.status(400).json({ 
        error: 'ut hAE Alpha Vantage API Error',
        message: errorData['Error Message']
      });
    } else if (errorData['Information']) {
      res.status(400).json({ 
        error: 'ut hAE API Error',
        message: errorData['Information']
      });
    } else if (errorData['Note']) {
      res.status(429).json({ 
        error: 'ut hAE Rate Limit Exceeded',
        message: errorData['Note']
      });
    } else {
      res.status(400).json({ 
        error: 'ut hAE API Error',
        message: 'Unknown error from Alpha Vantage API',
        details: errorData
      });
    }
    return true;
  } 
  // If we have an error from our transform function
  else if (error.message) {
    res.status(400).json({ 
      error: 'ut hAE Data Processing Error',
      message: error.message
    });
    return true;
  }
  // If we have a network error
  else if (error.request) {
    logger.error('handleApiError.no_response', { context: contextPrefix.trim(), request: '[present]' });
    res.status(504).json({ 
      error: 'ut hAE Gateway Timeout',
      message: 'No response received from AlphaVantage API' 
    });
    return true;
  }
  // For any other errors
  else {
    logger.error('handleApiError.unexpected', { context: contextPrefix.trim(), error: String(error) });
    res.status(500).json({
      error: 'ut hAE Internal Server Error',
      message: error.message || 'An unexpected error occurred'
    });
    return true;
  }
}

/**
 * Formats a Firestore Timestamp or Date to a Pacific Time string
 * @param date The date to format (can be Firestore Timestamp, Date, or null/undefined)
 * @returns Formatted date string in Pacific Time or 'N/A' if invalid
 */
export function formatPST(date: any): string {
  if (!date) return 'N/A';
  try {
    const d = date.toDate ? date.toDate() : new Date(date);
    if (isNaN(d.getTime())) return 'Invalid Date';
    return d.toLocaleString('en-US', {
      timeZone: 'America/Los_Angeles',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: true
    }) + ' PT';
  } catch (error) {
    logger.error('formatPST.error', { error: String(error) });
    return 'Invalid Date';
  }
}

/**
 * Converts a duration in seconds to a human-readable string.
 * Examples: 3600 -> '1 hour', 90000 -> '1 day 1 hour'
 * @param {number} seconds The total seconds to format.
 * @returns {string} The formatted human-readable string.
 */
export function formatTtlSeconds(seconds: number): string {
  if (seconds < 60) {
    return `${seconds} second${seconds !== 1 ? 's' : ''}`;
  }

  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);

  const parts: string[] = [];
  if (days > 0) {
    parts.push(`${days} day${days > 1 ? 's' : ''}`);
  }
  if (hours > 0) {
    parts.push(`${hours} hour${hours > 1 ? 's' : ''}`);
  }
  if (minutes > 0) {
    parts.push(`${minutes} minute${minutes > 1 ? 's' : ''}`);
  }

  return parts.join(' ') || '0 seconds';
}

// Force redeploy to apply IAM changes.