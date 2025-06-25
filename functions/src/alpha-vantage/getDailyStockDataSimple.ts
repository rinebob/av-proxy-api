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
  AlphaVantageDailyTimeSeriesResponse
} from '../common/common-av';
import { 
  transformAlphaVantageResponse,
  saveStockData, 
  getStockData
} from './av-firestore-helpers';

export const getDailyStockDataSimple = onRequest(
  { 
    secrets: ['ALPHAVANTAGE_API_KEY'],
    memory: '256MiB',
    cors: true, // Enable CORS for this function
  }, 
  async (req, res) => {
        console.info('----------- getDailyStockDataSimple ---------------');
        
    try {
      // Step 1: Authenticate the request
      const decodedToken = await authenticateRequest(req, res);
      if (!decodedToken) {
        return; // Authentication failed, response already sent.
      }

      // Step 2: Validate specific parameters for this function
      const { symbol, outputsize } = req.query;
      if (!symbol || typeof symbol !== 'string') {
        res.status(400).json({ error: 'Bad Request', message: 'Symbol is required' });
        return;
      }

      // Get the API key
      const apiKey = getAlphaVantageApiKey();

      // Check cache first
      const cachedData = await getStockData(symbol, AlphaVantageFunctionName.GET_DAILY_STOCK_DATA_SIMPLE);
      if (cachedData) {
        console.info(`[${symbol}] CACHE HIT`);
        res.status(200).json(cachedData);
        return;
      }

      // If not in cache, fetch from Alpha Vantage
      console.info(`[${symbol}] CACHE MISS - Fetching from Alpha Vantage`);
      const response = await fetchStockData({
        function: AlphaVantageFunction.TIME_SERIES_DAILY,
        symbol: symbol,
        outputsize: outputsize
      }, apiKey);

      // Check if the response is a daily time series response
      if (!('Meta Data' in response) || !('Time Series (Daily)' in response)) {
        throw new Error('Unexpected response format from Alpha Vantage API');
      }

      // Now we can safely cast to the correct type
      const dailyResponse = response as AlphaVantageDailyTimeSeriesResponse;

      // Transform and cache the response
      const transformedData = transformAlphaVantageResponse(dailyResponse);
      await saveStockData(symbol, transformedData, AlphaVantageFunctionName.GET_DAILY_STOCK_DATA_SIMPLE);

      // Send the response
      res.status(200).json(transformedData);
    } catch (error) {
      console.error('Error in getDailyStockDataSimple:', error);
      handleApiError(error, res, AlphaVantageFunctionName.GET_DAILY_STOCK_DATA_SIMPLE);
    }
  }
);