import { db } from '../../../firebase-admin-init';
import { Timestamp } from 'firebase-admin/firestore';
import { AlphaVantageEndpoint } from '@shared/alpha-vantage';
import { 
  AvHistoricalOptionsResponse, 
  SvtHistoricalOptionsDocument,
  SvtOptionsAnalysis 
} from '@shared/alpha-vantage/av-historical-options';
import { isManualWriteEnabled } from '../../common/firestore/manual-write-toggle';
import { FirestoreCollection } from '@shared/firestore';
import { ApiProvider } from '@shared/core';

/**
 * Saves historical options data and analysis to Firestore
 * - Respects the manual Firestore write toggle
 * - Writes only if the symbol exists in the tracked symbols list
 * @param symbol - The stock symbol (e.g., 'AAPL')
 * @param expiration - The expiration date in 'YYYY-MM-DD' format
 * @param response - The raw API response from Alpha Vantage
 * @param analysis - The analyzed options data
 * @param endpoint - The Alpha Vantage endpoint (default: HISTORICAL_OPTIONS)
 * @param checkManualWriteEnabled - If true, checks if manual writes are enabled before saving
 */
export async function saveAvHistoricalOptions(
  symbol: string,
  expiration: string,
  response: AvHistoricalOptionsResponse,
  analysis: SvtOptionsAnalysis,
  endpoint: AlphaVantageEndpoint = AlphaVantageEndpoint.HISTORICAL_OPTIONS,
  checkManualWriteEnabled: boolean = true
): Promise<void> {
  console.log(`[saveAvHistoricalOptions] Saving options data for ${symbol} (${expiration})`);

  try {
    // 1. Prepare document path
    const docPath = `${FirestoreCollection.SYMBOL_DATA}/${symbol}/${FirestoreCollection.OPTIONS}/${expiration}`;
    const docRef = db.doc(docPath);

    // 2. Check manual Firestore write enabled if required
    if (checkManualWriteEnabled) {
      const enabled = await isManualWriteEnabled();
      console.log(`[saveAvHistoricalOptions] Manual Firestore write toggle enabled?`, enabled);
      if (!enabled) {
        console.log('[saveAvHistoricalOptions] Manual Firestore write toggle is OFF. Skipping data write.');
        return;
      }
    }

    // 3. Ensure the symbol is tracked before writing
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

    // 4. Prepare document data
    const document: SvtHistoricalOptionsDocument = {
      symbol,
      expiration,
      dateRequested: Timestamp.now(),
      source: ApiProvider.ALPHA_VANTAGE,
      endpoint: AlphaVantageEndpoint.HISTORICAL_OPTIONS,
      response,
      analysis
    };

    // 5. Save to Firestore
    await docRef.set(document, { merge: true });
    console.log(`[saveAvHistoricalOptions] Saved options data for ${symbol} (${expiration}) at path: ${docPath}`);

  } catch (error) {
    console.error('[saveAvHistoricalOptions] Error saving options data to Firestore:', error);
    throw error;
  }
}

export { saveAvHistoricalOptions as saveOptionsData };
