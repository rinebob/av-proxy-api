// functions/src/getDailyStockDataSimple.ts

import { onRequest } from "firebase-functions/v2/https";
import { alphaVantageApiKeyParam } from './utils';
import {
    setCorsHeaders,
    handleOptionsRequest,
    getAlphaVantageApiKey,
    fetchStockData,
    authenticateFirebaseUser
} from './utils';

import {
    AlphaVantageDailyTimeSeriesResponse,
    TimeSeriesMetaData,
    DailyTimeSeries,
    AlphaVantageFunction,
} from './common-fn';


export const getDailyStockDataSimple = onRequest(
    { secrets: [alphaVantageApiKeyParam] }, 
    async (req, res) => {
    console.info('----------- gDSDS getDailyStockDataSimple ---------------');
    
    setCorsHeaders(res);

    console.info('gDSDS simple calling handleOptionsRequest. query: ', req.query);
    if (handleOptionsRequest(req as any, res as any)) {
        return;
    }
    console.info('gDSDS simple after calling handleOptionsRequest');

    // --- Firebase ID Token Authentication using utility function ---
    const decodedToken = await authenticateFirebaseUser(req, res, 'getDailyStockDataSimple');
    if (!decodedToken) {
        return;
    }
    // const uid = decodedToken.uid; // uid is available if needed for further logic
    // --- End Firebase ID Token Authentication ---

    if (req.method !== 'GET') {
        console.warn('gDSDS simple received non-GET request:', req.method);
        res.status(405).json({ error: 'Method Not Allowed. Please send a GET request.' });
        return;
    }

    const tickerSymbol = req.query.symbol as string;

    if (!tickerSymbol) {
        console.error('gDSDS simple Symbol parameter is missing');
        res.status(400).json({ error: 'Dude - symbol parameter is required' });
        return;
    }

    const apiKey = getAlphaVantageApiKey();

    if (!apiKey) {
        res.status(500).json({ error: 'Dude wtf? Alpha Vantage API key not configured.' });
        return;
    }

    try {
        const response = await fetchStockData(AlphaVantageFunction.TIME_SERIES_DAILY, tickerSymbol, apiKey);

        console.info('gDSDS simple fetchStockData resp status:', response.status);
        console.info('gDSDS simple fetchStockData resp data:', response.data);

        const apiResponseData: AlphaVantageDailyTimeSeriesResponse = response.data;

        if (response.status === 200) {
            const metaData: TimeSeriesMetaData | undefined = apiResponseData["Meta Data"];
            const dailyTimeSeries: DailyTimeSeries | undefined = apiResponseData["Time Series (Daily)"] || apiResponseData["Time Series (Daily - Adjusted)"];


            if (metaData && dailyTimeSeries) {
                 console.info('gDSDS simple successfully fetched time series data');
                 console.info('gDSDS simple symbol from metadata:', metaData["2. Symbol"]);
                 console.info('gDSDS simple latest trading day data:', dailyTimeSeries[metaData["3. Last Refreshed"]]);

                 res.status(200).json(apiResponseData);

            } else if (apiResponseData.Information) {
                console.warn('gDSDS simple API returned information/error:', apiResponseData.Information);
                res.status(500).json({ error: `API Error: ${apiResponseData.Information}` });

            } else if (apiResponseData.Note) {
                 console.warn('gDSDS simple API returned note:', apiResponseData.Note);
                 res.status(429).json({ error: `API Rate Limit Exceeded: ${apiResponseData.Note}` });

            } else {
                console.warn('gDSDS simple Received unexpected data format:', apiResponseData);
                res.status(500).json({ error: `Dude - Failed to fetch stock data due to unexpected API response format: ${apiResponseData}` });
            }

        } else {
            console.error(`gDSDS simple API returned non-200 status: ${response.status} - ${response.statusText}`);
            res.status(response.status).json({ error: `Dude - API error: ${response.statusText}` });
        }

    } catch (error: any) {
        console.error('gDSDS simple Error fetching stock data:', error);
        if (error.response?.status) {
            console.error(`gDSDS simple HTTP Error Response: ${error.response.status} - ${error.response.statusText}`);
            const apiErrorData = error.response.data as AlphaVantageDailyTimeSeriesResponse | undefined;
            if (apiErrorData?.Information) {
                res.status(error.response.status).json({ error: `API Error: ${apiErrorData.Information}` });
            } else {
                res.status(error.response.status).json({ 
                    error: `HTTP error: ${error.response.status} ${error.response.statusText}`
                });
            }
        } else if (error.request) {
            console.error('gDSDS simple Request Error: No response received', error.message);
            res.status(500).json({ error: `Request error: No response from API: ${error.message}` });
        } else {
            console.error('gDSDS simple General Request Setup Error:', error.message);
            res.status(500).json({ error: `Oh no Failed to fetch stock data: ${error.message}` });
        }
    }
});
