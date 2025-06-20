// functions/src/firestore-helpers.ts
import { FieldValue, Timestamp } from 'firebase-admin/firestore';
import { 
  AlphaVantageGlobalQuoteResponse,
  AlphaVantageDailyTimeSeriesTwo,
  DailyTimeSeriesDataTwo,
  TimeSeriesMetaDataTwo
} from './common-fn';

/**
 * Interface for stock data stored in Firestore
 */
export interface StoredStockData {
    metaData: TimeSeriesMetaDataTwo;
    timeSeriesDaily?: DailyTimeSeriesDataTwo[];
    timeSeriesDailyAdjusted?: DailyTimeSeriesDataTwo[];
    information?: string;
    note?: string;
    lastUpdated: Timestamp;
}
import { firebaseAdmin } from './utils';

const db = firebaseAdmin.firestore();
db.settings({ ignoreUndefinedProperties: true });

const { serverTimestamp } = FieldValue;

/**
 * Transforms the response from Alpha Vantage into a structured format for Firestore.
 * @param response The raw response from the Alpha Vantage API.
 * @returns The transformed data structure.
 * @throws {Error} With appropriate error message for different types of API responses
 */
export function transformAlphaVantageResponse(response: any): AlphaVantageDailyTimeSeriesTwo {
  // Guard clause: If the data is already transformed, return it directly.
  if (response && response.metaData && response.timeSeriesDaily) {
    console.log('fsh tAVR: Response already transformed. Skipping.');
    return response;
  }

  console.log('fsh tAVR response keys: ', Object.keys(response));
  console.log('fsh tAVR response metadata: ', response['Meta Data']);
    console.log('fsh tAVR Starting transformation');
    
    // Helper function to check for rate limit messages
    const isRateLimitMessage = (message: string): boolean => {
        const rateLimitIndicators = [
            'API rate limit',
            'Thank you for using Alpha Vantage',
            'standard API rate limit',
            'premium plan',
            'upgrade to premium'
        ];
        return rateLimitIndicators.some(indicator => 
            message.toLowerCase().includes(indicator.toLowerCase())
        );
    };
    
    try {
        // Check for error responses first
        if (response['Error Message']) {
            const errorMsg = response['Error Message'];
            console.error('fsh tAVR API Error:', errorMsg);
            throw new Error(`API Error: ${errorMsg}`);
        }
        
        // Check for rate limit or information messages first
        if (response['Information']) {
            const infoMsg = response['Information'];
            console.warn('fsh tAVR API Information:', infoMsg);
            
            if (isRateLimitMessage(infoMsg)) {
                throw new Error(`RATE_LIMIT: ${infoMsg}`);
            }
            
            // If there's an information message but no meta data, treat as error
            if (!response['Meta Data']) {
                throw new Error(`API Error: ${infoMsg}`);
            }
        }
        
        if (response['Note']) {
            const noteMsg = response['Note'];
            console.warn('fsh tAVR API Note:', noteMsg);
            
            if (isRateLimitMessage(noteMsg)) {
                throw new Error(`RATE_LIMIT: ${noteMsg}`);
            }
        }
        
        // Check for required fields
        if (!response['Meta Data'] && !response['metaData']) {
          console.warn('fsh tAVR Missing Meta Data');
            // throw new Error('Invalid Alpha Vantage response: Missing Meta Data');
        }
        
        // Determine which time series to use (daily or daily adjusted)
        const timeSeriesData = response['Time Series (Daily)'] || response['Time Series (Daily - Adjusted)'] || response['timeSeriesDaily'];
        
        if (!timeSeriesData) {
            throw new Error('No valid time series data found in response');
        }
        
        const metaData = response['Meta Data'] || response['metaData'];
        
        // Convert the time series to our storage format (array of data points)
        const processedTimeSeries: DailyTimeSeriesDataTwo[] = [];
        const dates = Object.keys(timeSeriesData).sort((a, b) => 
            new Date(b).getTime() - new Date(a).getTime()
        );
        
        // Process each date in the time series
        for (const date of dates) {
            const dailyData = timeSeriesData[date];
            
            // Create the data point in our normalized format
            const dataPoint: DailyTimeSeriesDataTwo = {
                date,
                open: dailyData['1. open'],
                high: dailyData['2. high'],
                low: dailyData['3. low'],
                close: dailyData['4. close'],
                volume: dailyData['5. volume'] || dailyData['6. volume'] || '0',
                adjustedClose: dailyData['5. adjusted close'],
                volumeAdjusted: dailyData['6. volume'],
                dividendAmount: dailyData['7. dividend amount'],
                splitCoefficient: dailyData['8. split coefficient']
            };
            processedTimeSeries.push(dataPoint);
        }
        
        // Log some stats for debugging
        if (processedTimeSeries.length > 0) {
            const firstItem = processedTimeSeries[0];
            const lastItem = processedTimeSeries[processedTimeSeries.length - 1];
            console.log('fsh tAVR Processed time series', {
                symbol: metaData['2. Symbol'],
                entries: processedTimeSeries.length,
                dateRange: { first: firstItem.date, last: lastItem.date },
                firstEntry: firstItem
            });
        }
        
        // Return the normalized data
        const result: AlphaVantageDailyTimeSeriesTwo = {
            metaData: {
                information: metaData['1. Information'],
                symbol: metaData['2. Symbol'],
                lastRefreshed: metaData['3. Last Refreshed'],
                outputSize: metaData['4. Output Size'],
                timeZone: metaData['5. Time Zone']
            },
            timeSeriesDaily: processedTimeSeries
        };
        
        return result;
        
    } catch (error) {
        // Don't log stack trace for rate limit errors
        if (error instanceof Error && error.message.startsWith('RATE_LIMIT:')) {
            console.warn('fsh tAVR Rate limit error:', error.message);
        } else {
            console.error('fsh tAVR Error during transformation:', error);
            console.error('fsh tAVR Response data:', JSON.stringify(response, null, 2));
        }
        throw error; // Re-throw to be handled by the caller
    }
}

