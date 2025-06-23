// functions/src/getGlobalQuote.ts
import { onRequest } from 'firebase-functions/v2/https';
import { FieldValue } from 'firebase-admin/firestore';
import {
  setCorsHeaders,
  handleOptionsRequest,
  getAlphaVantageApiKey,
  fetchStockData,
  authenticateFirebaseUser,
  db,
} from './utils';
import {
  AlphaVantageFunction,
  CloudFunctionName,
  AlphaVantageGlobalQuoteResponse,
  GlobalQuoteData,
} from './common-fn';

// Helper function to save global quote to Firestore
async function saveGlobalQuoteToFirestore(
  symbol: string,
  globalQuote: GlobalQuoteData
): Promise<void> {
  try {
    const quoteData = {
      ...globalQuote,
      lastUpdated: FieldValue.serverTimestamp(),
    };

    const docRef = db.collection('stockData').doc(symbol);
    await docRef.set({ globalQuote: quoteData }, { merge: true });

    console.log(`Successfully saved global quote for ${symbol} to Firestore.`);
  } catch (error) {
    console.error(`Error saving global quote for ${symbol} to Firestore:`, error);
    // Do not re-throw; failing to cache should not fail the entire request.
  }
}

export const getGlobalQuote = onRequest(
  {
    secrets: ['ALPHAVANTAGE_API_KEY'],
    cors: true,
  },
  async (req, res) => {
    console.info('----------- getGlobalQuote ---------------');
    setCorsHeaders(res);

    if (handleOptionsRequest(req, res)) {
      return;
    }

    const decodedToken = await authenticateFirebaseUser(
      req,
      res,
      CloudFunctionName.GET_GLOBAL_QUOTE
    );
    if (!decodedToken) {
      return; // Response already sent
    }

    const symbol = req.query.symbol as string;
    if (!symbol) {
      res.status(400).send('Please provide a stock symbol.');
      return;
    }

    try {
      const alphaVantageApiKey = getAlphaVantageApiKey();

      const data: AlphaVantageGlobalQuoteResponse = await fetchStockData(
        AlphaVantageFunction.GLOBAL_QUOTE,
        symbol,
        alphaVantageApiKey
      );

      if (data && data['Global Quote'] && Object.keys(data['Global Quote']).length > 0) {
        await saveGlobalQuoteToFirestore(symbol, data['Global Quote']);
        res.status(200).json(data);
      } else {
        res.status(404).json(data); // Return API's note (e.g., rate limit)
      }
    } catch (error: any) {
      // Log a simplified error to avoid circular structure issues in logs
      console.error('Error in getGlobalQuote:');
      // Use console.dir for better object inspection without stringifying
      console.dir(error);

      let status = 500;
      let errorMessage = 'An internal server error occurred.';

      // Check if it's an Axios error from the external API call
      if (error.isAxiosError && error.response) {
        status = error.response.status;
        // Try to get a specific message from the Alpha Vantage response body
        if (error.response.data && error.response.data.Information) {
          errorMessage = error.response.data.Information;
        } else {
          // Fallback for other Axios errors
          errorMessage = `Request to external API failed with status ${status}`;
        }
      } else if (error instanceof Error) {
        // Handle other types of errors (e.g., validation, internal logic)
        errorMessage = error.message;
      }

      res.status(status).json({
        message: 'Failed to fetch global quote.',
        error: errorMessage,
      });
    }
  }
);