// functions/src/getDailyStockDataSimple.ts

import { onRequest } from "firebase-functions/v2/https";
import { alphaVantageApiKeyParam } from './utils';

import {
    setCorsHeaders,
    handleOptionsRequest,
    getAlphaVantageApiKey,
    fetchStockData, // Assuming fetchStockData is a helper that makes the HTTP request
} from './utils'; // Import helper functions from utils.ts

// Import all necessary types, enum, and constants from common-fn.ts
import {
    AlphaVantageDailyTimeSeriesResponse, // Import the overall response interface
    TimeSeriesMetaData, // Import metadata interface
    DailyTimeSeries, // Import time series data interface
    AlphaVantageFunction, // Import the enum
} from './common-fn';


export const getDailyStockDataSimple = onRequest(
    { secrets: [alphaVantageApiKeyParam] }, 
    async (req, res) => {
    setCorsHeaders(res);

    // Use console instead of logger
    console.info('gDSDS simple calling handleOptionsRequest. query: ', req.query);
    if (handleOptionsRequest(req as any, res as any)) {
        return;
    }
    // Use console instead of logger
    console.info('gDSDS simple after calling handleOptionsRequest');

    // Ensure it's a GET request
    if (req.method !== 'GET') {
        // Use console instead of logger
        console.warn('gDSDS simple received non-GET request:', req.method);
        res.status(405).json({ error: 'Method Not Allowed. Please send a GET request.' });
        return;
    }

    // Get the symbol from the query parameters
    const tickerSymbol = req.query.symbol as string;

    if (!tickerSymbol) {
        // Use console instead of logger
        console.error('gDSDS simple Symbol parameter is missing');
        res.status(400).json({ error: 'Dude - symbol parameter is required' });
        return;
    }

    // Get API key using helper function
    const apiKey = getAlphaVantageApiKey();

    if (!apiKey) {
        res.status(500).json({ error: 'Dude wtf? Alpha Vantage API key not configured.' });
        return;
    }

    try {
        // Call fetchStockData with the specific AlphaVantageFunction enum member
        // Use console instead of logger inside fetchStockData as well if you want consistent logging
        const response = await fetchStockData(AlphaVantageFunction.TIME_SERIES_DAILY, tickerSymbol, apiKey);

        // Use console instead of logger
        console.info('gDSDS simple fetchStockData resp status:', response.status);
        // Use console instead of logger - avoid logging large response data in production
        // console.info('gDSDS simple fetchStockData resp data:', response.data);

        // Cast the response data to the expected time series type for type-safe access
        const apiResponseData: AlphaVantageDailyTimeSeriesResponse = response.data;

        if (response.status === 200) {
            // Use the imported types TimeSeriesMetaData and DailyTimeSeries for accessing data
            const metaData: TimeSeriesMetaData | undefined = apiResponseData["Meta Data"];
            const dailyTimeSeries: DailyTimeSeries | undefined = apiResponseData["Time Series (Daily)"] || apiResponseData["Time Series (Daily - Adjusted)"];


            // Check for the presence of either Daily or Adjusted Time Series data and Meta Data
            if (metaData && dailyTimeSeries) {
                 // Use console instead of logger
                 console.info('gDSDS simple successfully fetched time series data');
                 // You can optionally log specific parts using the types
                 // console.info('gDSDS simple symbol from metadata:', metaData["2. Symbol"]);
                 // console.info('gDSDS simple latest trading day data:', dailyTimeSeries[metaData["3. Last Refreshed"]]);

                 // Return the entire response data as it contains both Meta Data and Time Series
                 res.status(200).json(apiResponseData);

            } else if (apiResponseData.Information) {
                // Handle API-specific error messages from the 'Information' field
                // Use console instead of logger
                console.warn('gDSDS simple API returned information/error:', apiResponseData.Information);
                res.status(500).json({ error: `API Error: ${apiResponseData.Information}` });

            } else if (apiResponseData.Note) {
                 // Handle API rate limit messages from the 'Note' field
                 // Use console instead of logger
                 console.warn('gDSDS simple API returned note:', apiResponseData.Note);
                 res.status(429).json({ error: `API Rate Limit Exceeded: ${apiResponseData.Note}` });

            } else {
                // Handle unexpected data formats
                // Use console instead of logger
                console.warn('gDSDS simple Received unexpected data format:', apiResponseData);
                res.status(500).json({ error: 'Dude - Failed to fetch stock data due to unexpected API response format.' });
            }

        } else {
            // Handle non-200 HTTP status codes from the API
            // Use console instead of logger
            console.error(`gDSDS simple API returned non-200 status: ${response.status} - ${response.statusText}`);
            res.status(response.status).json({ error: `Dude - API error: ${response.statusText}` });
        }

    } catch (error: any) {
        // Use console instead of logger
        console.error('gDSDS simple Error fetching stock data:', error);
        // More robust error handling based on axios error structure (assuming fetchStockData uses axios or returns similar structure)
        if (error.response?.status) {
            // Error response received from the API
            // Use console instead of logger
            console.error(`gDSDS simple HTTP Error Response: ${error.response.status} - ${error.response.statusText}`);
            // Attempt to cast error data to see if it contains AV error info
            const apiErrorData = error.response.data as AlphaVantageDailyTimeSeriesResponse | undefined;
             if (apiErrorData?.Information) {
                 res.status(error.response.status).json({ error: `API Error: ${apiErrorData.Information}` });
            } else {
                 res.status(error.response.status).json({ error: `HTTP error: ${error.response.status} - ${error.response.statusText}` });
            }

        } else if (error.request) {
            // The request was made but no response was received
            // Use console instead of logger
            console.error('gDSDS simple Request Error: No response received', error.message);
            res.status(500).json({ error: 'Request error: No response from API.' });
        } else {
            // Something happened in setting up the request
            // Use console instead of logger
            console.error('gDSDS simple General Request Setup Error:', error.message);
            res.status(500).json({ error: `Oh no Failed to fetch stock data: ${error.message}` });
        }
    }
});
