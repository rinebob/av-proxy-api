// This must be the first import to ensure Firebase is initialized.
import { db } from '../../../firebase-admin-init';
import { Timestamp } from 'firebase-admin/firestore';
import { onCall } from 'firebase-functions/v2/https';

import { FirestoreCollection } from '@shared/firestore';
import { TrackedSymbolV2 } from '@shared/alpha-vantage';
import { SaveTrackedSymbolResponse } from '@shared/alpha-vantage';

/**
 * HTTP Cloud Function to save a tracked symbol to Firestore.
 * 
 * The frontend sends a TrackedSymbol object, and this function wraps it with metadata
 * before saving to Firestore in the format: { data: TrackedSymbol, metadata: TrackedSymbolMetadata }
 * 
 * @example
 * ```typescript
 * // Frontend call
 * const response = await saveTrackedSymbol({
 *   symbol: 'AAPL',
 *   name: 'Apple Inc.',
 *   type: 'Equity',
 *   // ... other TrackedSymbol fields
 * });
 * ```
 */
export const saveTrackedSymbol = onCall<Omit<TrackedSymbolV2, '_createdAt' | '_lastUpdated'>, Promise<SaveTrackedSymbolResponse>>(
  { cors: true },
  async (request) => {
    const functionName = 'saveTrackedSymbol';
    const startTime = Date.now();
    const requestId = Math.random().toString(36).substring(2, 10);

    try {
      // Verify authentication - callable functions automatically verify the token
      if (!request.auth) {
        throw new Error('Unauthenticated');
      }
      
      const symbolData = request.data;
      
      if (!symbolData?.symbol) {
        throw new Error('Symbol is required');
      }

      // Prepare the document data with metadata
      const now = Timestamp.now();

      // Log the request
      console.log(`[${functionName}] [${requestId}] Request received`, {
        auth: request.auth.uid ? 'authenticated' : 'unauthenticated',
        symbol: symbolData?.symbol,
        data: symbolData,
        now: now
      });

      const docRef = db
        .collection(FirestoreCollection.TRACKED_SYMBOLS)
        .doc(symbolData.symbol.toUpperCase());

      // Create the document to save with data and metadata
      const documentToSave: TrackedSymbolV2 = {
        ...symbolData,
        _createdAt: now,
        _lastUpdated: now,
        _isActive: true
      };

      // Save to Firestore
      await docRef.set(documentToSave, { merge: true });

      console.log(`[${functionName}] [${requestId}] Symbol saved successfully`, {
        symbol: symbolData.symbol,
        durationMs: Date.now() - startTime
      });

      return {
        success: true,
        symbol: symbolData.symbol,
        message: 'Symbol saved successfully'
      };

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      console.error(`[${functionName}] [${requestId}] Error saving symbol`, {
        error: errorMessage,
        stack: error instanceof Error ? error.stack : undefined,
        durationMs: Date.now() - startTime
      });

      return {
        success: false,
        symbol: request.data?.symbol || 'unknown',
        error: errorMessage,
        message: `Failed to save symbol: ${errorMessage}`
      };
    }
  }
);
