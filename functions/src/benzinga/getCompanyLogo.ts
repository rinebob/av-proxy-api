import { onRequest } from 'firebase-functions/v2/https';
import axios from 'axios';
import { 
  setCorsHeaders, 
  handleOptionsRequest,
  handleApiError
} from '../utils';

export const getCompanyLogo = onRequest(
  {
    secrets: ['BENZINGA_CALENDAR_API_KEY'],
    cors: true,
    region: 'us-central1',
    memory: '256MiB'
  },
  async (req, res) => {
    // Set CORS headers
    setCorsHeaders(req, res);
    
    // Handle CORS preflight
    if (handleOptionsRequest(req, res)) {
      return;
    }

    try {
      const ticker = req.query.ticker as string;
      if (!ticker) {
        res.status(400).json({ error: 'Ticker is required' });
        return;
      }

      const apiKey = process.env.BENZINGA_CALENDAR_API_KEY;
      if (!apiKey) {
        throw new Error('Benzinga API key not configured');
      }

      const url = `https://api.benzinga.com/api/v2.1/company/logo`;
      const params = {
        ticker: ticker.toUpperCase(),
        token: apiKey
      };

      // Use axios like other functions in the project
      const response = await axios.get<{
        logo: string;
        ticker: string;
        name: string;
      }>(url, { params });

      // Cache the response for 30 days since logos don't change often
      res.set('Cache-Control', 'public, max-age=2592000');
      res.json(response.data);
    } catch (error: unknown) {
      if (!handleApiError(error, res, 'getCompanyLogo')) {
        console.error('Unhandled error in getCompanyLogo:', error);
        res.status(500).json({ 
          error: 'Failed to fetch company logo',
          details: error instanceof Error ? error.message : 'Unknown error'
        });
      }
    }
  }
);
