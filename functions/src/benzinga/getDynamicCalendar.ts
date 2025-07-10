import { onRequest } from 'firebase-functions/v2/https';
import { defineSecret, defineString } from 'firebase-functions/params';
import { db } from '../firebase-admin-init';
import { 
  BenzingaCalendarParams, 
  BzCalendarType,
  type BenzingaCalendarResponse,
  BZCalendarResponseMap,
  isBzCompanyDataCalendarType,
  isBzMarketDataCalendarType
} from '../common/common-benz';
import { BenzingaFunctionName } from '../common/common-fn';
import { 
  authenticateRequest,
  handleApiError
} from '../utils/utils';
import { 
  getDataCollection,
  getVendorDocId
} from './benzinga-firestore-helpers';

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
    console.error("fn gDC FATAL: BENZINGA_CALENDAR_API_KEY secret not found or loaded.");
    throw new Error("fn gDC FATAL: Server configuration error: Missing Benzinga Calendar API key.");
  }
  return apiKey;
}

/**
 * Fetch dynamic calendar data from Benzinga API
 */
async function fetchDynamicBenzingaCalendar<K extends BzCalendarType, T = BZCalendarResponseMap[K]>(
  apiKey: string,
  params: BenzingaCalendarParams,
  endpoint: K,
  queryParams: any
): Promise<BenzingaCalendarResponse<K>> {
  try {
    const url = new URL(`${BENZINGA_API_BASE_URL}/calendar/${endpoint}`);
    
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
    if (params.securities) {
      parameters['securities'] = params.securities.join(',').toUpperCase();
    }
    if (params.date_from) parameters['date_from'] = params.date_from;
    if (params.date_to) parameters['date_to'] = params.date_to;
    if (params.date) parameters['date'] = params.date;
    if (params.updated) parameters['updated'] = params.updated;
    if (params.importance) parameters['importance'] = params.importance;
    if (params.dividend_yield_gt) parameters['dividend_yield_gt'] = params.dividend_yield_gt;
    if (params.country) parameters['country'] = params.country;
    if (params.category) parameters['category'] = params.category;
    if (params.fuzzy) parameters['fuzzy'] = params.fuzzy;
    if (params.sort) parameters['sort'] = params.sort;

    // Add all parameters under 'parameters[]' namespace
    Object.entries(parameters).forEach(([key, value]) => {
      url.searchParams.append(`parameters[${key}]`, value);
    });

    const debugUrl = url.toString().replace(/(token=)[^&]+/, 'token=REDACTED');
    console.log('fn gDC Final API URL:', debugUrl);

    const response = await fetch(url.toString(), {
      method: 'GET',
      headers: {
        'Accept': 'application/json',
      },
    });

    const responseText = await response.text();
    
    // Check if response is XML (error)
    if (responseText.trim().startsWith('<?xml')) {
      throw new Error(`fn gDC Benzinga API returned XML error: ${responseText}`);
    }

    if (!response.ok) {
      throw new Error(`fn gDC Benzinga API error: ${response.status} ${response.statusText}\n${responseText}`);
    }

    let data: any;
    try {
      data = JSON.parse(responseText);
    } catch (e) {
      console.error('fn gDC Failed to parse API response:', responseText);
      throw new Error('Invalid JSON response from Benzinga API');
    }

    // The response should always be an object with the endpoint as a key
    if (data && typeof data === 'object' && endpoint in data) {
      // Return the complete response object
      return data;
    }

    // If we get here, the response format is unexpected
    console.warn('fn gDC Unexpected response format:', data);
    // Return a properly typed empty response with the expected structure
    return { [endpoint]: [] } as unknown as BenzingaCalendarResponse<K>;
  } catch (error) {
    console.error('fn gDC Error in fetchDynamicBenzingaCalendar:', error);
    // Return a properly typed empty response on error as well
    return { [endpoint]: [] } as unknown as BenzingaCalendarResponse<K>;
  }
}

/**
 * Main Cloud Function for Benzinga Calendar API
 */
