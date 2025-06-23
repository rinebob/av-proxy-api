import { onRequest } from 'firebase-functions/v2/https';
import { 
    setCorsHeaders, 
    handleOptionsRequest,
    fetchStockData,
    handleApiError,
    validateAndAuthenticateRequest
} from '../utils.js';
import { 
    CloudFunctionName,
    AlphaVantageFunction
} from '../common/common-fn.js';
import { 
    transformAlphaVantageResponse,
    saveStockData, 
    getStockData
} from './av-firestore-helpers.js';

export const getDailyStockDataSimple = onRequest(
    { 
        secrets: ['ALPHAVANTAGE_API_KEY'],
        memory: '256MiB'
    }, 
    async (req, res) => {
        console.info('----------- getDailyStockDataSimple ---------------');
        
        // Handle CORS and OPTIONS
        setCorsHeaders(res);
        if (handleOptionsRequest(req as any, res as any)) return;

        try {
            // Validate and authenticate the request
            const validation = await validateAndAuthenticateRequest(
                req,
                res,
                CloudFunctionName.GET_DAILY_STOCK_DATA_SIMPLE
            );
            if (!validation) return;
            
            const { params, apiKey } = validation;

            // TEMPORARY LOG: Securely log the end of the API key to verify the secret
            console.log(`gDSDS Using API Key ending in: ${apiKey.slice(-4)}`);

            // Check cache first
            const cachedData = await getStockData(params.symbol, CloudFunctionName.GET_DAILY_STOCK_DATA_SIMPLE);
            if (cachedData) {
                console.info(`[${params.symbol}] CACHE HIT`);
                res.status(200).send(cachedData);
                return;
            }

            // Create the correctly-typed parameters object for the API call
            const apiParams: { [key: string]: string } = {
                function: AlphaVantageFunction.TIME_SERIES_DAILY,
                symbol: params.symbol,
                outputsize: params.outputSize
            };

            // Make API call to get daily data and save to Firestore
            const dailyResponse = await fetchStockData(apiParams, apiKey);

            // Check if the Alpha Vantage API returned an error
            if (dailyResponse['Error Message'] || dailyResponse['Note']) {
                console.error('Alpha Vantage API returned an error:', dailyResponse);
                res.status(400).json({ 
                    message: 'Failed to fetch data from Alpha Vantage. The symbol may be invalid or the API limit reached.',
                    error: dailyResponse['Error Message'] || dailyResponse['Note'] 
                });
                return;
            }
            
            // Type guard to ensure we have the correct response shape before transforming.
            if (!('Time Series (Daily)' in dailyResponse)) {
                console.error('Invalid response shape for daily time series:', dailyResponse);
                throw new Error('Received an invalid data structure from Alpha Vantage for a daily time series request.');
            }

            console.log(`gDSDS Fetching data with outputsize: ${params.outputSize}`);
            
            // Transform the Alpha Vantage response to our format
            const transformedData = transformAlphaVantageResponse(dailyResponse);
            
            // Save the transformed data to Firestore
            await saveStockData(params.symbol, transformedData, CloudFunctionName.GET_DAILY_STOCK_DATA_SIMPLE);

            // Log the final output for debugging
            const timeSeries = transformedData.timeSeriesDaily;
            const firstEntry = timeSeries ? Object.entries(timeSeries)[0] : 'No data';
            console.log('gDSDS First daily data entry:', firstEntry);

            console.log('gDSDS RUNNING LOCAL VERSION - ' + new Date().toISOString());
            
            // Respond with the transformed data
            res.status(200).send(transformedData);
            return;

            } catch (error: any) {
                // Use the utility function to handle the error
                handleApiError(error, res, 'gDSDS');
        }
    }
);