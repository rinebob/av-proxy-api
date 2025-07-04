import { onRequest } from 'firebase-functions/v2/https';
import { defineSecret, defineString } from 'firebase-functions/params';
// import { getCachedCalendarData, cacheCalendarData } from './benzinga-firestore-helpers';
import { 
  BenzingaCalendarParams, 
  BenzingaCalendarResponse
} from '../common/common-benz';
import { BenzingaFunctionName } from '../common/common-fn';
import { 
  authenticateRequest,
  handleApiError
} from '../utils/utils';

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
  apiKey: string,
  params: BenzingaCalendarParams
): Promise<BenzingaCalendarResponse> {
  try {
    const url = new URL(`${BENZINGA_API_BASE_URL}/calendar/earnings`);
    
    // Add API key as a top-level parameter
    url.searchParams.append('token', apiKey);
    
    // Add pagesize as a top-level parameter
    if (params.pagesize) {
      url.searchParams.append('pagesize', params.pagesize.toString());
    }
    
    // Add parameters under parameters[] namespace
    const parameters: Record<string, string> = {};
    
    // Add ticker filter if provided
    if (params.tickers) {
      const tickers = Array.isArray(params.tickers) ? params.tickers : [params.tickers];
      parameters['tickers'] = tickers.join(',').toUpperCase();
    }
    
    // Add date range if provided
    if (params.date_from) parameters['date_from'] = params.date_from;
    if (params.date_to) parameters['date_to'] = params.date_to;
    
    // Add sort parameter
    parameters['date_sort'] = 'date';
    
    // Add all parameters under 'parameters[]' namespace
    Object.entries(parameters).forEach(([key, value]) => {
      url.searchParams.append(`parameters[${key}]`, value);
    });

    const debugUrl = url.toString().replace(/(token=)[^&]+/, 'token=REDACTED');
    console.log('Final API URL:', debugUrl);

    const response = await fetch(url.toString(), {
      method: 'GET',
      headers: {
        'Accept': 'application/json',
      },
    });

    const responseText = await response.text();
    
    // Check if response is XML (error)
    if (responseText.trim().startsWith('<?xml')) {
      throw new Error(`Benzinga API returned XML error: ${responseText}`);
    }

    if (!response.ok) {
      throw new Error(`Benzinga API error: ${response.status} ${response.statusText}\n${responseText}`);
    }

    let data;
    try {
      data = JSON.parse(responseText);
    } catch (e) {
      console.error('Failed to parse API response:', responseText);
      throw new Error('Invalid JSON response from Benzinga API');
    }

    return data;
  } catch (error) {
    console.error('Error in fetchBenzingaCalendar:', error);
    throw error;
  }
}

/**
 * Main Cloud Function for Benzinga Calendar API
 */
export const getBenzingaCalendar = onRequest(
  {
    secrets: [benzingaCalendarApiKeyParam],
    memory: '256MiB',
    cors: true, // Enable CORS for this function
  },
  async (req, res) => {
    try {
      // Step 1: Authenticate the request
      const decodedToken = await authenticateRequest(req, res);
      if (!decodedToken) {
        return; // Authentication failed, response already sent.
      }

      // Get API key
      const apiKey = getBenzingaApiKey();

      // Parse and validate query parameters
      const {
        type = 'earnings',  // Default to 'earnings' if not specified
        tickers,           // Ticker parameter (accepts single or multiple)
        date_from,
        date_to,
        page = '1',        // Default to page 1
        pagesize = '10',   // Default to 10 results
        updated_since,
        _nocache = 'true'  // Force bypass cache
      } = req.query;

      // Log the incoming request for debugging
      console.log('Incoming request parameters:', {
        type,
        tickers,
        date_from,
        date_to,
        page,
        pagesize,
        updated_since,
        _nocache
      });

      // Validate required parameters
      if (!tickers || typeof tickers !== 'string') {
        res.status(400).json({
          error: 'Ticker is required',
          message: 'Please provide a valid ticker symbol'
        });
        return;
      }

      // Build params object
      const params: BenzingaCalendarParams = {
        tickers: tickers.split(',').map(t => t.trim().toUpperCase()),
        ...(date_from && { date_from: date_from as string }),
        ...(date_to && { date_to: date_to as string }),
        page: parseInt(page as string, 10) || 1,
        pagesize: parseInt(pagesize as string, 10) || 10,
        ...(updated_since && { updated: updated_since as string })
      };

      console.log('Fetching fresh data from Benzinga API (cache bypassed)');
      const data = await fetchBenzingaCalendar(apiKey, params);

      // Always log the full Benzinga API response for debugging
      console.info(`[${tickers}] Benzinga API raw response:`, JSON.stringify(data));

      // If Benzinga returns an error, missing/invalid structure, or no data, pass through the raw response with status 200
      if (
        !data ||
        (Array.isArray(data) && data.length === 0) ||
        (typeof data === 'object' && !Array.isArray(data) && data !== null && ('error' in data || 'message' in data))
      ) {
        console.warn(`[${tickers}] Passing through raw Benzinga response due to missing/invalid data.`);
        res.status(200).json(data);
        return;
      }

      res.status(200).json(data);
    } catch (error: unknown) {
      if (!handleApiError(error, res, BenzingaFunctionName.GET_CALENDAR)) {
        console.error('Unhandled error in getBenzingaCalendar:', error);
        res.status(500).json({ 
          error: 'Internal Server Error',
          details: error instanceof Error ? error.message : String(error)
        });
      }
    }
  }
);
