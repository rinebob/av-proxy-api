import axios from 'axios';
import { defineSecret } from "firebase-functions/params";
import * as logger from "firebase-functions/logger";
import * as dotenv from 'dotenv';
import { ALPHAVANTAGE_BASE_URL, AlphaVantageFunction } from './common-fn';

/** Define the Alpha Vantage API key as a Firebase Function parameter
* The key 'ALPHAVANTAGE_API_KEY' is what you'll see in the .env.<project-id> file
and what you'd set in the Google Cloud Console if managing directly.
The CLI command `firebase functions:config:set alphavantage.key="YOUR_KEY"`
actually creates an entry that defineString can pick up if the key name matches.
Let's use a clear name for the parameter.
*/
export const alphaVantageApiKeyParam = defineSecret("ALPHAVANTAGE_API_KEY"); 
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
  const key = alphaVantageApiKeyParam.value(); // Access the value of the defined parameter
  if (!key) {
    logger.error(
      "Alpha Vantage API key (ALPHAVANTAGE_API_KEY) not found in Firebase Functions configuration (Secret Manager). " +
      "Ensure it's set via 'firebase functions:secrets:set ALPHAVANTAGE_API_KEY' and that the function has permissions to access it."
    );
    // Throw an error to make it clear the function cannot proceed
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