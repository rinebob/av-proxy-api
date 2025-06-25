import axios from 'axios';
import { defineSecret, defineString } from "firebase-functions/params";
import * as dotenv from 'dotenv';
import { 
    AlphaVantageFunctionName,
    BenzingaFunctionName,
    AuthValidationResult
} from './common/common-fn';
import {
    ALPHAVANTAGE_BASE_URL,
    OutputSize,
    AlphaVantageDailyTimeSeriesResponse,
    AlphaVantageGlobalQuoteResponse,
    QueryParamsAv
} from './common/common-av';
import { db } from './firebase-admin-init';
import { authenticateFirebaseUser } from './utils/auth';

// Create a union type for all possible Alpha Vantage API responses
export type AlphaVantageResponse = AlphaVantageDailyTimeSeriesResponse | AlphaVantageGlobalQuoteResponse;

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
export async function authenticateRequest(
  req: any,
  res: any
): Promise<any | null> {
  try {
    const idToken = req.headers.authorization?.split('Bearer ')[1];
    if (!idToken) {
      res.status(401).json({ error: 'Unauthorized', message: 'No authentication token provided.' });
      return null;
    }

    const decodedToken = await authenticateFirebaseUser(idToken);
    if (!decodedToken) {
      res.status(403).json({
        error: 'Forbidden',
        message: 'Invalid or expired authentication token.'
      });
      return null;
    }
    return decodedToken;
  } catch (error) {
    handleApiError(error, res, 'authenticateRequest');
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
      console.log("Using local emulator API key.");
      return localKey;
    }
  }
  // In a deployed environment, use the secret
  const apiKey = alphaVantageApiKeyParam.value();
  if (!apiKey) {
    console.error("FATAL: ALPHAVANTAGE_API_KEY secret not found or loaded.");
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
    // Construct the query parameters for the Alpha Vantage API call
    const queryParams = new URLSearchParams({
        ...params,
        apikey: apiKey,
    });

    const url = `${ALPHAVANTAGE_BASE_URL}?${queryParams.toString()}`;
    console.log(`Fetching data from URL: ${url}`);

    try {
        const response = await axios.get<AlphaVantageResponse>(url);
        
        // The Alpha Vantage API sometimes returns a 200 OK status even for errors,
        // with the error message in the response body. We need to check for this.
        const responseData = response.data;

        if (responseData['Error Message']) {
            console.error('Alpha Vantage API Error:', responseData['Error Message']);
            // We will throw an error here so it can be caught by the handleApiError utility
            throw new Error(`API Error: ${responseData['Error Message']}`);
        }

        if (responseData['Note']) {
            console.warn('Alpha Vantage API Rate Limit Note:', responseData['Note']);
            // Throw a specific error for rate limiting that can be handled downstream
            throw new Error(`RATE_LIMIT: ${responseData['Note']}`);
        }

        return responseData;
    } catch (error: any) {
        // Log the detailed error and re-throw it to be handled by the calling function's catch block
        console.error(`Error in fetchStockData for symbol ${params.symbol}:`, error.message);
        // Re-throw the original error to preserve stack trace and allow for specific handling
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