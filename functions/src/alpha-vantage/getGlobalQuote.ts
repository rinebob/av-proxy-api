// functions/src/alpha-vantage/getGlobalQuote.ts
import { onRequest } from 'firebase-functions/v2/https';
import { 
  getAlphaVantageApiKey, 
  fetchStockData, 
  handleApiError,
  authenticateRequest,
} from '../utils/utils';

import { 
  AlphaVantageFunctionName,
} from '../common/common-fn';

import { 
  saveStockData, 
  getStockData 
} from './av-firestore-helpers';
import { AlphaVantageGlobalQuoteResponse } from '../common/common-av';

export const getGlobalQuote = onRequest(
  {
    secrets: ['ALPHAVANTAGE_API_KEY'],
    cors: true,
  },
  async (req, res) => {
    // Force redeploy to include updated helper functions. v2
    console.info('----------- getGlobalQuote ---------------');

    try {
      // DEBUG: Log the query params received
      console.info('gGQ req.query:', req.query);
      // Step 1: Authenticate the request
      const decodedToken = await authenticateRequest(req, res);
      if (!decodedToken) {
        return; // Authentication failed, response already sent.
      }

      // Step 2: Validate specific parameters for this function
      const { symbol } = req.query;
      if (!symbol || typeof symbol !== 'string') {
        res.status(400).json({ error: 'Bad Request', message: 'Symbol is required' });
        return;
      }

      // Get the API key
      const apiKey = getAlphaVantageApiKey();

      // TEMPORARY LOG: Securely log the end of the API key to verify the secret
      console.log(`gGQ Using API Key ending in: ${apiKey.slice(-4)}`);

      // Check cache first
      const cachedData = await getStockData(symbol, AlphaVantageFunctionName.GET_GLOBAL_QUOTE);
      if (cachedData) {
        console.info(`[${symbol}] CACHE HIT`);
        res.status(200).send(cachedData);
        return;
      }
      console.info(`[${symbol}] CACHE MISS`);

      // Create the correctly-typed parameters object for the API call
      const apiParams: { [key: string]: string } = {
        function: AlphaVantageFunctionName.GET_GLOBAL_QUOTE,
        symbol: symbol
      };

      // Fetch from Alpha Vantage API
      const apiResponse = await fetchStockData(apiParams, apiKey) as AlphaVantageGlobalQuoteResponse;

      // Always log the full Alpha Vantage response for debugging
      console.info(`[${symbol}] Alpha Vantage API raw response:`, JSON.stringify(apiResponse));

      // If AV returns an error or notice, or if Global Quote is missing/empty, pass through the raw response to the frontend
      if (
        apiResponse["Error Message"] ||
        apiResponse["Note"] ||
        !apiResponse ||
        !apiResponse['Global Quote'] ||
        Object.keys(apiResponse['Global Quote']).length === 0
      ) {
        // Log for backend visibility
        console.warn(`[${symbol}] Passing through raw AV response due to missing/invalid data.`);
        res.status(200).json(apiResponse);
        return;
      }

      const globalQuote = apiResponse["Global Quote"];

      // Save to Firestore, but do not block response on failure
      try {
        await saveStockData(symbol, globalQuote, AlphaVantageFunctionName.GET_GLOBAL_QUOTE);
      } catch (firestoreError) {
        console.error(`Firestore write failed for ${symbol}:`, firestoreError);
        // Do not throw, just log
      }
      res.status(200).send(globalQuote);
    } catch (error) {
      // Only handle true validation or API/AlphaVantage errors here
      console.error(`Error in ${AlphaVantageFunctionName.GET_GLOBAL_QUOTE}:`, error);
      handleApiError(error, res, AlphaVantageFunctionName.GET_GLOBAL_QUOTE);
    }
  }
);
