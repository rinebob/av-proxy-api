// functions/src/alpha-vantage/firestore-helpers.ts
import { db } from '../utils';
import {
  AlphaVantageDailyTimeSeriesResponse,
  CloudFunctionName,
  DailyTimeSeriesData,
  DailyTimeSeriesDataTwo,
  GlobalQuoteData,
  StoredStockData,
  TimeSeriesMetaDataTwo,
} from '../common/common-fn.js';
import { FieldValue } from 'firebase-admin/firestore';

/**
 * Transforms the raw time series data from the Alpha Vantage API into a clean, structured format.
 * @param timeSeries The raw time series data object from the API response (e.g., `response['Time Series (Daily)']`).
 * @returns An array of processed daily data points with clean keys.
 */
function processDailyData(
  timeSeries: Record<string, DailyTimeSeriesData> | undefined
): DailyTimeSeriesDataTwo[] {
  if (!timeSeries) {
    return [];
  }
  return Object.entries(timeSeries).map(([date, dailyData]) => ({
    date: date,
    open: dailyData['1. open'],
    high: dailyData['2. high'],
    low: dailyData['3. low'],
    close: dailyData['4. close'],
    volume: dailyData['5. volume'],
    // Handle adjusted data fields if they exist
    adjustedClose: dailyData['5. adjusted close'],
    volumeAdjusted: dailyData['6. volume'],
    dividendAmount: dailyData['7. dividend amount'],
    splitCoefficient: dailyData['8. split coefficient'],
  }));
}

/**
 * Transforms the entire raw Alpha Vantage API response into a structured format for Firestore.
 * @param response The raw response from the Alpha Vantage API.
 * @returns The transformed stock data ready for storage.
 */
export function transformAlphaVantageResponse(
  response: AlphaVantageDailyTimeSeriesResponse
): StoredStockData {
  // Transform metadata to clean version
  const metaData: TimeSeriesMetaDataTwo = {
    information: response['Meta Data']['1. Information'],
    symbol: response['Meta Data']['2. Symbol'],
    lastRefreshed: response['Meta Data']['3. Last Refreshed'],
    outputSize: response['Meta Data']['4. Output Size'],
    timeZone: response['Meta Data']['5. Time Zone'],
  };

  const docData: StoredStockData = {
    metaData: metaData,
    lastUpdated: FieldValue.serverTimestamp(),
    timeSeriesDaily: processDailyData(response['Time Series (Daily)']),
    timeSeriesDailyAdjusted: processDailyData(
      response['Time Series (Daily - Adjusted)']
    ),
    information: response.Information,
    note: response.Note,
  };

  return docData;
}

/**
 * Saves stock data to Firestore, handling different data structures based on the function type.
 * @param symbol The stock symbol, used as the document ID.
 * @param data The data to save (either daily data or a global quote).
 * @param functionName The name of the cloud function, to determine how to structure the data.
 */
export async function saveStockData(
  symbol: string,
  data: StoredStockData | GlobalQuoteData,
  functionName: CloudFunctionName
): Promise<void> {
  if (!symbol) {
    throw new Error('Symbol is required to save stock data.');
  }
  const docRef = db.collection('stockData').doc(symbol);

  let dataToSave;
  if (functionName === CloudFunctionName.GET_GLOBAL_QUOTE) {
    // For global quotes, save the data inside a 'globalQuote' field to avoid overwriting daily data.
    dataToSave = { globalQuote: data, lastUpdatedGlobalQuote: FieldValue.serverTimestamp() };
  } else {
    // For daily data, the data object is already structured correctly.
    dataToSave = data;
  }

  await docRef.set(dataToSave, { merge: true });
  console.log(`Successfully saved data for ${symbol} (${functionName}) to Firestore.`);
}

/**
 * Retrieves a specific type of stock data from a Firestore document.
 * @param symbol The stock symbol.
 * @param functionName The type of data to retrieve (e.g., global quote or daily data).
 * @returns The requested data, or null if not found.
 */
export async function getStockData(
  symbol: string,
  functionName: CloudFunctionName
): Promise<StoredStockData | GlobalQuoteData | null> {
  try {
    const doc = await db.collection('stockData').doc(symbol).get();
    if (!doc.exists) {
      return null;
    }

    const data = doc.data();
    if (!data) {
      return null;
    }

    // Return the specific part of the document based on the function type.
    if (functionName === CloudFunctionName.GET_GLOBAL_QUOTE) {
      return (data.globalQuote as GlobalQuoteData) || null;
    }

    if (functionName === CloudFunctionName.GET_DAILY_STOCK_DATA_SIMPLE) {
      // For daily data, the document itself is the data we need.
      return data as StoredStockData;
    }

    return null;
  } catch (error) {
    console.error(`Error getting stock data for ${symbol}:`, error);
    throw new Error('Could not retrieve stock data from Firestore.');
  }
}
