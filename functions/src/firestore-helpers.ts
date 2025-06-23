// functions/src/firestore-helpers.ts
import { db } from './utils';
import {
  AlphaVantageDailyTimeSeriesResponse,
  DailyTimeSeriesData,
  DailyTimeSeriesDataTwo,
  StoredStockData,
  TimeSeriesMetaDataTwo,
} from './common-fn';
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
 * Saves the transformed stock data to Firestore.
 * @param symbol The stock symbol, used as the document ID.
 * @param data The transformed stock data to save.
 */
export async function saveStockData(
  symbol: string,
  data: StoredStockData
): Promise<void> {
  if (!symbol) {
    throw new Error('Symbol is required to save stock data.');
  }
  const docRef = db.collection('stockData').doc(symbol);
  await docRef.set(data, { merge: true });
  console.log(`Successfully saved data for ${symbol} to Firestore.`);
}

/**
 * Retrieves stock data from Firestore.
 * @param symbol The stock symbol.
 * @param limit Optional limit for the number of time series entries to return.
 * @returns The stored stock data, or null if not found.
 */
export async function getStockData(
  symbol: string,
  limit?: number
): Promise<StoredStockData | null> {
  try {
    const doc = await db.collection('stockData').doc(symbol).get();
    if (!doc.exists) {
      return null;
    }

    const data = doc.data() as StoredStockData;

    if (limit && data.timeSeriesDaily) {
      data.timeSeriesDaily = data.timeSeriesDaily.slice(0, limit);
    }
    if (limit && data.timeSeriesDailyAdjusted) {
      data.timeSeriesDailyAdjusted = data.timeSeriesDailyAdjusted.slice(
        0,
        limit
      );
    }

    return data;
  } catch (error) {
    console.error(`Error getting stock data for ${symbol}:`, error);
    throw new Error('Could not retrieve stock data from Firestore.');
  }
}