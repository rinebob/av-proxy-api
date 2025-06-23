// functions/src/alpha-vantage/getGlobalQuote.ts
import { onRequest } from 'firebase-functions/v2/https';
import {
  setCorsHeaders,
  handleOptionsRequest,
  fetchStockData,
  validateAndAuthenticateRequest,
} from '../utils.js';
import {
  CloudFunctionName,
  AlphaVantageGlobalQuoteResponse,
  AlphaVantageFunction,
} from '../common/common-fn.js';
import { saveStockData, getStockData } from './av-firestore-helpers.js';

export const getGlobalQuote = onRequest(
  {
    secrets: ['ALPHAVANTAGE_API_KEY'],
    cors: true,
  },
  async (req, res) => {
    console.info('----------- getGlobalQuote ---------------');

    // Handle CORS and OPTIONS
    setCorsHeaders(res);
    if (handleOptionsRequest(req as any, res as any)) return;

    try {
      // Validate and authenticate the request
      const validation = await validateAndAuthenticateRequest(
        req,
        res,
        CloudFunctionName.GET_GLOBAL_QUOTE
      );
      if (!validation) return; // Stop if validation fails

      const { params, apiKey } = validation;

      // TEMPORARY LOG: Securely log the end of the API key to verify the secret
      console.log(`gGQ Using API Key ending in: ${apiKey.slice(-4)}`);

      // Check cache first
      const cachedData = await getStockData(params.symbol, CloudFunctionName.GET_GLOBAL_QUOTE);
      if (cachedData) {
        console.info(`[${params.symbol}] CACHE HIT`);
        res.status(200).send(cachedData);
        return;
      }
      console.info(`[${params.symbol}] CACHE MISS`);

      // Create the correctly-typed parameters object for the API call
      const apiParams: { [key: string]: string } = {
        function: AlphaVantageFunction.GLOBAL_QUOTE,
        symbol: params.symbol
      };

      // Fetch from Alpha Vantage API
      const apiResponse = await fetchStockData(apiParams, apiKey) as AlphaVantageGlobalQuoteResponse;

      // Error handling for API response
      if (apiResponse["Error Message"] || apiResponse["Note"]) {
        const errorMessage = apiResponse["Error Message"] || apiResponse["Note"];
        console.error(`Alpha Vantage API Error for ${params.symbol}: ${errorMessage}`);
        res.status(500).send({ message: `Failed to fetch data: ${errorMessage}` });
        return;
      }

      // The API returns a single 'Global Quote' object. We need to check if it's empty.
      if (!apiResponse || !apiResponse['Global Quote'] || Object.keys(apiResponse['Global Quote']).length === 0) {
        console.error('Global Quote data is missing from the API response.');
        res.status(500).send({ message: 'Global Quote data is missing from the API response.' });
        return;
      }

      const globalQuote = apiResponse["Global Quote"];

      // Save to Firestore and send response
      await saveStockData(params.symbol, globalQuote, CloudFunctionName.GET_GLOBAL_QUOTE);
      res.status(200).send(globalQuote);
    } catch (error) {
      console.error('Error in getGlobalQuote:', error);
      res.status(500).send({ message: 'An unexpected error occurred.' });
    }
  }
);
