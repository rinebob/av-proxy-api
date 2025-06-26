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
          console.info(`gDSDS [${symbol}] CACHE HIT`);
          res.status(200).json(cachedData);
          return;
        }

        // Fetch from API
        console.info(`gDSDS [${symbol}] CACHE MISS - Fetching from Alpha Vantage`);
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

        // Fallback: if the response is missing expected fields, treat as symbol not found or unsupported
        if (!('Meta Data' in response) || !('Time Series (Daily)' in response)) {
          console.warn(`gDSDS [${symbol}] Not found or unsupported by Alpha Vantage. Response:`, response);
          res.status(404).json({
            error: 'Symbol Not Found',
            message: `Symbol '${symbol}' not found or not supported by Alpha Vantage.`,
            details: response
          });
          return;
        }

        // Check if the response contains any data (type-safe)
        const daily = response['Time Series (Daily)'];
        if (!daily || Object.keys(daily).length === 0) {
          console.info(`gDSDS [${symbol}] No data found for symbol.`);
          res.status(404).json({
            error: 'No Data Found',
            message: `No data found for symbol '${symbol}'.`,
            details: response
          });
          return;
        }

        // Transform and save
        const transformedData = transformAlphaVantageResponse(response);
        try {
          console.info(`gDSDS [${symbol}] Attempting to save data to Firestore...`);
          await saveStockData(symbol, transformedData, AlphaVantageFunctionName.GET_DAILY_STOCK_DATA_SIMPLE);
          console.info(`gDSDS [${symbol}] Data saved to Firestore successfully.`);
        } catch (error) {
          // Log cache save error but do NOT block the response to the user
          console.error(`gDSDS [Dude! oh no! Error saving stock data for ${symbol}:`, error);
          console.error('Firestore set() error details:', JSON.stringify(error, Object.getOwnPropertyNames(error)));
          res.set('X-Cache-Save-Error', 'true');
          res.status(200).json(transformedData);
          return;
        }

        res.status(200).json(transformedData);

      } catch (error) {
        handleApiError(error, res, `gDSDS getDailyStockDataSimple for ${symbol}`);
      }
    } catch (error) {
      console.info(`handle api error block`);
      console.error('Error in gDSDS getDailyStockDataSimple:', error);
      handleApiError(error, res, AlphaVantageFunctionName.GET_DAILY_STOCK_DATA_SIMPLE);
    }
  }
);