/**
 * Processes and enriches daily stock data with calculated fields
 * @param timeSeries The time series data to process (array of data points)
 * @returns Processed time series data with calculated fields as an array
 */
function processDailyData(
  timeSeries: DailyTimeSeriesDataTwo[]
): DailyTimeSeriesDataTwo[] {
  console.log('fsh pDD processDailyData - Starting to process time series data');
  const processedData: DailyTimeSeriesDataTwo[] = [];
  
  console.log('fsh pDD processDailyData - Total dates to process:', timeSeries.length);
  if (timeSeries.length > 0) {
    console.log('fsh pDD processDailyData - Date range:', { 
      first: timeSeries[0].date, 
      last: timeSeries[timeSeries.length - 1].date 
    });
  }

  for (let i = 0; i < timeSeries.length; i++) {
    const data = { ...timeSeries[i] }; // Create a copy to avoid mutating the original
    
    // Calculate change and change percent if previous day data exists
    if (i > 0) {
      const prevData = timeSeries[i - 1];
      const prevClose = parseFloat(prevData.close);
      const currentClose = parseFloat(data.close);
      const change = currentClose - prevClose;
      const changePercent = (change / prevClose) * 100;
      
      data.previousClose = prevClose.toFixed(2);
      data.change = change.toFixed(2);
      data.changePercent = `${changePercent.toFixed(2)}%`;
      
      if (i <= 2) { // Log first few calculations for debugging
        console.log('fsh pDD processDailyData - Change calculation', {
          date: data.date,
          prevDate: prevData.date,
          prevClose,
          currentClose,
          change: data.change,
          changePercent: data.changePercent
        });
      }
    } else {
      console.log('fsh pDD processDailyData - First day data (no change calculation):', {
        date: data.date,
        close: data.close
      });
    }
    
    processedData.push(data);
  }

  return processedData;
}

/**
 * Saves daily stock data to Firestore using the new interface format
 * @param symbol The stock symbol being saved
 * @param response The response data to save
 * @returns The transformed response data
 */
export async function saveDailyStockData(
  symbol: string, 
  response: any
): Promise<AlphaVantageDailyTimeSeriesTwo> {
  console.log(`fsh sDSD saveDailyStockData - Starting to save data for symbol: ${symbol}`);
  
  // Transform the response if it's in Alpha Vantage format
  const transformedResponse = transformAlphaVantageResponse(response);
  
  const result = await saveTransformedDailyStockData(symbol, transformedResponse);
  console.log(`fsh sDSD saveDailyStockData - Successfully processed and saved daily data for ${symbol}`);
  
  return result;
}

/**
 * Saves already transformed daily stock data to Firestore
 */
