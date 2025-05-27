import axios from 'axios';
import { defineSecret, defineString } from "firebase-functions/params"; // Ensure defineString is imported
import * as logger from "firebase-functions/logger";
import * as dotenv from 'dotenv';
import admin from 'firebase-admin';
import { ALPHAVANTAGE_BASE_URL, AlphaVantageFunction } from './common-fn';

/** Define the Alpha Vantage API key as a Firebase Function parameter
* The key 'ALPHAVANTAGE_API_KEY' is what you'll see in the .env.<project-id> file
and what you'd set in the Google Cloud Console if managing directly.
The CLI command `firebase functions:config:set alphavantage.key="YOUR_KEY"`
actually creates an entry that defineString can pick up if the key name matches.
Let's use a clear name for the parameter.
*/
export const alphaVantageApiKeyParam = defineSecret("ALPHAVANTAGE_API_KEY");

// New param for local emulator. This is read from .env.<project-id> by the emulator.
// It uses a different name to avoid conflicts during deployment when ALPHAVANTAGE_API_KEY
// (the secret) is sourced from Secret Manager.
const localEmulatorAlphaVantageApiKeyParam = defineString("LOCAL_EMULATOR_ALPHAVANTAGE_API_KEY", {
  input: {text: {}},
  default: "", // Default to empty string, so value() doesn't throw if not set, allowing logic to proceed
  description: "API key for Alpha Vantage, ONLY for local emulator use. For deployed functions, the ALPHAVANTAGE_API_KEY secret is used.",
});
export const allowedUserUidParam = defineString("ALLOWED_USER_UID"); // Define your UID as a string parameter
 
// You can also provide a default, description, etc.
// const alphaVantageApiKeyParam = defineString("ALPHAVANTAGE_API_KEY", {
//   description: "The API key for Alpha Vantage",
//   // default: "YOUR_DEFAULT_KEY_IF_ANY_FOR_LOCAL_EMULATION_WITHOUT_ENV_FILE",
// });

// Load environment variables from .env during local development
// This will not run in the deployed Firebase Function environment
if (process.env['NODE_ENV'] !== 'production') {
  dotenv.config(); // Access using bracket notation
}

// Initialize Firebase Admin SDK if not already initialized
if (admin.apps.length === 0) {
  admin.initializeApp();
  logger.info('Firebase Admin SDK initialized.');
}

/**
 * Authenticates a Firebase user based on the ID token in the Authorization header.
 * Sends a 401 or 403 response if authentication fails.
 * @param req The Express request object.
 * @param res The Express response object.
 * @param functionName For logging purposes, the name of the calling Cloud Function.
 * @returns A Promise resolving with the decoded ID token (admin.auth.DecodedIdToken) if successful, or null if authentication failed and response was sent.
 */
export async function authenticateFirebaseUser(
  req: any, // Consider using import { Request } from 'firebase-functions/v2/https'; for stronger typing if using v2
  res: any, // Consider using import { Response } from 'express'; for stronger typing
  functionName: string = 'CloudFunction' // Default function name for logging
): Promise<admin.auth.DecodedIdToken | null> {
  const authorizationHeader = req.headers.authorization;
  if (!authorizationHeader || !authorizationHeader.startsWith('Bearer ')) {
    logger.warn(`${functionName}: Unauthorized - No Bearer token provided.`);
    res.status(401).json({ error: 'Unauthorized: No Bearer token provided.' });
    return null;
  }

  const idToken = authorizationHeader.split('Bearer ')[1];
  try {
    const decodedToken = await admin.auth().verifyIdToken(idToken);
    
    // ADD THIS CHECK:
    const allowedUidFromEnv = allowedUserUidParam.value(); // Retrieve UID from params
    
    if (!allowedUidFromEnv) {
      logger.error(`${functionName}: Configuration error - ALLOWED_USER_UID is not set in environment.`);
      res.status(500).json({ error: 'Internal server error: Configuration issue.' });
      return null;
    }

    if (decodedToken.uid !== allowedUidFromEnv) {
      logger.warn(`${functionName}: Forbidden - User ${decodedToken.uid} is not the allowed user.`);
      res.status(403).json({ error: 'Forbidden: Access restricted.' });
      return null;
    }
    // END OF ADDED CHECK

    logger.info(`${functionName}: Authenticated and authorized user: ${decodedToken.uid}`);
    return decodedToken;
  } catch (error) {
    logger.error(`${functionName}: Error verifying Firebase ID token:`, error);
    res.status(403).json({ error: 'Forbidden: Invalid or expired token.' });
    return null;
  }
}



