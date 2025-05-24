import { onRequest } from "firebase-functions/v2/https";
import * as logger from "firebase-functions/logger";
import {
    setCorsHeaders,
    handleOptionsRequest,
    getAlphavantageApiKey,
    fetchStockData
} from './utils'; // Import helper functions

export const getDailyStockDataSimple = onRequest(async (req, res) => {
    // Set CORS headers for all responses
    setCorsHeaders(res); // Use helper function

    // Handle OPTIONS requests using helper function
    if (handleOptionsRequest(req as any, res as any)) { // Type casting might be needed depending on exact types
        return;
    }

    logger.info('gDSDS simple req.query: ', req.query);
    logger.info('gDSDS simple req.headers: ', req.headers);

    const tickerSymbol = req.query.symbol as string | undefined;
    logger.info('gDSDS simple tickerSymbol: ', tickerSymbol);

    if (!tickerSymbol) {
        res.status(400).json({ error: 'Ticker symbol is required.' });
        return;
    }

    // Get API key using helper function
    const apiKey = getAlphavantageApiKey();

    if (!apiKey) {
        res.status(500).json({ error: 'Alpha Vantage API key not configured.' });
        return;
    }

    try {
        const response = await fetchStockData(tickerSymbol, apiKey);
        console.log('gDSDS simple fetchStockData resp: ', response)
        console.log('gDSDS status/text: ', response.status, response.statusText)
        console.log('gDSDS data: ', response.data)

        if (response.status === 200 && Object.keys(response.data).includes('Meta Data')) {
            res.status(200).json(response['data']);

        } else if (response.status === 200 && Object.keys(response.data).includes('Information')) {
            res.status(500).json({ error: response.data['Information'] });

        } else {
            res.status(500).json({ error: 'Failed to fetch stock data.' });
        }

    } catch (error) {
        logger.error('Error fetching stock data:', error);
        res.status(500).json({ error: 'Failed to fetch stock data.' });
    }
});