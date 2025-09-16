import axios from 'axios';
import { db } from '../../firebase-admin-init';
import { defineSecret, defineString } from "firebase-functions/params";
import * as dotenv from 'dotenv';

import { authenticateFirebaseUser } from './auth';

import { AlphaVantageDailyTimeSeriesResponse, AlphaVantageGlobalQuoteResponse, ALPHAVANTAGE_BASE_URL } from '@shared/alpha-vantage';

// Create a union type for all possible Alpha Vantage API responses
export type AlphaVantageResponse = AlphaVantageDailyTimeSeriesResponse | AlphaVantageGlobalQuoteResponse;

// ------------------------------
// Structured Logger (Reusable)
// ------------------------------
export type LogLevel = 'error' | 'warn' | 'info' | 'debug';
const LEVELS: Record<LogLevel, number> = { error: 0, warn: 1, info: 2, debug: 3 };
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
export function hr(component: string, message: string, ...args: unknown[]) {
  if (!HUMAN_LOGS) return;
  console.log(`${component} ${message}`, ...args);
}
export function hrBlank(count = 1) {
  if (!HUMAN_LOGS) return;
  for (let i = 0; i < count; i++) console.log('');
}

/** Define the Alpha Vantage API key as a Firebase Function parameter
* The key 'ALPHAVANTAGE_API_KEY' is what you'll see in the .env.<project-id> file
* and what you'd set in the Google Cloud Console if managing directly.
* The CLI command `firebase functions:config:set alphavantage.key="YOUR_KEY"`
* actually creates an entry that defineString can pick up if the key name matches.
* Let's use a clear name for the parameter.
*/
export const alphaVantageApiKeyParam = defineSecret("ALPHAVANTAGE_API_KEY");

/**
 * New param for local emulator. This is read from .env.<project-id> by the emulator.
 * It uses a different name to avoid conflicts during deployment when ALPHAVANTAGE_API_KEY
 * (the secret) is sourced from Secret Manager.
 */
const localEmulatorAlphaVantageApiKeyParam = defineString("LOCAL_EMULATOR_ALPHAVANTAGE_API_KEY", {
  input: {text: {}},
  default: "", // Default to empty string, so value() doesn't throw if not set, allowing logic to proceed
  description: "API key for Alpha Vantage, ONLY for local emulator use.",
});

// Only load .env in non-production environment
if (process.env.FUNCTIONS_EMULATOR === 'true') {
  dotenv.config();
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

function getAllowedServiceAccounts(): string[] {
  // Standardize on uppercase env var across environments
  const raw = process.env.ALLOWED_SERVICE_ACCOUNT_EMAILS || '';
  return raw
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
    .map((s) => s.toLowerCase());
}

/**
 * Accept either Firebase ID token OR Google OIDC from an allowlisted service account.
 * If Firebase verification fails, we attempt Google OIDC verification and allow if email matches allowlist.
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

    // Try Firebase first
    const decodedFirebase = await authenticateFirebaseUser(idToken);
    if (decodedFirebase) return decodedFirebase;

    // Fall back to Google OIDC token for internal service accounts
    const decodedOidc = await validateGoogleOidcToken(idToken);
    if (decodedOidc) {
      const email = String(decodedOidc.email || '').toLowerCase();
      const allowed = getAllowedServiceAccounts();
      if (email && allowed.includes(email)) {
        return { serviceAccountEmail: email };
      }
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
 * Retrieves the Alpha Vantage API key from Firebase environment configuration.
 * Logs an error if the key is not found.
 * @returns {string} The API key. Throws an error if not found.
 */
export function getAlphaVantageApiKey(): string {
  if (process.env.FUNCTIONS_EMULATOR === 'true') {
    const localKey = localEmulatorAlphaVantageApiKeyParam.value();
    if (localKey) {
      logger.info('Using local emulator API key.');
      return localKey;
    }
  }
  // In a deployed environment, use the secret
  const apiKey = alphaVantageApiKeyParam.value();
  if (!apiKey) {
    logger.error("FATAL: ALPHAVANTAGE_API_KEY secret not found or loaded.");
    // Throw an error to halt execution, as the function cannot proceed.
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