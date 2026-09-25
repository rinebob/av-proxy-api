// This must be the first import to ensure Firebase is initialized.
import { db } from '../../../firebase-admin-init';
import { Timestamp } from 'firebase-admin/firestore';
import { onCall } from 'firebase-functions/v2/https';

import { FirestoreCollection } from '@shared/firestore';
import { TrackedSymbolV2 } from '@shared/alpha-vantage';
import { SaveTrackedSymbolResponse } from '@shared/alpha-vantage';
import { enqueueSwingSetGeneration } from '../../swing-set/handlers/generate-swing-sets.core';
import { withOptionsFlagDefaults } from '../../symbol-flags/utils/options-flag-defaults';

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

      // Create the document to save with data and metadata.
      // §76: apply optionsEnabled=false + optionsEnabledHistory=[] defaults
      // when neither the payload nor the existing doc carries them.
      // +1 doc read per save; the get()→set() window could clobber a
      // concurrent curator toggle — narrow, same accepted risk as
      // OptionableProbeService.persist().
      const existingSnap = await docRef.get();
      const documentToSave: TrackedSymbolV2 = withOptionsFlagDefaults(
        {
          ...symbolData,
          _createdAt: now,
          _lastUpdated: now,
          _isActive: true
        },
        existingSnap.exists ? existingSnap.data() : undefined,
      );

      // Save to Firestore
      await docRef.set(documentToSave, { merge: true });

      // Enqueue swing-set generation when the saved payload enables options
      // (Task #126; Thread #105 owns the full flag lifecycle). The helper
      // re-checks the persisted flag and the task freshness-gates repeated
      // saves, so this is safe on every write. Enqueue failure must not fail
      // the save — the sweep (#127) covers any missed signal.
      if (symbolData.optionsEnabled === true) {
        try {
          await enqueueSwingSetGeneration(db, symbolData.symbol);
        } catch (e) {
          console.warn(`[${functionName}] [${requestId}] swing-set generation enqueue failed`, {
            symbol: symbolData.symbol,
            error: e instanceof Error ? e.message : String(e),
          });
        }
      }

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
