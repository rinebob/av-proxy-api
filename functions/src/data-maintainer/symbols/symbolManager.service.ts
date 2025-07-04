import { db } from '../../firebase-admin-init';
import { Timestamp, FieldValue, DocumentData, Query } from 'firebase-admin/firestore';
import { 
  TRACKED_SYMBOLS, 
  CLIENT_SITES, 
  SYMBOL_REQUESTS 
} from '../../common/firestore-collections';
import {
  TrackedSymbol,
  ClientSite,
  SymbolSyncRequest,
  SymbolSyncResponse,
  ListSymbolsOptions,
  ListSymbolsResponse,
  ClientSource
} from '../../common/common-dm';

// Using direct FieldValue access where needed instead of a constant

/**
 * Service for managing symbols in the system
 */
export class SymbolManagerService {
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
   * Creates a client source object with proper typing
   * @param clientId - The unique identifier for the client
   * @param timestamp - The timestamp for the client source (can be Date, Timestamp, string, or number)
   * @param metadata - Optional metadata to include with the client source
   * @returns A properly typed ClientSource object
   */
  private createClientSource(
    clientId: string, 
    timestamp: Timestamp | Date | string | number,
    metadata: Record<string, unknown> = {}
  ): ClientSource {
    const now = Timestamp.now();
    
    return {
      clientId,
      firstSeen: this.ensureTimestamp(timestamp),
      lastSeen: now,
      metadata
    };
  }

  /**
   * Syncs symbols from a client site with the central tracking system
   * @param request - The sync request containing client and symbol information
   * @returns A promise that resolves to the sync response
   * @throws {Error} If the request is invalid or an error occurs during processing
   */
  /**
   * Syncs symbols from a client site with the central tracking system
   * @param request - The sync request containing client and symbol information
   * @returns A promise that resolves to the sync response
   * @throws {Error} If the request is invalid or an error occurs during processing
   */
  async syncSymbols(request: SymbolSyncRequest): Promise<SymbolSyncResponse> {
    const { clientId, clientName, symbols, timestamp, metadata } = request;
    
    if (!clientId || !Array.isArray(symbols)) {
      throw new Error('Invalid request: clientId and symbols array are required');
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
    const clientSource = this.createClientSource(clientId, now, metadata);
    const clientRef = db.collection(CLIENT_SITES).doc(clientId);
    
    // Update client site document
    const clientUpdate: Partial<ClientSite> = {
      id: clientId,
      name: clientName || clientId,
      lastActive: now,
      symbolCount: normalizedSymbols.length,
      updatedAt: now,
      isActive: true
    };

    if (!clientName) {
      clientUpdate.createdAt = now;
    }

    batch.set(clientRef, clientUpdate, { merge: true });

    // Track added symbols
    const addedSymbols: string[] = [];
    
    for (const symbol of normalizedSymbols) {
      const symbolRef = db.collection(TRACKED_SYMBOLS).doc(symbol);
      
      const symbolData: Partial<TrackedSymbol> = {
        symbol,
        isActive: true,
        lastUpdated: now,
        createdAt: now
      };

      batch.set(
        symbolRef,
        {
          ...symbolData,
          sources: FieldValue.arrayUnion(clientSource)
        },
        { merge: true }
      );
      
      addedSymbols.push(symbol);
    }

    // Create a record of this sync request
    const syncRequestRef = db.collection(SYMBOL_REQUESTS).doc();
    batch.set(syncRequestRef, {
      clientId,
      timestamp: now,
      symbolCount: normalizedSymbols.length,
      symbols: normalizedSymbols,
      metadata
    });

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
        return {
          ...data,
          id: doc.id
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
        .doc(symbol.trim().toUpperCase())
        .get();

      if (!doc.exists) {
        return null;
      }

      const data = doc.data() as Omit<TrackedSymbol, 'id'>;
      return {
        ...data,
        id: doc.id
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
   * Cleans up inactive symbols that haven't been seen in the specified number of days
   * @param daysInactive - Number of days of inactivity before a symbol is considered inactive (default: 30)
   * @returns A promise that resolves to an object containing the number of deactivated symbols
   */
  public async cleanupInactiveSymbols(daysInactive = 30): Promise<{ deactivated: number }> {
    const now = Timestamp.now();
    const cutoffDate = new Date(now.toDate().getTime() - daysInactive * 24 * 60 * 60 * 1000);
    const cutoffTimestamp = Timestamp.fromDate(cutoffDate);
    
    try {
      const snapshot = await db.collection(TRACKED_SYMBOLS)
        .where('isActive', '==', true)
        .where('lastSeen', '<', cutoffTimestamp)
        .get();

      const batch = db.batch();
      let count = 0;

      snapshot.docs.forEach(doc => {
        batch.update(doc.ref, { 
          isActive: false,
          deactivatedAt: FieldValue.serverTimestamp()
        });
        count++;
      });

      if (count > 0) {
        await batch.commit();
      }

      return { deactivated: count };
    } catch (error) {
      console.error('Error cleaning up inactive symbols:', error);
      throw new Error('Failed to clean up inactive symbols');
    }
  }
}

export const symbolManagerService = new SymbolManagerService();
