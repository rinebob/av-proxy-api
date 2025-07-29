import * as admin from 'firebase-admin';
import { db } from '../../../firebase-admin-init';
import { DocumentData, Query } from 'firebase-admin/firestore';
import { FirestoreCollection } from '../../common/firestore/firestore-collections';
import {
    ListSymbolsOptions,
    ListSymbolsV2Response,
    toTrackedSymbolV2,
    TRACKED_SYMBOL_V2_FIELDS,
    TrackedSymbolV2
} from '../../common/common-dm';

/**
 * Service for managing symbols in the system
 */
export class SymbolManagerService {
  /**
   * Creates a new instance of SymbolManagerService
   */
  constructor() {}

  /**
   * Retrieves a single tracked symbol by its symbol string
   * @param symbol - The symbol to retrieve (case-insensitive)
   * @returns A promise that resolves to the TrackedSymbol or null if not found
   * @throws {Error} If the symbol parameter is invalid or an error occurs
   */
  async getSymbol(symbol: string): Promise<TrackedSymbolV2 | null> {
    if (!symbol || typeof symbol !== 'string') {
      throw new Error('Symbol must be a non-empty string');
    }

    try {
      const doc = await db.collection(FirestoreCollection.TRACKED_SYMBOLS)
        .doc(symbol.toUpperCase())
        .get();

      if (!doc.exists) {
        return null;
      }

      const data = doc.data() as Omit<TrackedSymbolV2, 'id'>;
      // Convert Firestore Timestamp to JavaScript Date if needed
      const _lastUpdated = data._lastUpdated ? (data._lastUpdated as any).toDate ? (data._lastUpdated as any).toDate() : new Date(data._lastUpdated as any) : null;
      const _createdAt = data._createdAt ? (data._createdAt as any).toDate ? (data._createdAt as any).toDate() : new Date(data._createdAt as any) : null;

      return {
        ...data,
        id: doc.id,
        _lastUpdated,
        _createdAt
      } as TrackedSymbolV2;
    } catch (error) {
      console.error(`sMSvc gS [SymbolManager] Error getting symbol ${symbol}:`, error);
      throw new Error('Failed to retrieve symbol');
    }
  }

  /**
   * Counts the number of active symbols
   * @returns A promise that resolves to the count of active symbols
   */
  async countActiveSymbols(): Promise<number> {
    try {
      const snapshot = await db.collection(FirestoreCollection.TRACKED_SYMBOLS)
        .where('isActive', '==', true)
        .get();

      return snapshot.docs.length;
    } catch (error) {
      console.error('sMSvc cAS [SymbolManager] Error counting active symbols:', error);
      throw new Error('Failed to count active symbols');
    }
  }

  /**
   * Removes a symbol from the system
   * @param symbol - The symbol to remove
   * @param clientId - Optional client ID to track which client removed the symbol
   * @param timestamp - Optional timestamp for the removal
   */
  async removeSymbol(
    symbol: string,
    clientId?: string,
    timestamp?: admin.firestore.Timestamp
  ): Promise<{ success: boolean; message: string }> {
    try {
      const now = timestamp || admin.firestore.Timestamp.now();
      const symbolRef = db.collection(FirestoreCollection.TRACKED_SYMBOLS).doc(symbol);
      
      return await db.runTransaction(async (transaction) => {
        const symbolDoc = await transaction.get(symbolRef);
        
        if (!symbolDoc.exists) {
          return { success: false, message: `Symbol ${symbol} not found` };
        }
        
        // We don't need the symbol data, just checking if it exists
        // The type assertion is safe here because we've already checked doc.exists
        const symbolData = symbolDoc.data() as TrackedSymbolV2 | undefined;
        if (!symbolData) {
          return { success: false, message: `Symbol ${symbol} has no data` };
        }
        
        if (clientId) {
          // If clientId is provided, just mark the symbol as inactive
          transaction.update(symbolRef, {
            isActive: false,
            lastUpdated: now,
            clientId
          });
          return { success: true, message: `Symbol ${symbol} marked as inactive` };
        } else {
          // If no clientId, delete the symbol entirely
          transaction.delete(symbolRef);
          return { success: true, message: `Symbol ${symbol} removed` };
        }
      });
    } catch (error) {
      console.error(`sMSvc rS [SymbolManager] Error removing symbol ${symbol}:`, error);
      return {
        success: false,
        message: `Failed to remove symbol: ${error instanceof Error ? error.message : 'Unknown error'}`
      };
    }
  }

  /**
   * Cleans up inactive symbols older than the specified number of days
   * @param daysInactive - Number of days of inactivity before a symbol is removed
   * @returns Object containing the number of deactivated symbols
   */
  async cleanupInactiveSymbols(daysInactive: number): Promise<{ deactivated: number }> {
    try {
      const cutoffDate = admin.firestore.Timestamp.fromMillis(
        Date.now() - daysInactive * 24 * 60 * 60 * 1000
      );

      const inactiveSymbols = await db.collection(FirestoreCollection.TRACKED_SYMBOLS)
        .where('isActive', '==', false)
        .where('lastUpdated', '<', cutoffDate)
        .get();

      const batch = db.batch();
      inactiveSymbols.docs.forEach(doc => {
        batch.delete(doc.ref);
      });

      await batch.commit();
      return { deactivated: inactiveSymbols.size };
    } catch (error) {
      console.error('sMSvc cIS [SymbolManager] Error cleaning up inactive symbols:', error);
      throw new Error('Failed to clean up inactive symbols');
    }
  }

    ////////////////////// V2 METHODS //////////////////////////

    /**
     * Lists symbols with pagination and filtering options
     * @param options - Options for filtering, sorting, and pagination
     * @returns A promise that resolves to the list of symbols and pagination info
     * @throws {Error} If an error occurs during the operation
     */
    async listSymbolsV2(options: ListSymbolsOptions = {}): Promise<ListSymbolsV2Response> {
      const {
        activeOnly = true,
        limit = 100,
        offset = 0,
        sortBy = TRACKED_SYMBOL_V2_FIELDS.SYMBOL,
        sortDirection = 'asc',
      } = options;

        console.log('sMSvc lSV2 begin listSymbolsV2.options: ', options);

      try {
        const collectionRef = db.collection(FirestoreCollection.TRACKED_SYMBOLS);
        let query: Query<DocumentData> = collectionRef;

        if (activeOnly) {
          query = query.where(TRACKED_SYMBOL_V2_FIELDS.IS_ACTIVE, '==', true);
        }

        // Get total count
        const countSnapshot = await query.count().get();
        const total = countSnapshot.data().count;

        // Map sortBy (from UI or API) to canonical Firestore field
        const sortField =
          Object.values(TRACKED_SYMBOL_V2_FIELDS).includes(sortBy)
            ? sortBy
            : TRACKED_SYMBOL_V2_FIELDS.SYMBOL; // fallback to symbol if invalid

        // Apply sorting and pagination
        const paginatedQuery = query
          .orderBy(sortField, sortDirection)
          .offset(offset)
          .limit(limit);

        const snapshot = await paginatedQuery.get();

        const symbols = snapshot.docs.map(doc => toTrackedSymbolV2(doc.data()));

        console.log('sMSvc lSV2 final symbols: ', symbols);

        return {
          symbols,
          total,
          limit,
          offset,
        };
      } catch (error) {
        console.error('sMSvc lSV2 [SymbolManager] Error listing symbols:', error);
        throw new Error('Failed to list symbols');
      }
    }
}

// Create an instance of the service
export const symbolManagerService = new SymbolManagerService();