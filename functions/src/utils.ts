import axios from 'axios';
import {
 defineString
} from "firebase-functions/params";
import * as dotenv from 'dotenv';

// Load environment variables from .env during local development
// This will not run in the deployed Firebase Function environment
if (process.env['NODE_ENV'] !== 'production') {
  dotenv.config(); // Access using bracket notation
}

export const ALPHAVANTAGE_BASE_URL = 'https://www.alphavantage.co/query';
export const CACHE_DURATION_MS = 1000 * 60 * 30; // Cache for 30 minutes

export const RATE_LIMIT_WINDOW_MS = 1000 * 60; // 1 minute
export const MAX_REQUESTS_PER_WINDOW = 10; // Max 10 requests per minute



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


// Define the configuration key for Firebase Environment Configuration
const alphavantageKey = defineString('ALPHAVANTAGE_KEY');

// Function to get the Alphavantage API key, handling both local and deployed environments
export function getAlphavantageApiKey(): string | undefined {
  // In the deployed environment, use Firebase Environment Configuration
  if (process.env['K_SERVICE']) { // K_SERVICE is an environment variable set in Cloud Run/Functions
    return alphavantageKey.value(); // Access using bracket notation
  }
  // In the local development environment, use process.env
  return process.env['ALPHAVANTAGE_API_KEY']; // Access using bracket notation
}

/**
 * Fetches daily stock data from the Alphavantage API.
 * @param symbol The stock symbol.
 * @param apiKey The Alphavantage API key.
 * @returns A Promise resolving with the API response data.
 * @throws An error if the API call fails.
 */
export async function fetchStockData(symbol: string, apiKey: string): Promise<any> {
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