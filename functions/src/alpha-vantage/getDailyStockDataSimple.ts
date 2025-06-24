import { onRequest } from 'firebase-functions/v2/https';
import { 
    setCorsHeaders, 
    handleOptionsRequest,
    fetchStockData,
    handleApiError,
    validateAndAuthenticateRequest
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
    }, 
    async (req, res) => {
        console.info('----------- getDailyStockDataSimple ---------------');
        
        // Handle preflight requests first
        if (handleOptionsRequest(req, res)) {
            return; // End the request if it was an OPTIONS request
        }

        // Set CORS headers for the actual request
        setCorsHeaders(req, res);
        
        try {
            // Validate and authenticate the request
            const validation = await validateAndAuthenticateRequest(
                req,
                res,
                AlphaVantageFunctionName.GET_DAILY_STOCK_DATA_SIMPLE
            );
            
            if (!validation) {
                console.error('Validation failed');
                return;
            }
            
            const { params, apiKey } = validation;

            // TEMPORARY LOG: Securely log the end of the API key to verify the secret
            console.log(`gDSDS Using API Key ending in: ${apiKey.slice(-4)}`);

            // Check cache first
            const cachedData = await getStockData(params.symbol, AlphaVantageFunctionName.GET_DAILY_STOCK_DATA_SIMPLE);
            if (cachedData) {
                console.info(`[${params.symbol}] CACHE HIT`);
                res.status(200).json(cachedData);
                return;
            }

            // If not in cache, fetch from Alpha Vantage
            console.info(`[${params.symbol}] CACHE MISS - Fetching from Alpha Vantage`);
            const response = await fetchStockData({
                function: AlphaVantageFunction.TIME_SERIES_DAILY,
                symbol: params.symbol,
                outputsize: 'compact'
            }, apiKey);

            // Check if the response is a daily time series response
            if (!('Meta Data' in response) || !('Time Series (Daily)' in response)) {
                throw new Error('Unexpected response format from Alpha Vantage API');
            }

            // Now we can safely cast to the correct type
            const dailyResponse = response as AlphaVantageDailyTimeSeriesResponse;

            // Transform and cache the response
            const transformedData = transformAlphaVantageResponse(dailyResponse);
            await saveStockData(params.symbol, transformedData, AlphaVantageFunctionName.GET_DAILY_STOCK_DATA_SIMPLE);

            // Send the response
            res.status(200).json(transformedData);
        } catch (error) {
            console.error('Error in getDailyStockDataSimple:', error);
            handleApiError(error, res, 'getDailyStockDataSimple');
        }
    }
);