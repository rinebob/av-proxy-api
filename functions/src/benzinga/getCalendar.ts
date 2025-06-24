import { onRequest } from 'firebase-functions/v2/https';
import { defineSecret, defineString } from 'firebase-functions/params';
import { getCachedCalendarData, cacheCalendarData } from './benzinga-firestore-helpers';
import { 
  BenzingaCalendarParams, 
  BenzingaCalendarType,
  BenzingaCalendarResponse
} from '../common/common-benz';
import { 
  handleOptionsRequest,
  setCorsHeaders
} from '../utils';

// Define the Benzinga API key as a secret
export const benzingaCalendarApiKeyParam = defineSecret('BENZINGA_CALENDAR_API_KEY');

// For local emulator
const localEmulatorBenzingaApiKeyParam = defineString('LOCAL_EMULATOR_BENZINGA_CALENDAR_API_KEY', {
  input: { text: {} },
  default: '',
  description: 'API key for Benzinga Calendar API, ONLY for local emulator use.'
});

// Benzinga API base URL
const BENZINGA_API_BASE_URL = 'https://api.benzinga.com/api/v2.1';

/**
 * Retrieves the Benzinga API key from the appropriate source based on environment.
 * @returns {string} The API key
 * @throws {Error} If the API key is not configured
 */
function getBenzingaApiKey(): string {
  if (process.env.FUNCTIONS_EMULATOR === 'true') {
    const localKey = localEmulatorBenzingaApiKeyParam.value();
    if (localKey) {
      console.log("Using local emulator API key for Benzinga Calendar.");
      return localKey;
    }
  }
  
  const apiKey = process.env.BENZINGA_CALENDAR_API_KEY;
  if (!apiKey) {
    console.error("FATAL: BENZINGA_CALENDAR_API_KEY secret not found or loaded.");
    throw new Error("Server configuration error: Missing Benzinga Calendar API key.");
  }
  return apiKey;
}

/**
 * Fetch calendar data from Benzinga API
 */
async function fetchBenzingaCalendar(
  params: BenzingaCalendarParams,
  apiKey: string
): Promise<BenzingaCalendarResponse> {
  const { type, tickers, dateFrom, dateTo, page = 1, pageSize = 100, updatedSince } = params;
  
  const url = new URL(`${BENZINGA_API_BASE_URL}/calendar/${type}`);
  
  // Add query parameters
  if (tickers && tickers.length > 0) {
    url.searchParams.append('tickers', tickers.join(','));
  }
  if (dateFrom) url.searchParams.append('date_from', dateFrom);
  if (dateTo) url.searchParams.append('date_to', dateTo);
  if (page) url.searchParams.append('page', page.toString());
  if (pageSize) url.searchParams.append('pagesize', pageSize.toString());
  if (updatedSince) url.searchParams.append('updated_since', updatedSince);
  
  const response = await fetch(url.toString(), {
    method: 'GET',
    headers: {
      'Accept': 'application/json',
      'X-BZ-API-KEY': apiKey
    }
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Benzinga API error: ${response.status} - ${errorText}`);
  }

  return response.json();
}

/**
 * Main Cloud Function for Benzinga Calendar API
 */
export const getBenzingaCalendar = onRequest(
  {
    secrets: [benzingaCalendarApiKeyParam],
    memory: '256MiB',
  },
  async (req, res) => {
    // Handle preflight requests first
    if (handleOptionsRequest(req, res)) {
      return; // End the request if it was an OPTIONS request
    }

    // Set CORS headers for the actual request
    setCorsHeaders(req, res);

    try {
      // Get API key
      const apiKey = getBenzingaApiKey();

      // Parse and validate query parameters
      const {
        type,
        tickers,
        date_from,
        date_to,
        page,
        pagesize,
        updated_since
      } = req.query;

      // Validate required parameters
      if (!type || !Object.values(BenzingaCalendarType).includes(type as BenzingaCalendarType)) {
        res.status(400).json({
          error: 'Invalid or missing calendar type',
          validTypes: Object.values(BenzingaCalendarType)
        });
        return;
      }

      // Build params object
      const params: BenzingaCalendarParams = {
        type: type as BenzingaCalendarType,
        ...(tickers && { tickers: (tickers as string).split(',') }),
        ...(date_from && { dateFrom: date_from as string }),
        ...(date_to && { dateTo: date_to as string }),
        ...(page && { page: parseInt(page as string, 10) }),
        ...(pagesize && { pageSize: parseInt(pagesize as string, 10) }),
        ...(updated_since && { updatedSince: updated_since as string })
      };

      // Check cache first
      const cachedData = await getCachedCalendarData(params);
      if (cachedData) {
        console.log('Serving from cache');
        res.status(200).json(cachedData);
        return;
      }

      console.log('Fetching from Benzinga API');
      const data = await fetchBenzingaCalendar(params, apiKey);
      
      // Cache the response
      await cacheCalendarData(params, data);
      
      res.status(200).json(data);
    } catch (error) {
      console.error('Error in getBenzingaCalendar:', error);
      res.status(500).json({ error: 'Internal Server Error' });
    }
  }
);