async function saveTransformedDailyStockData(
  symbol: string, 
  response: AlphaVantageDailyTimeSeriesTwo
): Promise<AlphaVantageDailyTimeSeriesTwo> {
  console.log('fsh sTDSD saveTransformedDailyStockData - Starting to process data for symbol:', symbol);
  
  if (!response || !response.timeSeriesDaily) {
    const errorMsg = 'fsh sTDSD saveTransformedDailyStockData - Invalid response format from Alpha Vantage';
    console.error(errorMsg, { 
      hasResponse: !!response, 
      hasTimeSeries: !!response?.timeSeriesDaily 
    });
    throw new Error(errorMsg);
  }

  const entryCount = response.timeSeriesDaily.length;
  console.log('fsh sTDSD saveTransformedDailyStockData - Raw data entries:', entryCount);
  
  // Process the time series data to calculate changes and other derived fields
  const processedTimeSeries = processDailyData(response.timeSeriesDaily);
  
  // Prepare the document data with the processed time series
  const docData: StoredStockData = {
    metaData: response.metaData,
    timeSeriesDaily: processedTimeSeries,
    information: response.information,
    note: response.note,
    lastUpdated: serverTimestamp() as Timestamp
  };
  
  // If we have adjusted data, process that too
  if (response.timeSeriesDailyAdjusted) {
    // Ensure the adjusted data is in the correct format
    const adjustedData = Array.isArray(response.timeSeriesDailyAdjusted)
      ? response.timeSeriesDailyAdjusted
      : Object.entries<DailyTimeSeriesDataTwo>(response.timeSeriesDailyAdjusted as Record<string, DailyTimeSeriesDataTwo>)
          .map(([date, data]) => ({
            open: data.open,
            high: data.high,
            low: data.low,
            close: data.close,
            volume: data.volume,
            adjustedClose: data.adjustedClose,
            volumeAdjusted: data.volumeAdjusted,
            dividendAmount: data.dividendAmount,
            splitCoefficient: data.splitCoefficient,
            previousClose: data.previousClose,
            change: data.change,
            changePercent: data.changePercent,
            date
          }));
    docData.timeSeriesDailyAdjusted = processDailyData(adjustedData);
  }
  
  // Log the data structure for debugging
  console.log('fsh sTDSD saveTransformedDailyStockData - Saving document for symbol:', symbol);
  console.log('fsh sTDSD saveTransformedDailyStockData - Document data keys:', Object.keys(docData));
  
  if (docData.timeSeriesDaily && docData.timeSeriesDaily.length > 0) {
    const firstItem = docData.timeSeriesDaily[0];
    const lastItem = docData.timeSeriesDaily[docData.timeSeriesDaily.length - 1];
    
    console.log(`fsh sTDSD saveTransformedDailyStockData - Time series contains ${docData.timeSeriesDaily.length} entries`);
    console.log('fsh sTDSD saveTransformedDailyStockData - Date range:', {
      first: firstItem.date,
      last: lastItem.date
    });
    console.log('fsh sTDSD saveTransformedDailyStockData - First item data:', firstItem);
  }
  
  // Save the document with the symbol as the document ID
  const docRef = db.collection('stockData').doc(symbol);
  
  try {
    await docRef.set(docData, { merge: true });
    console.log('fsh sTDSD saveTransformedDailyStockData - Successfully saved document for symbol:', symbol);
    return response; // Return the transformed response
  } catch (error) {
    console.error('fsh sTDSD saveTransformedDailyStockData - Error saving document:', error);
    throw error;
  }
}

export async function saveGlobalQuote(
  symbol: string,
  quote: AlphaVantageGlobalQuoteResponse['Global Quote']
): Promise<void> {
  if (!quote || !quote['07. latest trading day'] || !quote['05. price']) {
    throw new Error('Invalid quote data format');
  }

  const date = quote['07. latest trading day'];
  const docId = `${symbol}-${date}`;
  const docRef = db.collection('stockData').doc(docId);

  await docRef.set({
    symbol,
    date,
    open: parseFloat(quote['02. open']),
    high: parseFloat(quote['03. high']),
    low: parseFloat(quote['04. low']),
    close: parseFloat(quote['05. price']),
    volume: parseInt(quote['06. volume'], 10),
    previousClose: parseFloat(quote['08. previous close']),
    change: parseFloat(quote['09. change']),
    changePercent: quote['10. change percent'],
    timestamp: serverTimestamp()
  }, { merge: true });
}

export async function getStockData(
  symbol: string,
  limit?: number
): Promise<StoredStockData[]> {
  try {
    // Get the document for the symbol
    const doc = await db.collection('stockData').doc(symbol).get();
    
    if (!doc.exists) {
      console.log(`No data found for symbol: ${symbol}`);
      return [];
    }
    
    const data = doc.data() as StoredStockData;
    
    // If limit is provided, apply it to the time series arrays
    if (limit && data.timeSeriesDaily) {
      data.timeSeriesDaily = data.timeSeriesDaily.slice(0, limit);
    }
    
    if (limit && data.timeSeriesDailyAdjusted) {
      data.timeSeriesDailyAdjusted = data.timeSeriesDailyAdjusted.slice(0, limit);
    }
    
    return [data];
  } catch (error) {
    console.error(`Error getting data for symbol ${symbol}:`, error);
    throw error;
  }
}