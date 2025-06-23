import axios from 'axios';
import { defineSecret, defineString } from "firebase-functions/params"; // Ensure defineString is imported
import * as dotenv from 'dotenv';
import admin from 'firebase-admin';
import { 
    ALPHAVANTAGE_BASE_URL, 
    AlphaVantageFunction,
    CloudFunctionName,
    AuthValidationResult,
    OutputSize
} from './common-fn';

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
  description: "API key for Alpha Vantage, ONLY for local emulator use. For deployed functions, the ALPHAVANTAGE_API_KEY secret is used.",
});

// Only load .env in non-production environment
if (process.env.FUNCTIONS_EMULATOR === 'true') {
  dotenv.config();
}

import { getFirestore } from 'firebase-admin/firestore';

if (admin.apps.length === 0) {
  admin.initializeApp();
  console.info('ut Firebase Admin SDK initialized.');
}

// Get a reference to the Firestore database, specifying the database ID
const db = getFirestore('alpha-vantage-proxy-api-db');
db.settings({ ignoreUndefinedProperties: true });

export const firebaseAdmin = admin;
export { db };

/**
 * Authenticates a Firebase user based on the ID token in the Authorization header.
 * Sends a 401 response if authentication fails.
 * @param req The Express request object.
 * @param res The Express response object.
 * @param functionName For logging purposes, the name of the calling Cloud Function.
 * @returns A Promise resolving with the decoded ID token (admin.auth.DecodedIdToken) if successful, or null if authentication failed and response was sent.
 */
export async function authenticateFirebaseUser(
  req: any,
  res: any,
  functionName: string = 'CloudFunction'
): Promise<admin.auth.DecodedIdToken | null> {
  console.log(`---ut aFU ${functionName}: Starting authentication ---`);
  console.log(`Request method: ${req.method}`);
  console.log(`Request URL: ${req.url}`);
  
  const authorizationHeader = req.headers.authorization;
  if (!authorizationHeader) {
    const errorMsg = `ut aFU ${functionName}: Unauthorized - No Authorization header provided.`;
    console.warn(errorMsg);
    res.status(401).json({ 
      error: 'Unauthorized: No Authorization header provided.',
      details: 'Missing Authorization header',
      function: functionName
    });
    return null;
  }
  
  if (!authorizationHeader.startsWith('Bearer ')) {
    const errorMsg = `ut aFU ${functionName}: Unauthorized - Invalid Authorization header format. Expected 'Bearer <token>'`;
    console.warn(errorMsg);
    res.status(401).json({ 
      error: 'Unauthorized: Invalid token format.',
      details: 'Expected Bearer token',
      function: functionName
    });
    return null;
  }

  const idToken = authorizationHeader.split('Bearer ')[1];
  console.log(`ut aFU ${functionName}: Extracted token (${idToken.length} chars)`);
  
  try {
    console.log(`ut aFU ${functionName}: Verifying ID token...`);
    const decodedToken = await admin.auth().verifyIdToken(idToken, true); // Check for token revocation
    
    console.log(`ut aFU ${functionName}: Successfully authenticated user:`, {
      uid: decodedToken.uid,
      email: decodedToken.email,
      is_emulator: process.env.FUNCTIONS_EMULATOR === 'true'
    });
    
    return decodedToken;
  } catch (error: any) {
    console.error(`ut aFU ${functionName}: Error verifying Firebase ID token:`, error);
    
    let errorMessage = 'Authentication failed';
    let errorDetails = 'Unknown error';
    let statusCode = 401; // Default to 401 for authentication failures
    
    // Handle specific error cases
    if (error.code === 'auth/id-token-expired') {
      errorMessage = 'Token has expired';
      errorDetails = 'The provided token has expired. Please sign in again.';
    } else if (error.code === 'auth/id-token-revoked') {
      errorMessage = 'Token has been revoked';
      errorDetails = 'The provided token has been revoked. Please sign in again.';
    } else if (error.code === 'auth/argument-error') {
      errorMessage = 'Invalid token format';
      errorDetails = 'The provided token is malformed.';
      statusCode = 400; // Bad Request
    } else if (error.code) {
      errorMessage = `Authentication error (${error.code})`;
      errorDetails = error.message || 'Unknown authentication error';
    } else {
      errorDetails = error.message || 'Unknown error during authentication';
    }
    
    console.error(`${functionName}: ${errorMessage} - ${errorDetails}`);
    res.status(statusCode).json({
      error: errorMessage,
      details: errorDetails,
      code: error.code || 'auth/unknown-error',
      function: functionName,
      timestamp: new Date().toISOString()
    });
    return null;
  }
}



/**
 * Sets common CORS headers on the response object.
 * @param res The Firebase Functions response object.
 */
