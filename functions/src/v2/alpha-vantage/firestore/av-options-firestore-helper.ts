import { db } from '../../../firebase-admin-init';
import { Timestamp } from 'firebase-admin/firestore';
import { AlphaVantageEndpoint } from '@shared/alpha-vantage';
import { 
  AvHistoricalOptionsResponse, 
  SvtHistoricalOptionsDocument,
  SvtOptionsAnalysis 
} from '@shared/alpha-vantage/av-historical-options';
import { FirestoreCollection } from '@shared/firestore';
import { ApiProvider } from '@shared/core';

/**
 * Saves historical options data and analysis to Firestore
 * - Writes only if the symbol exists in the tracked symbols list
 * @param symbol - The stock symbol (e.g., 'AAPL')
 * @param expiration - The expiration date in 'YYYY-MM-DD' format
 * @param response - The raw API response from Alpha Vantage
 * @param analysis - The analyzed options data
 * @param endpoint - The Alpha Vantage endpoint (default: HISTORICAL_OPTIONS)
 */
export async function saveAvHistoricalOptions(
  symbol: string,
  expiration: string,
  response: AvHistoricalOptionsResponse,
  analysis: SvtOptionsAnalysis,
  endpoint: AlphaVantageEndpoint = AlphaVantageEndpoint.HISTORICAL_OPTIONS
): Promise<void> {
  console.log(`[saveAvHistoricalOptions] Saving options data for ${symbol} (${expiration})`);

  try {
    // 1. Prepare document path
    const docPath = `${FirestoreCollection.SYMBOL_DATA}/${symbol}/${FirestoreCollection.OPTIONS}/${expiration}`;
    const docRef = db.doc(docPath);

    // 2. Ensure the symbol is tracked before writing
    const symbolId = (symbol || '').trim().toUpperCase();
    if (!symbolId) {
      console.warn('[saveAvHistoricalOptions] Empty symbol after normalization. Skipping data write.');
      return;
    }
    const trackedDocRef = db.doc(`${FirestoreCollection.TRACKED_SYMBOLS}/${symbolId}`);
    const trackedSnap = await trackedDocRef.get();
    if (!trackedSnap.exists) {
      console.log(`[saveAvHistoricalOptions] Symbol ${symbolId} is not in tracked symbols. Skipping data write.`);
      return;
    }

    // 3. Prepare document data
    const document: SvtHistoricalOptionsDocument = {
      symbol,
      expiration,
      dateRequested: Timestamp.now(),
      source: ApiProvider.ALPHA_VANTAGE,
      endpoint: AlphaVantageEndpoint.HISTORICAL_OPTIONS,
      response,
      analysis
    };

    // 4. Save to Firestore
    await docRef.set(document, { merge: true });
    console.log(`[saveAvHistoricalOptions] Saved options data for ${symbol} (${expiration}) at path: ${docPath}`);

  } catch (error) {
    console.error('[saveAvHistoricalOptions] Error saving options data to Firestore:', error);
    throw error;
  }
}

export { saveAvHistoricalOptions as saveOptionsData };
