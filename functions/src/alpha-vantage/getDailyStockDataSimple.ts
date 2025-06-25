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
  OutputSize
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
      // Force redeploy to include updated helper functions. v2
      console.info('----------- getDailyStockDataSimple ---------------');
        
    try {
      // Step 1: Authenticate the request
      const decodedToken = await authenticateRequest(req, res);
      if (!decodedToken) return;

      // Step 2: Validate specific parameters for this function
      const { symbol, outputsize } = req.query;

      if (!symbol || typeof symbol !== 'string') {
        res.status(400).json({ error: 'Bad Request', message: 'Symbol is required' });
        return;
      }

      try {
        const apiKey = getAlphaVantageApiKey();

        // Check cache first
        const cachedData = await getStockData(symbol, AlphaVantageFunctionName.GET_DAILY_STOCK_DATA_SIMPLE);
        if (cachedData) {
          console.info(`[${symbol}] CACHE HIT`);
          res.status(200).json(cachedData);
          return;
        }

        // Fetch from API
        console.info(`[${symbol}] CACHE MISS - Fetching from Alpha Vantage`);
        const response = await fetchStockData({
          function: AlphaVantageFunction.TIME_SERIES_DAILY,
          symbol: symbol,
          outputsize: (outputsize as string) || OutputSize.COMPACT
        }, apiKey);

        // Check for an API limit error or other informational message before transforming
        if (response.Note || response.Information) {
          // Throw a custom error that our handler will understand
          const error = new Error('Alpha Vantage API Notice');
          (error as any).response = { data: response };
          throw error;
        }

        // Fallback check if the response is not a recognized error but still malformed
        if (!('Meta Data' in response) || !('Time Series (Daily)' in response)) {
          console.error('Unexpected response format from Alpha Vantage API:', response);
          throw new Error('Unexpected response format from Alpha Vantage API');
        }

        // Transform and save
        const transformedData = transformAlphaVantageResponse(response);
        await saveStockData(symbol, transformedData, AlphaVantageFunctionName.GET_DAILY_STOCK_DATA_SIMPLE);

        res.status(200).json(transformedData);

      } catch (error) {
        handleApiError(error, res, `getDailyStockDataSimple for ${symbol}`);
      }
    } catch (error) {
      console.error('Error in getDailyStockDataSimple:', error);
      handleApiError(error, res, AlphaVantageFunctionName.GET_DAILY_STOCK_DATA_SIMPLE);
    }
  }
);