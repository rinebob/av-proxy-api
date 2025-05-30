// functions/src/getGlobalQuote.ts

import { onRequest } from "firebase-functions/v2/https";
import axios from 'axios';
import { alphaVantageApiKeyParam } from './utils';


import {
    setCorsHeaders,
    handleOptionsRequest,
    getAlphaVantageApiKey,
    authenticateFirebaseUser // Import the new utility function
} from './utils'; 

import {
    GlobalQuoteData,
    AlphaVantageGlobalQuoteResponse,
    AlphaVantageFunction,
    ALPHAVANTAGE_BASE_URL,
    CloudFunctionName
} from './common-fn';

export const getGlobalQuote = onRequest(
    { 
      secrets: [alphaVantageApiKeyParam],
      memory: '256MiB'
    }, 
    async (req, res) => {
    console.info('----------- gGQ getGlobalQuote ---------------');
    console.info('gGQ get global quote for: ', req.query.symbol);
    setCorsHeaders(res);

    console.info('gGQ calling handleOptionsRequest. query: ', req.query);
    if (handleOptionsRequest(req as any, res as any)) {
        return;
    }
    console.info('gGQ after calling handleOptionsRequest');

    // --- Firebase ID Token Authentication using utility function ---
    const decodedToken = await authenticateFirebaseUser(
      req, 
      res, 
      CloudFunctionName.GET_GLOBAL_QUOTE
    );
    if (!decodedToken) {
        // authenticateFirebaseUser already sent the response, so just return
        return;
    }
    // const uid = decodedToken.uid; // uid is available if needed for further logic
    // --- End Firebase ID Token Authentication ---

    if (req.method !== 'GET') {
        console.warn('gGQ received non-GET request:', req.method);
        res.status(405).json({ error: 'Method Not Allowed. Please send a GET request.' });
        return;
    }

    const apiKey = getAlphaVantageApiKey();
    if (!apiKey) {
        console.error('gGQ Alphavantage API key is not configured.');
        res.status(500).json({ error: 'Alphavantage API key is not configured.' });
        return;
    }

    const symbol = req.query.symbol as string;

    console.info('gGQ received symbol:', symbol);
    if (!symbol) {
        console.error('gGQ Symbol parameter is missing in query string');
        res.status(400).json({ error: 'symbol parameter is required in the query string.' });
        return;
    }

    const apiUrl = `${ALPHAVANTAGE_BASE_URL}?function=${AlphaVantageFunction.GLOBAL_QUOTE}&symbol=${symbol}&apikey=${apiKey}`;

    try {
        console.info(`gGQ Fetching global quote for symbol: ${symbol}`);
        const response = await axios.get<AlphaVantageGlobalQuoteResponse>(apiUrl);

        console.info(`gGQ Response status for ${symbol}: ${response.status}`);

        if (response.status === 200) {
            const globalQuoteData: GlobalQuoteData | undefined = response.data['Global Quote'];

            if (globalQuoteData && Object.keys(globalQuoteData).length > 0) {
                res.status(200).json(globalQuoteData);
            } else if (response.data.Information) {
                console.warn(`gGQ API returned information/error for ${symbol}: ${response.data.Information}`);
                res.status(500).json({ error: `API Error: ${response.data.Information}` });
            } else if (response.data.Note) {
                console.warn(`gGQ API returned note for ${symbol}: ${response.data.Note}`);
                 res.status(429).json({ error: `API Rate Limit Exceeded: ${response.data.Note}` });
            }
            else {
                console.warn(`gGQ Received unexpected data format for ${symbol}:`, response.data);
                res.status(500).json({ error: 'Unexpected API response format.' });
            }
        } else {
            console.error(`gGQ API returned non-200 status for ${symbol}: ${response.status} - ${response.statusText}`);
            res.status(response.status).json({ error: `API error: ${response.statusText}` });
        }

    } catch (error: any) {
        console.error(`gGQ Error fetching global quote for ${symbol}:`, error);

        if (error.response?.status) {
            console.error(`gGQ HTTP Error Response for ${symbol}: ${error.response.status} - ${error.response.statusText}`);
            const apiErrorData = error.response.data as AlphaVantageGlobalQuoteResponse | undefined;
            if (apiErrorData?.Information) {
                 res.status(error.response.status).json({ error: `API Error: ${apiErrorData.Information}` });
            } else {
                 res.status(error.response.status).json({ error: `HTTP error: ${error.response.status} - ${error.response.statusText}` });
            }

        } else if (error.request) {
            console.error(`gGQ Request Error for ${symbol}: No response received`, error.message);
            res.status(500).json({ error: 'Request error: No response from API.' });
        } else {
            console.error(`gGQ General Request Setup Error for ${symbol}:`, error.message);
            res.status(500).json({ error: `An unexpected error occurred: ${error.message}` });
        }
    }
});
