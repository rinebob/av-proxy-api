import * as admin from 'firebase-admin';
import { db } from '../../firebase-admin-init';
import { Timestamp, DocumentData, Query } from 'firebase-admin/firestore';
import { 
  TRACKED_SYMBOLS 
} from '../../common/firestore-collections';
import {
  TrackedSymbol,
  SymbolSyncRequest,
  SymbolSyncResponse,
  ListSymbolsOptions,
  ListSymbolsResponse
} from '../../common/common-dm';

/**
 * Service for managing symbols in the system
 */
export class SymbolManagerService {
  /**
   * Creates a new instance of SymbolManagerService
   */
  constructor() {}

  // Batch size for Firestore operations (for future use)
  // private static readonly BATCH_SIZE = 500;
  /**
   * Ensures a value is a Firestore Timestamp
   */
  private ensureTimestamp(value: Timestamp | Date | string | number | undefined): Timestamp {
    try {
      if (value instanceof Timestamp) {
        return value;
      } else if (value instanceof Date) {
        return Timestamp.fromDate(value);
      } else if (value === undefined) {
        // If no timestamp provided, create a new one
        return Timestamp.now();
      } else if (typeof value === 'string' || typeof value === 'number') {
        return Timestamp.fromMillis(new Date(value).getTime());
      }
      throw new Error('Invalid timestamp value');
    } catch (error) {
      console.error('Error ensuring timestamp:', error);
      // Fallback to current time if there's any error
      return Timestamp.now();
    }
  }

  /**
   * Normalizes symbol strings (uppercase and trim)
   */
  private normalizeSymbols(symbols: string[]): string[] {
    return symbols.map(s => s.trim().toUpperCase()).filter(Boolean);
  }

  /**
   * Syncs symbols from a client site with the central tracking system
   * @param request - The sync request containing client and symbol information
   * @returns A promise that resolves to the sync response
   * @throws {Error} If the request is invalid or an error occurs during processing
   */
  async syncSymbols(request: SymbolSyncRequest): Promise<SymbolSyncResponse> {
    const { symbols, timestamp } = request;
    
    if (!Array.isArray(symbols)) {
      throw new Error('Invalid request: symbols array is required');
    }

    const normalizedSymbols = this.normalizeSymbols(symbols);
    if (normalizedSymbols.length === 0) {
      return {
        success: true,
        added: 0,
        removed: 0,
        totalActive: 0,
        timestamp: this.ensureTimestamp(timestamp)
      };
    }

    const batch = db.batch();
    const now = this.ensureTimestamp(timestamp);

    // Track added symbols
    const addedSymbols: string[] = [];

    // Process each symbol
    const symbolPromises = normalizedSymbols.map(async (symbol) => {
      const symbolRef = db.collection(TRACKED_SYMBOLS).doc(symbol);
      
      const symbolData: Partial<TrackedSymbol> = {
        symbol,
        isActive: true,
        lastUpdated: now,
        createdAt: now,
      };

      batch.set(symbolRef, symbolData, { merge: true });
      
      return symbol;
    });

    await Promise.all(symbolPromises);
    addedSymbols.push(...normalizedSymbols);

    try {
      await batch.commit();
      
      // Count total active symbols
      const totalActive = await this.countActiveSymbols();
      
      return {
        success: true,
        added: addedSymbols.length,
        removed: 0,
        totalActive,
        timestamp: now
      };
    } catch (error) {
      console.error('Error syncing symbols:', error);
      throw new Error('Failed to sync symbols');
    }
  }

