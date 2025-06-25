// functions/src/alpha-vantage/getGlobalQuote.ts
import { onRequest } from 'firebase-functions/v2/https';
import { 
  getAlphaVantageApiKey, 
  fetchStockData, 
  handleApiError,
  authenticateRequest
} from '../utils';
import { 
  AlphaVantageFunctionName
} from '../common/common-fn';
import { 
  AlphaVantageFunction,
  AlphaVantageGlobalQuoteResponse,
} from '../common/common-av';
import { 
  saveStockData, 
  getStockData 
} from './av-firestore-helpers';

export const getGlobalQuote = onRequest(
  {
    secrets: ['ALPHAVANTAGE_API_KEY'],
    cors: true,
  },
  async (req, res) => {
    console.info('----------- getGlobalQuote ---------------');

    try {
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
        function: AlphaVantageFunction.GLOBAL_QUOTE,
        symbol: symbol
      };

      // Fetch from Alpha Vantage API
      const apiResponse = await fetchStockData(apiParams, apiKey) as AlphaVantageGlobalQuoteResponse;

      // Error handling for API response
      if (apiResponse["Error Message"] || apiResponse["Note"]) {
        const errorMessage = apiResponse["Error Message"] || apiResponse["Note"];
        console.error(`Alpha Vantage API Error for ${symbol}: ${errorMessage}`);
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
      await saveStockData(symbol, globalQuote, AlphaVantageFunctionName.GET_GLOBAL_QUOTE);
      res.status(200).send(globalQuote);
    } catch (error) {
      console.error(`Error in ${AlphaVantageFunctionName.GET_GLOBAL_QUOTE}:`, error);
      handleApiError(error, res, AlphaVantageFunctionName.GET_GLOBAL_QUOTE);
    }
  }
);