/**
 * Sets common CORS headers on the response object.
 * @param res The Firebase Functions response object.
 */
export function setCorsHeaders(res: any): void {
  res.set('Access-Control-Allow-Origin', '*');
  res.set('Access-Control-Allow-Methods', 'GET, POST');
  res.set('Access-Control-Allow-Headers', 'Content-Type');
  res.set('Access-Control-Max-Age', '3600');
}

/**
 * Handles CORS preflight OPTIONS requests.
 * @param req The Firebase Functions request object.
 * @param res The Firebase Functions response object.
 * @returns True if the OPTIONS request was handled, false otherwise.
 */
export function handleOptionsRequest(req: any, res: any): boolean {
  // If it's an OPTIONS request, end the response here
  if (req.method === 'OPTIONS') {
    // Handle CORS for OPTIONS requests
    // res.set('Access-Control-Allow-Origin', '*');
    // res.set('Access-Control-Allow-Methods', 'GET, POST');
    // res.set('Access-Control-Allow-Headers', 'Content-Type');
    // res.set('Access-Control-Max-Age', '3600');
    console.log('fn utils hOR options block req.query: ', req.query)
    console.log('fn utils hOR options block req/res: ', req, res)
    res.status(204).send();
    return true;
  }

  console.log('fn utils hOR not options block req.query: ', req.query)
  console.log('fn utils hOR not options block req/res: ', req, res)
  // For other methods, just set the headers and continue
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
    logger.info("Using LOCAL_EMULATOR_ALPHAVANTAGE_API_KEY from .env file for local emulator.");
  } else {
    // For deployed functions or if local emulator key is not set, use the secret
    key = alphaVantageApiKeyParam.value();
    // Log only if the key was successfully retrieved from secrets, to avoid confusion before a potential error throw
    if (key) {
        logger.info("Using ALPHAVANTAGE_API_KEY secret for deployed function or as fallback.");
    }
  }

  if (!key) {
    logger.error(
      "Alpha Vantage API key could not be retrieved. " +
      "For deployed functions, ensure ALPHAVANTAGE_API_KEY secret is set via 'firebase functions:secrets:set ALPHAVANTAGE_API_KEY'. " +
      "For local emulator, ensure LOCAL_EMULATOR_ALPHAVANTAGE_API_KEY is set in your .env.<project-id> file."
    );
    throw new Error("Configuration error: Alpha Vantage API key is missing or not accessible.");
  }
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
  const params = {
    function: 'TIME_SERIES_DAILY',
    symbol: symbol,
    apikey: apiKey,
  };

  console.log('fn utils fSD symbol/apiKey: ', symbol, apiKey)
  console.log('fn utils fSD axios request URL:', `${ALPHAVANTAGE_BASE_URL}?${new URLSearchParams(params).toString()}`);
  try {
    const response = await axios.get(ALPHAVANTAGE_BASE_URL, { params });
    console.log('fn utils fSD response: ', response);
    console.log('fn utils fSD response.data: ', response.data);

    return response;
  } catch (error: any) {
    console.log('fn utils fSD error: ', error);
    // Re-throw with more context or handle specifically if needed
    throw new Error(`Util - Failed to fetch data for symbol ${symbol}: ${error.message}`);
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
  alphaVantageFunction: AlphaVantageFunction, // Accept AlphaVantageFunction enum
  symbol: string,
  apiKey: string,
  additionalParams: { [key: string]: string } = {} // Allow for additional parameters
): Promise<any> { // Return Promise<AxiosResponse<any>> for better type info
  const params = {
      function: alphaVantageFunction, // Use the passed function parameter
      symbol: symbol,
      apikey: apiKey,
      ...additionalParams, // Include any additional parameters
  };

  console.log('fn utils fSD function/symbol/apiKey: ', alphaVantageFunction, symbol, apiKey);
  console.log('fn utils fSD axios request URL params:', params);

  try {
      // Use the imported ALPHAVANTAGE_BASE_URL
      const response = await axios.get(ALPHAVANTAGE_BASE_URL, { params });
      console.log('fn utils fSD response status: ', response.status);
      // Avoid logging large response data in production, useful for debugging though
      // console.log('fn utils fSD response.data: ', response.data);

      return response; // Return the full axios response object
  } catch (error: any) {
    console.error(`fn utils fSD error fetching data for ${symbol} with function ${alphaVantageFunction}:`, error);
      // Re-throw the error to be handled by the calling function
      throw error; // Re-throwing the original error is often better for preserving stack trace
  }
}