  /**
   * Lists symbols with pagination and filtering options
   * @param options - Options for filtering, sorting, and pagination
   * @returns A promise that resolves to the list of symbols and pagination info
   * @throws {Error} If an error occurs during the operation
   */
  async listSymbols(options: ListSymbolsOptions = {}): Promise<ListSymbolsResponse> {
    const { 
      activeOnly = true, 
      limit = 100, 
      offset = 0, 
      sortBy = 'symbol', 
      sortDirection = 'asc' 
    } = options;

    try {
      const collectionRef = db.collection(TRACKED_SYMBOLS);
      let query: Query<DocumentData> = collectionRef;
      
      if (activeOnly) {
        query = query.where('isActive', '==', true);
      }
      
      // Get total count
      const countSnapshot = await query.count().get();
      const total = countSnapshot.data().count;
      
      // Apply sorting and pagination
      const paginatedQuery = query
        .orderBy(sortBy, sortDirection)
        .offset(offset)
        .limit(limit);
      
      const snapshot = await paginatedQuery.get();
      const symbols = snapshot.docs.map(doc => {
        const data = doc.data() as Omit<TrackedSymbol, 'id'>;
        // Convert Firestore Timestamp to JavaScript Date if needed
        const lastUpdated = data.lastUpdated ? (data.lastUpdated as any).toDate ? (data.lastUpdated as any).toDate() : new Date(data.lastUpdated as any) : null;
        
        return {
          ...data,
          id: doc.id,
          lastUpdated: lastUpdated
        } as TrackedSymbol;
      });
      
      return {
        symbols,
        total,
        limit,
        offset
      };
    } catch (error) {
      console.error('Error listing symbols:', error);
      throw new Error('Failed to list symbols');
    }
  }

  /**
   * Retrieves a single tracked symbol by its symbol string
   * @param symbol - The symbol to retrieve (case-insensitive)
   * @returns A promise that resolves to the TrackedSymbol or null if not found
   * @throws {Error} If the symbol parameter is invalid or an error occurs
   */
  async getSymbol(symbol: string): Promise<TrackedSymbol | null> {
    if (!symbol || typeof symbol !== 'string') {
      throw new Error('Symbol must be a non-empty string');
    }

    try {
      const doc = await db.collection(TRACKED_SYMBOLS)
        .doc(symbol.toUpperCase())
        .get();

      if (!doc.exists) {
        return null;
      }

      const data = doc.data() as Omit<TrackedSymbol, 'id'>;
      // Convert Firestore Timestamp to JavaScript Date if needed
      const lastUpdated = data.lastUpdated ? (data.lastUpdated as any).toDate ? (data.lastUpdated as any).toDate() : new Date(data.lastUpdated as any) : null;
      const createdAt = data.createdAt ? (data.createdAt as any).toDate ? (data.createdAt as any).toDate() : new Date(data.createdAt as any) : null;

      return {
        ...data,
        id: doc.id,
        lastUpdated,
        createdAt
      } as TrackedSymbol;
    } catch (error) {
      console.error(`Error getting symbol ${symbol}:`, error);
      throw new Error('Failed to retrieve symbol');
    }
  }

  /**
   * Counts the number of active symbols
   * @returns A promise that resolves to the count of active symbols
   */
  private async countActiveSymbols(): Promise<number> {
    try {
      const snapshot = await db.collection(TRACKED_SYMBOLS)
        .where('isActive', '==', true)
        .get();

      return snapshot.docs.length;
    } catch (error) {
      console.error('Error counting active symbols:', error);
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
    const symbolRef = db.collection(TRACKED_SYMBOLS).doc(symbol);
    
    return await db.runTransaction(async (transaction) => {
      const symbolDoc = await transaction.get(symbolRef);
      
      if (!symbolDoc.exists) {
        return { success: false, message: `Symbol ${symbol} not found` };
      }
      
      // We don't need the symbol data, just checking if it exists
      // The type assertion is safe here because we've already checked doc.exists
      const symbolData = symbolDoc.data() as TrackedSymbol | undefined;
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
    console.error(`Error removing symbol ${symbol}:`, error);
    return {
      success: false,
      message: `Failed to remove symbol: ${error instanceof Error ? error.message : 'Unknown error'}`
    };
  }
}
