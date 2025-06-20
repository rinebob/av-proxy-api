import { onRequest } from 'firebase-functions/v2/https';
import { 
    setCorsHeaders, 
    handleOptionsRequest, 
    getAlphaVantageApiKey, 
    fetchStockData,
    authenticateFirebaseUser,
    firebaseAdmin 
} from './utils';
import { 
    AlphaVantageFunction,
    CloudFunctionName,
    AlphaVantageGlobalQuoteResponse,
    GlobalQuoteData
} from './common-fn';

const db = firebaseAdmin.firestore();

// Helper function to save global quote to Firestore
async function saveGlobalQuoteToFirestore(
    symbol: string, 
    globalQuote: GlobalQuoteData
): Promise<void> {
    if (!globalQuote) {
        return;
    }

    const batch = db.batch();
    const quoteRef = db.collection('globalQuotes').doc(symbol);
    
    try {
        // Prepare the data for Firestore
        const quoteData = {
            symbol: symbol,
            lastUpdated: firebaseAdmin.firestore.FieldValue.serverTimestamp(),
            ...globalQuote
        };

        // Set the quote document
        batch.set(quoteRef, quoteData, { merge: true });
        
        // Commit the batch
        await batch.commit();
        console.log(`Successfully saved global quote for ${symbol} to Firestore`);
    } catch (error) {
        console.error('Error in saveGlobalQuoteToFirestore:', error);
        throw error; // Re-throw to be handled by the caller
    }
}

export const getGlobalQuote = onRequest(
    { 
      secrets: ['ALPHAVANTAGE_API_KEY'],
      memory: '256MiB'
    }, 
    async (req, res) => {
        console.info('----------- getGlobalQuote ---------------');
        
        setCorsHeaders(res);

        // Handle CORS preflight
        if (handleOptionsRequest(req as any, res as any)) {
            return;
        }

        try {
            // --- Firebase ID Token Authentication ---
            const decodedToken = await authenticateFirebaseUser(
                req, 
                res, 
                CloudFunctionName.GET_GLOBAL_QUOTE
            );
            if (!decodedToken) {
                return; // Response already handled by authenticateFirebaseUser
            }
            // uid is available if needed for further logic: const uid = decodedToken.uid;
            // --- End Firebase ID Token Authentication ---

            if (req.method !== 'GET') {
                console.warn('Received non-GET request:', req.method);
                res.status(405).json({ error: 'Method Not Allowed. Please send a GET request.' });
                return;
            }

            const { symbol } = req.query;

            if (!symbol) {
                res.status(400).json({ 
                    error: 'Bad Request',
                    message: 'Missing required parameter: symbol'
                });
                return;
            }

            const apiKey = getAlphaVantageApiKey();
            if (!apiKey) {
                console.error('Alpha Vantage API key not configured');
                res.status(500).json({ 
                    error: 'Internal Server Error',
                    message: 'API key not configured'
                });
                return;
            }

            const response = await fetchStockData(
                AlphaVantageFunction.GLOBAL_QUOTE,
                symbol as string,
                apiKey
            );

            const responseData = response.data as AlphaVantageGlobalQuoteResponse;

            // Save to Firestore if we have global quote data
            const globalQuote = responseData['Global Quote'];
            if (globalQuote) {
                try {
                    // Format numeric values to 2 decimal places
                    const formattedQuote: GlobalQuoteData = {
                        '01. symbol': globalQuote['01. symbol'],
                        '02. open': parseFloat(globalQuote['02. open']).toFixed(2),
                        '03. high': parseFloat(globalQuote['03. high']).toFixed(2),
                        '04. low': parseFloat(globalQuote['04. low']).toFixed(2),
                        '05. price': parseFloat(globalQuote['05. price']).toFixed(2),
                        '06. volume': globalQuote['06. volume'],
                        '07. latest trading day': globalQuote['07. latest trading day'],
                        '08. previous close': parseFloat(globalQuote['08. previous close']).toFixed(2),
                        '09. change': parseFloat(globalQuote['09. change']).toFixed(2),
                        '10. change percent': globalQuote['10. change percent'] // Keep as is since it's already a percentage string
                    };

                    await saveGlobalQuoteToFirestore(symbol as string, formattedQuote);
                    console.log(`Successfully saved global quote for ${symbol}`);
                } catch (error) {
                    console.error('Error saving to Firestore:', error);
                    // Continue even if Firestore save fails
                }
            }

            res.status(200).json(responseData);

        } catch (error: any) {
            console.error('Error in getGlobalQuote:', error);
            
            if (error.response?.status) {
                console.error(`HTTP Error Response: ${error.response.status} - ${error.response.statusText}`);
                const apiErrorData = error.response.data as AlphaVantageGlobalQuoteResponse | undefined;
                if (apiErrorData?.Information) {
                    console.error('API Error Information:', apiErrorData.Information);
                    res.status(400).json({ error: `API Error: ${apiErrorData.Information}` });
                } else if (apiErrorData?.Note) {
                    console.error('API Rate Limit Note:', apiErrorData.Note);
                    res.status(429).json({ error: `API Rate Limit Exceeded: ${apiErrorData.Note}` });
                } else {
                    res.status(error.response.status).json({ 
                        error: 'API Error',
                        message: error.response.statusText || 'Failed to fetch global quote'
                    });
                }
            } else if (error.request) {
                console.error('No response received from API:', error.request);
                res.status(504).json({ 
                    error: 'Gateway Timeout',
                    message: 'No response received from AlphaVantage API' 
                });
            } else {
                const statusCode = 500;
                const message = error.message || 'Internal Server Error';
                res.status(statusCode).json({
                    error: 'Internal Server Error',
                    message: message
                });
            }
        }
    }
);
