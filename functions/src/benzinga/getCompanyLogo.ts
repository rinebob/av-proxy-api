import { onRequest } from 'firebase-functions/v2/https';
import { 
  authenticateRequest,
  handleApiError
} from '../utils';
import { BenzingaFunctionName } from '../common/common-fn';
import { getLogoData, saveLogoData } from './benzinga-firestore-helpers';

export const getCompanyLogo = onRequest(
  {
    secrets: ['BENZINGA_CALENDAR_API_KEY'],
    cors: true,
    region: 'us-central1',
    memory: '256MiB'
  },
  async (req, res) => {
    try {
      // Step 1: Authenticate the request
      const decodedToken = await authenticateRequest(req, res);
      if (!decodedToken) {
        return; // Authentication failed, response already sent.
      }

      // Step 2: Validate specific parameters for this function
      const ticker = (req.query.ticker as string)?.toUpperCase();
      if (!ticker) {
        res.status(400).json({ error: 'Ticker is required' });
        return;
      }

      // Step 3: Check for cached data
      const cachedData = await getLogoData(ticker);
      if (cachedData) {
        res.set('X-Cache-Status', 'HIT');
        res.status(200).json(cachedData);
        return;
      }

      const apiKey = process.env.BENZINGA_CALENDAR_API_KEY;
      if (!apiKey) {
        throw new Error('Benzinga API key not configured');
      }

      const url = new URL(`https://api.benzinga.com/api/v2.1/company/logo`);
      url.searchParams.append('ticker', ticker);
      url.searchParams.append('token', apiKey);

      const response = await fetch(url.toString(), {
        method: 'GET',
        headers: { 'Accept': 'application/json' },
      });

      if (!response.ok) {
        throw new Error(`Benzinga API error: ${response.status} ${response.statusText}`);
      }

      const data = await response.json();

      // Step 4: Cache the new data (do not await)
      saveLogoData(ticker, data).catch(err => {
        console.error(`Failed to cache logo for ${ticker}:`, err);
      });

      res.set('X-Cache-Status', 'MISS');
      res.status(200).json(data);
    } catch (error: unknown) {
      if (!handleApiError(error, res, BenzingaFunctionName.GET_COMPANY_LOGO)) {
        console.error(`Unhandled error in ${BenzingaFunctionName.GET_COMPANY_LOGO}:`, error);
        res.status(500).json({ 
          error: 'Failed to fetch company logo',
          details: error instanceof Error ? error.message : 'Unknown error'
        });
      }
    }
  }
);
