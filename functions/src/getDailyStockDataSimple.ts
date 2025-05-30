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
    saveDailyStockData 
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

            // Make API call to get daily data and save to Firestore
            const dailyResponse = await fetchStockData(
                AlphaVantageFunction.TIME_SERIES_DAILY,
                params.symbol,
                apiKey,
                { outputsize: params.outputSize }
            );
            
            console.log(`Fetching data with outputsize: ${params.outputSize}`);
            
            // Transform the Alpha Vantage response to our format
            const transformedData = transformAlphaVantageResponse(dailyResponse.data);
            
            // Save the transformed data to Firestore and get the result
            const dailyData = await saveDailyStockData(params.symbol, transformedData);

            // Log the final output for debugging
            // console.log('Final output data:', JSON.stringify(dailyData, null, 2));
            const timeSeries = dailyData.timeSeriesDaily;
            const firstEntry = timeSeries ? Object.entries(timeSeries)[0] : 'No data';
            console.log('gDSDS First daily data entry:', firstEntry);

            console.log('gDSDS RUNNING LOCAL VERSION - ' + new Date().toISOString());
            
            // Return the data (test or real)
            res.status(200).json(dailyData);
            return;

            } catch (error: any) {
                // Use the utility function to handle the error
                handleApiError(error, res, 'gDSDS');
        }
    }
);
