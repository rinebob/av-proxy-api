// functions/src/alpha-vantage/av-firestore-helpers.ts
import { db } from '../firebase-admin-init';
import { AlphaVantageFunctionName } from '../common/common-fn';
import {
  AlphaVantageDailyTimeSeriesResponse,
  DailyTimeSeriesData,
  DailyTimeSeriesDataTwo,
  GlobalQuoteData,
  StoredStockData,
  TimeSeriesMetaDataTwo
} from '../common/common-av';
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
  functionName: AlphaVantageFunctionName
): Promise<void> {
  console.info('----------- avFsHelpers saveStockData ---------------');
  console.log(`aFH sSD Firestore project: ${process.env.GCLOUD_PROJECT || process.env.GOOGLE_CLOUD_PROJECT}`);
  if (!symbol) {
    throw new Error('aFH sSD Symbol is required to save stock data.');
  }
  const collectionRef = db.collection('stockData');
  console.log(`aFH sSD colln ref: ${Object.keys(collectionRef)}`);
  
  const docRef = db.collection('stockData').doc(symbol);
  console.log(`aFH sSD doc ref: ${Object.keys(docRef)}`);

  let dataToSave;
  if (functionName === AlphaVantageFunctionName.GET_GLOBAL_QUOTE) {
    // For global quotes, save the data inside a 'globalQuote' field to avoid overwriting daily data.
    dataToSave = { globalQuote: data, lastUpdatedGlobalQuote: FieldValue.serverTimestamp() };
  } else {
    // For daily data, the data object is already structured correctly.
    dataToSave = data;
  }

  
  const size = Buffer.byteLength(JSON.stringify(dataToSave));
  console.log(`aFH sSD Size of dataToSave: ${size} bytes`);

  console.log(`aFH sSD setting doc with data to save: ${JSON.stringify(dataToSave)}`);

  // New: Try create/edit logic instead of set()
  let docSnap;
  try {
    console.log(`aFH sSD getting docSnap`);
    docSnap = await docRef.get();
    console.log(`aFH sSD doc snap: ${JSON.stringify(docSnap)}`);
  } catch (getErr) {
    console.error(`aFH sSD [${symbol}] Firestore READ docRef.get() FAILED:`, getErr);
    // Fall back to set() immediately if get() fails
    try {
      console.log(`aFH sSD [${symbol}] About to SET doc with:`, JSON.stringify(dataToSave));
      await docRef.set(dataToSave, { merge: true });
      console.log(`aFH sSD [${symbol}] Firestore WRITE: Successfully saved data for ${symbol} (${functionName}) to Firestore (after get() failure).`);
    } catch (setErr) {
      console.error(`aFH sSD [${symbol}] Firestore WRITE set() FAILED after get() failure:`, setErr);
      throw setErr;
    }
    return;
  }
  try {
    if (!docSnap.exists) {
      // Document does not exist: create it
      console.log(`aFH sSD [${symbol}] Firestore WRITE: Creating new Firestore doc.`);
      console.log(`aFH sSD [${symbol}] About to CREATE doc with:`, JSON.stringify(dataToSave));
      await docRef.create(dataToSave as { [x: string]: any });
      console.log(`aFH sSD [${symbol}] Firestore WRITE: Created new doc for ${functionName}.`);
    } else {
      // Document exists: update it
      console.log(`aFH sSD [${symbol}] Firestore WRITE: Updating existing Firestore doc.`);
      console.log(`aFH sSD [${symbol}] About to UPDATE doc with:`, JSON.stringify(dataToSave));
      await docRef.update(dataToSave as { [x: string]: any });
      console.log(`aFH sSD [${symbol}] Firestore WRITE: Updated existing doc for ${functionName}.`);
    }
    console.info('docSnap exists');
    return;
  } catch (err) {
    // If create/update fails for any reason, fall back to set()
    console.error(`aFH sSD [${symbol}] Firestore WRITE create/update FAILED, falling back to set():`, err);
  }

  // Fallback: set() as before
  try {
    await docRef.set(dataToSave, { merge: true });
    console.log(`aFH sSD [${symbol}] Firestore WRITE: Successfully saved data for ${symbol} (${functionName}) to Firestore.`);
  } catch (setErr) {
    console.error(`aFH sSD [${symbol}] Firestore WRITE set() FAILED:`, setErr);
    throw setErr;
  }
}

/**
 * Retrieves a specific type of stock data from a Firestore document.
 * @param symbol The stock symbol.
 * @param functionName The type of data to retrieve (e.g., global quote or daily data).
 * @returns The requested data, or null if not found.
 */
export async function getStockData(
  symbol: string,
  functionName: AlphaVantageFunctionName
): Promise<StoredStockData | GlobalQuoteData | null> {
  try {
    const doc = await db.collection('stockData').doc(symbol).get();
    if (!doc.exists) {
      console.warn(`aFH gSD [${symbol}] Firestore READ cache miss (NOT_FOUND): Document does not exist.`);
      return null;
    }

    const data = doc.data();
    if (!data) {
      console.warn(`aFH gSD [${symbol}] Firestore READ cache miss (NOT_FOUND): Data is undefined/null.`);
      return null;
    }

    // Return the specific part of the document based on the function type.
    if (functionName === AlphaVantageFunctionName.GET_GLOBAL_QUOTE) {
      // No globalQuote field is a READ cache miss for global quote
      if (!data.globalQuote) {
        console.warn(`aFH gSD [${symbol}] Firestore READ cache miss (NOT_FOUND): globalQuote field missing.`);
        return null;
      }
      return data.globalQuote as GlobalQuoteData;
    }

    if (functionName === AlphaVantageFunctionName.GET_DAILY_STOCK_DATA_SIMPLE) {
      // For daily data, the document itself is the data we need.
      return data as StoredStockData;
    }

    return null;
  } catch (error: any) {
    // Firestore 'not found' (gRPC code 5) should be treated as a cache miss, not an error
    if (error && (error.code === 5 || error.code === 'NOT_FOUND')) {
      console.warn(`aFH gSD [${symbol}] Firestore READ cache miss (NOT_FOUND):`, error);
      return null;
    }
    // Log and treat all other errors as cache miss (but log them for debugging)
    console.error(`aFH gSD [${symbol}] Firestore READ error (UNEXPECTED):`, error);
    return null;
  }
}
