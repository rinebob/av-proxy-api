import { onRequest } from 'firebase-functions/v2/https';
import { 
    setCorsHeaders, 
    handleOptionsRequest,
    fetchStockData,
    firebaseAdmin,
    handleApiError,
    validateAndAuthenticateRequest
} from './utils';
import { 
    CloudFunctionName,
    AlphaVantageFunction
} from './common-fn';
import { 
    transformAlphaVantageResponse,
    saveStockData 
} from './firestore-helpers';

// Initialize Firebase Admin if not already initialized
if (!firebaseAdmin.apps.length) {
    firebaseAdmin.initializeApp();
}

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

            // Make API call to get daily data and save to Firestore
            const dailyResponse = await fetchStockData(
                AlphaVantageFunction.TIME_SERIES_DAILY,
                params.symbol,
                apiKey,
                { outputsize: params.outputSize }
            );

            // Check if the Alpha Vantage API returned an error
            if (dailyResponse['Error Message'] || dailyResponse['Note']) {
                console.error('Alpha Vantage API returned an error:', dailyResponse);
                res.status(400).json({ 
                    message: 'Failed to fetch data from Alpha Vantage. The symbol may be invalid or the API limit reached.',
                    error: dailyResponse['Error Message'] || dailyResponse['Note'] 
                });
                return;
            }
            
            console.log(`gDSDS Fetching data with outputsize: ${params.outputSize}`);
            
            // Transform the Alpha Vantage response to our format
            const transformedData = transformAlphaVantageResponse(dailyResponse);
            
            // Save the transformed data to Firestore
            await saveStockData(params.symbol, transformedData);

            // Log the final output for debugging
            // console.log('Final output data:', JSON.stringify(dailyData, null, 2));
            const timeSeries = transformedData.timeSeriesDaily;
            const firstEntry = timeSeries ? Object.entries(timeSeries)[0] : 'No data';
            console.log('gDSDS First daily data entry:', firstEntry);

            console.log('gDSDS RUNNING LOCAL VERSION - ' + new Date().toISOString());
            
            // Respond with the transformed data
            res.status(200).json(transformedData);
            return;

            } catch (error: any) {
                // Use the utility function to handle the error
                handleApiError(error, res, 'gDSDS');
        }
    }
);
