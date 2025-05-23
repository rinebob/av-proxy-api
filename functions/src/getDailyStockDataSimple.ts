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

  logger.info('gDSDS simple req.query: ', req.query);
  logger.info('gDSDS simple req.headers: ', req.headers);

  // Handle OPTIONS requests using helper function
  if (handleOptionsRequest(req as any, res as any)) { // Type casting might be needed depending on exact types
    return;
  }

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
    const stockData = await fetchStockData(tickerSymbol, apiKey);
    
    if (stockData['Error Message']) {
      res.status(400).json({ error: stockData['Error Message'] });
    } else if (!stockData['Time Series (Daily)']) {
       res.status(404).json({ error: 'No daily time series data found for this ticker.' });
    }
    else {
      res.status(200).json(stockData);
    }

  } catch (error) {
    logger.error('Error fetching stock data:', error);
    res.status(500).json({ error: 'Failed to fetch stock data.' });
  }
});