export function setCorsHeaders(res: any): void {
  res.set('Access-Control-Allow-Origin', '*');
  res.set('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.set('Access-Control-Allow-Headers', 'Content-Type, Authorization, x-debug-request');
  res.set('Access-Control-Expose-Headers', 'x-debug-request');
  res.set('Access-Control-Max-Age', '3600');
  res.set('Access-Control-Allow-Credentials', 'true');
}

/**
 * Handles CORS preflight OPTIONS requests.
 * @param req The Firebase Functions request object.
 * @param res The Firebase Functions response object.
 * @returns True if the OPTIONS request was handled, false otherwise.
 */
export function handleOptionsRequest(req: any, res: any): boolean {
  if (req.method === 'OPTIONS') {
    console.log('fn utils hOR options block req.query: ', req.query);
    
    res.set('Access-Control-Allow-Origin', '*');
    res.set('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.set('Access-Control-Allow-Headers', 'Content-Type, Authorization, x-debug-request');
    res.set('Access-Control-Expose-Headers', 'x-debug-request');
    res.set('Access-Control-Max-Age', '3600');
    res.set('Access-Control-Allow-Credentials', 'true');
    
    res.status(204).send('');
    return true;
  }

  console.log('fn utils hOR not options block req.query: ', req.query)
  return false;
}


/**
 * Retrieves the Alpha Vantage API key from Firebase environment configuration.
 * Logs an error if the key is not found.
 * @returns {string} The API key. Throws an error if not found.
 */
export function getAlphaVantageApiKey(): string {
  let key: string | undefined;

  // Check if running in emulator AND local emulator key is provided via .env file
  if (process.env.FUNCTIONS_EMULATOR === "true" && localEmulatorAlphaVantageApiKeyParam.value()) {
    key = localEmulatorAlphaVantageApiKeyParam.value();
    console.info("Using LOCAL_EMULATOR_ALPHAVANTAGE_API_KEY from .env file for local emulator.");
  } else {
    // For deployed functions or if local emulator key is not set, use the secret
    key = alphaVantageApiKeyParam.value();
    // Log only if the key was successfully retrieved from secrets, to avoid confusion before a potential error throw
    if (key) {
        console.info("Using ALPHAVANTAGE_API_KEY secret for deployed function or as fallback.");
    }
  }

  if (!key) {
    console.error(
      "Alpha Vantage API key could not be retrieved. " +
      "For deployed functions, ensure ALPHAVANTAGE_API_KEY secret is set via 'firebase functions:secrets:set ALPHAVANTAGE_API_KEY'. " +
      "For local emulator, ensure LOCAL_EMULATOR_ALPHAVANTAGE_API_KEY is set in your .env.<project-id> file."
    );
    throw new Error("Configuration error: Alpha Vantage API key is missing or not accessible.");
  }
  console.log(`ut gAVAK: Retrieved key ending in: ...${key.slice(-4)}`);
  return key;
}

/**
 * Fetches daily stock data from the Alphavantage API.
 * @param symbol The stock symbol.
 * @param apiKey The Alphavantage API key.
 * @returns A Promise resolving with the API response data.
 * @throws An error if the API call fails.
 */
export async function fetchStockDataOld(symbol: string, apiKey: string): Promise<any> {
  // Validate input parameters
  if (!symbol || !apiKey) {
    throw new Error('Symbol and API key are required.');
  }

  const params = {
    function: 'TIME_SERIES_DAILY',
    symbol: symbol,
    outputsize: 'compact',
    datatype: 'json',
    apikey: apiKey,
  };

  console.log('fn utils fSD symbol/apiKey: ', symbol, apiKey)
  console.log('fn utils fSD axios request URL:', `${ALPHAVANTAGE_BASE_URL}?${new URLSearchParams(params).toString()}`);
  try {
    const response = await axios.get(ALPHAVANTAGE_BASE_URL, { params });
    console.log('fn utils fSD response.data: ', response.data);

    return response;
  } catch (error: any) {
    console.error(`Error fetching data for symbol ${symbol}:`, error.message);
    throw new Error(`Util - Failed to fetch data for symbol ${symbol}`);
  }
}


/**
 * Fetches data from the Alphavantage API for a specified function and symbol.
 * @param alphaVantageFunction The specific Alpha Vantage function to call (e.g., TIME_SERIES_DAILY, GLOBAL_QUOTE).
 * @param symbol The stock symbol or relevant asset symbol.
 * @param apiKey The Alphavantage API key.
 * @param additionalParams Optional additional parameters for the API call (e.g., interval for TIME_SERIES_INTRADAY).
 * @returns A Promise resolving with the Axios API response.
 * @throws An error if the API call fails.
 */


export async function fetchStockData(
  alphaVantageFunction: AlphaVantageFunction, 
  symbol: string,
  apiKey: string,
  additionalParams: { [key: string]: string } = {} 
): Promise<any> { 
  if (!symbol || !apiKey) {
    throw new Error('Symbol and API key are required.');
  }

  const params: any = {
      function: alphaVantageFunction,
      symbol: symbol,
      datatype: 'json',
      outputsize: 'compact', // Default to compact (100 data points), can be overridden in additionalParams
      apikey: apiKey,
      ...additionalParams, // This will override any of the above if specified
  };

  console.log('fn utils fSD function/symbol/apiKey: ', alphaVantageFunction, symbol, apiKey);
  console.log('fn utils fSD axios request URL params:', params);

  try {
      const response = await axios.get(ALPHAVANTAGE_BASE_URL, { params });
      console.log('fn utils fSD response status: ', response.status);
      // console.log('fn utils fSD response.data: ', response.data);

      return response.data; 
  } catch (error: any) {
    console.error(`fn utils fSD error fetching data for ${symbol} with function ${alphaVantageFunction}:`);
      throw error;
  }
}

/**
 * Validates the HTTP request method
 */
export function validateRequestMethod(req: any, res: any): boolean {
    if (req.method !== 'GET') {
        console.warn('Received non-GET request:', req.method);
        res.status(405).json({ 
            error: 'Method Not Allowed',
            message: 'Please send a GET request.'
        });
        return false;
    }
    return true;
}

/**
 * Validates and extracts query parameters
 */
export function validateAndExtractQueryParams(req: any, res: any): { symbol: string; outputSize: OutputSize } | null {
    const symbol = typeof req.query.symbol === 'string' ? req.query.symbol.trim() : null;
    if (!symbol) {
        res.status(400).json({ 
            error: 'Bad Request',
            message: 'Missing required parameter: symbol'
        });
        return null;
    }

    const outputSize = typeof req.query.outputsize === 'string' && 
                     Object.values(OutputSize).includes(req.query.outputsize.toLowerCase() as OutputSize)
                     ? req.query.outputsize.toLowerCase() as OutputSize
                     : OutputSize.COMPACT;

    return { symbol, outputSize };
}

/**
 * Validates the API key
 */
export function validateApiKey(apiKey: string | undefined, res: any): boolean {
    if (!apiKey) {
        console.error('Alpha Vantage API key not configured');
        res.status(500).json({ 
            error: 'Internal Server Error',
            message: 'API key not configured'
        });
        return false;
    }
    return true;
}

/**
 * Validates and authenticates the incoming request
 */
export async function validateAndAuthenticateRequest(
    req: any, 
    res: any,
    functionName: CloudFunctionName
): Promise<AuthValidationResult | null> {
    // Authentication
    const decodedToken = await authenticateFirebaseUser(req, res, functionName);
    if (!decodedToken) return null;

    // Request validation
    if (!validateRequestMethod(req, res)) return null;
    
    const params = validateAndExtractQueryParams(req, res);
    if (!params) return null;
    
    const apiKey = getAlphaVantageApiKey();
    if (!validateApiKey(apiKey, res)) return null;
    
    return { decodedToken, params, apiKey };
}

/**
 * Handles errors from API calls and sends appropriate HTTP responses
 * @param error The error object caught in a try-catch block
 * @param res The Express response object
 * @param context Optional context string for logging
 * @returns True if the error was handled, false otherwise
 */
export function handleApiError(error: any, res: any, context: string = ''): boolean {
  const contextPrefix = context ? `${context} - ` : '';
  
  // Check for rate limit error first and handle without stack trace
  if (error.message?.startsWith('RATE_LIMIT:')) {
      const rateLimitMessage = error.message.replace('RATE_LIMIT:', '').trim();
      console.warn(`${contextPrefix}Rate limit error:`, rateLimitMessage);
      res.status(429).json({
          error: 'Rate Limit Exceeded',
          message: rateLimitMessage,
          code: 'RATE_LIMIT_EXCEEDED'
      });
      return true;
  }
  
  // For other errors, log the full error
  console.error(`${contextPrefix}Error processing response:`, error);
  
  // If we have an error response from Alpha Vantage
  if (error.response?.data) {
      const errorData = error.response.data;
      console.error(`${contextPrefix}Alpha Vantage error response:`, errorData);
      
      if (errorData['Error Message']) {
          res.status(400).json({ 
              error: 'Alpha Vantage API Error',
              message: errorData['Error Message']
          });
      } else if (errorData['Information']) {
          res.status(400).json({ 
              error: 'API Error',
              message: errorData['Information']
          });
      } else if (errorData['Note']) {
          res.status(429).json({ 
              error: 'Rate Limit Exceeded',
              message: errorData['Note']
          });
      } else {
          res.status(400).json({ 
              error: 'API Error',
              message: 'Unknown error from Alpha Vantage API',
              details: errorData
          });
      }
      return true;
  } 
  // If we have an error from our transform function
  else if (error.message) {
      res.status(400).json({ 
          error: 'Data Processing Error',
          message: error.message
      });
      return true;
  }
  // If we have a network error
  else if (error.request) {
      console.error(`${contextPrefix}No response received from API:`, error.request);
      res.status(504).json({ 
          error: 'Gateway Timeout',
          message: 'No response received from AlphaVantage API' 
      });
      return true;
  }
  // For any other errors
  else {
      console.error(`${contextPrefix}Unexpected error:`, error);
      res.status(500).json({
          error: 'Internal Server Error',
          message: error.message || 'An unexpected error occurred'
      });
      return true;
  }
}

// Force redeploy to apply IAM changes.