export const getDynamicCalendar = onRequest(
  {
    secrets: [benzingaCalendarApiKeyParam],
    memory: '256MiB',
    cors: true, // Enable CORS for this function
  },
  async (req, res) => {
    try {
      console.log('==================== START getDynamicCalendar ====================');
      console.log(`Request: ${req.method} ${req.url}`);
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
        _nocache = 'true',  // Force bypass cache
        // Endpoint-specific params
        date_sort,
        dividend_yield_gt,
        importance,
        country,
        category,
        fuzzy,
        sort
      } = req.query;

      const calendarType = type as BzCalendarType;

      // Log the incoming request for debugging
      console.log('Incoming request parameters:', {
        type,
        tickers,
        date_from,
        date_to,
        page,
        pagesize,
        updated_since,
        _nocache,
        date_sort,
        dividend_yield_gt
      });

      // Build backend params object (map incoming query to backend keys)
      const params: BenzingaCalendarParams = {
        ...(tickers && typeof tickers === 'string' && tickers.trim() && {
          // Convert comma-separated string to array, trim, and take first 50 tickers
          tickers: tickers.split(',')
            .map((t: string) => t.trim().toUpperCase())
            .filter(Boolean)  // Remove any empty strings
            .slice(0, 50)     // Limit to first 50 tickers as per API docs
            .join(',')        // Convert back to comma-separated string for the API
        }),
        ...(date_from && { date_from: date_from as string }),
        ...(date_to && { date_to: date_to as string }),
        ...(updated_since && { updated: updated_since as string }),
        ...(importance && { importance: importance as string }),
        ...(dividend_yield_gt && { dividend_yield_gt: dividend_yield_gt as string }),
        ...(country && { country: country as string }),
        ...(category && { category: category as string }),
        ...(fuzzy && { fuzzy: fuzzy as string }),
        ...(sort && { sort: sort as string }),
        page: parseInt(page as string, 10) || 1,
        pagesize: parseInt(pagesize as string, 10) || 10
      };

      console.log('------------- fetch -------------------');
      console.log('fn gDC Fetching fresh data from Benzinga API (cache bypassed)');
      console.log(`Endpoint: ${calendarType}, Tickers: ${tickers || 'All companies'}`);
      
      const data = await fetchDynamicBenzingaCalendar(apiKey, params, calendarType, req.query);

      console.log('------------- response -------------------');
      console.info(`fn gDC [${tickers || 'no-ticker'}] Benzinga API response received for ${calendarType}`);
      
      // Log just the first item of the array for debugging
      if (data && typeof data === 'object' && calendarType in data) {
        const items = data[calendarType as keyof typeof data];
        if (Array.isArray(items) && items.length > 0) {
          console.log('First item in response:', JSON.stringify(items[0], null, 2));
        } else {
          console.log('Response contains no items');
        }
      } else {
        console.log('Unexpected response format:', JSON.stringify(data, null, 2));
      }
      
      // Check if data is defined
      if (!data) {
        console.error('fn gDC Error: No data received from Benzinga API');
        res.status(500).json({
          error: 'No data received',
          message: 'The API returned no data',
          type: calendarType
        });
        return;
      }

      // Get the endpoint metadata to determine the response key
      const endpointMeta = isBzCompanyDataCalendarType(calendarType) ? 'company' : isBzMarketDataCalendarType(calendarType) ? 'market' : calendarType;

      // Save to Firestore if we have valid tickers and data
      if (tickers && data) {
        console.log('------------- save to firestore -------------------');
        
        // Parse tickers into an array if it's a string
        const tickerArray = typeof tickers === 'string' 
          ? tickers.split(',').map(t => t.trim().toLowerCase())
          : Array.isArray(tickers) 
            ? tickers.map(t => t.toString().trim().toLowerCase())
            : [tickers.toString().trim().toLowerCase()];
        
        const batch = db.batch();
        const now = new Date();
        
        try {
          // Process each ticker
          for (const symbol of tickerArray) {
            if (!symbol) continue; // Skip empty tickers
            
            // Get the appropriate collection reference
            const collectionRef = await getDataCollection(db, calendarType, symbol);
            const docId = getVendorDocId('bz', calendarType);
            const docRef = collectionRef.doc(docId);
            
            // Update or create the document with the full response
            batch.set(docRef, {
              data: data, // Store the full response data
              metadata: {
                updated: now,
                source: 'benzinga-calendar',
                vendor: 'benzinga',
                version: 1,
                count: Array.isArray(data) ? data.length : 
                      (data && endpointMeta in data && Array.isArray((data as any)[endpointMeta])) ? 
                      (data as any)[endpointMeta].length : 0
              }
            }, { merge: true });
            
            console.log(`Updated ${calendarType} data for ${symbol}`);
          }
          
          // Commit all updates in a single batch
          await batch.commit();
          console.log(`Saved ${calendarType} data for ${tickerArray.length} ticker(s)`);
        } catch (error) {
          console.error('Error saving to Firestore:', error);
          // Continue to return the data even if Firestore save fails
        }
      }

      // Return the full response object
      res.status(200).json(data);
    } catch (error: unknown) {
      console.log('------------- error -------------------');
      if (!handleApiError(error, res, BenzingaFunctionName.GET_DYNAMIC_CALENDAR)) {
        console.error('fn gDC Unhandled error in getDynamicCalendar:', error);
        res.status(500).json({ 
          error: 'fn gDC Internal Server Error',
          details: error instanceof Error ? error.message : String(error)
        });
      }
    }
    console.log('==================== END getDynamicCalendar ====================');
  }
);
