import * as functions from 'firebase-functions';
import axios from 'axios';
import { defineString } from 'firebase-functions/params';

const ALPHAVANTAGE_BASE_URL = 'https://www.alphavantage.co/query';

const alphavantageKey = defineString('ALPHAVANTAGE_KEY');

function getAlphavantageApiKey(): string | undefined {
  // Check Firebase Environment Configuration first
  const apiKey = alphavantageKey.value();
  // If not found, check process.env (for local development)
  return apiKey || process.env.ALPHAVANTAGE_KEY;
}

export const getDailyStockDataSimple = functions.https.onRequest(async (req, res) => {
  // Set CORS headers for all responses
  res.set('Access-Control-Allow-Origin', '*');

  console.log('gDSDS req.query: ', req.query);

  if (req.method === 'OPTIONS') {
    // Send response to OPTIONS requests
    res.set('Access-Control-Allow-Methods', 'GET, POST');
    res.set('Access-Control-Allow-Headers', 'Content-Type');
    res.status(204).send('');
    return;
  }

  const tickerSymbol = req.query.symbol as string | undefined;

  if (!tickerSymbol) {
    res.status(400).json({ error: 'Ticker symbol is required.' });
    return;
  }

  const apiKey = getAlphavantageApiKey();

  if (!apiKey) {
    res.status(500).json({ error: 'Alpha Vantage API key not configured.' });
    return;
  }
  const alphaVantageUrl = `${ALPHAVANTAGE_BASE_URL}?function=TIME_SERIES_DAILY&symbol=${tickerSymbol}&apikey=${apiKey}`;

  try {
    console.log('Alphavantage url:', alphaVantageUrl);
    const response = await axios.get(alphaVantageUrl);
    const stockData = response.data as any;

    if (stockData['Error Message']) {
      res.status(400).json({ error: stockData['Error Message'] });
    } else if (!stockData['Time Series (Daily)']) {
       res.status(404).json({ error: 'No daily time series data found for this ticker.' });
    }
    else {
      res.status(200).json(stockData);
    }

  } catch (error) {
    console.error('Error fetching stock data:', error);
    res.status(500).json({ error: 'Failed to fetch stock data.' });
  }
});