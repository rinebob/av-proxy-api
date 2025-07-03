import * as admin from 'firebase-admin';
import { db } from '../../firebase-admin-init';
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
  private ensureTimestamp(value: admin.firestore.Timestamp | Date | string | number): admin.firestore.Timestamp {
    if (value instanceof admin.firestore.Timestamp) {
      return value;
    } else if (value instanceof Date) {
      return admin.firestore.Timestamp.fromDate(value);
    } else if (typeof value === 'string' || typeof value === 'number') {
      return admin.firestore.Timestamp.fromMillis(new Date(value).getTime());
    }
    throw new Error('Invalid timestamp value');
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
    timestamp: admin.firestore.Timestamp | Date | string | number,
    metadata: Record<string, unknown> = {}
  ): ClientSource {
    const now = admin.firestore.Timestamp.now();
    const ts = this.ensureTimestamp(timestamp);
    
    return {
      clientId,
      firstSeen: ts,
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
    const now = admin.firestore.Timestamp.now();
    const clientSource = this.createClientSource(clientId, timestamp, metadata);
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
          sources: admin.firestore.FieldValue.arrayUnion(clientSource)
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
      const collectionRef = db.collection(TRACKED_SYMBOLS) as admin.firestore.CollectionReference<admin.firestore.DocumentData>;
      let query: admin.firestore.Query<admin.firestore.DocumentData> = collectionRef;
      
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
   * Deactivates symbols that haven't been seen in the specified number of days
   */
  async cleanupInactiveSymbols(daysInactive = 30): Promise<{ deactivated: number }> {
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - daysInactive);
    
    const cutoffTimestamp = admin.firestore.Timestamp.fromDate(cutoffDate);
    
    try {
      const snapshot = await db.collection(TRACKED_SYMBOLS)
        .where('isActive', '==', true)
        .where('lastUpdated', '<', cutoffTimestamp)
        .get();
      
      const batch = db.batch();
      const now = admin.firestore.Timestamp.now();
      
      snapshot.docs.forEach(doc => {
        batch.update(doc.ref, {
          isActive: false,
          deactivatedAt: now,
          updatedAt: now
        });
      });
      
      await batch.commit();
      
      return { deactivated: snapshot.size };
    } catch (error) {
      console.error('Error cleaning up inactive symbols:', error);
      throw new Error('Failed to clean up inactive symbols');
    }
  }

  /**
   * Counts the number of active symbols
   */
  private async countActiveSymbols(): Promise<number> {
    const snapshot = await db.collection(TRACKED_SYMBOLS)
      .where('isActive', '==', true)
      .count()
      .get();
    
    return snapshot.data().count;
  }
}

export const symbolManagerService = new SymbolManagerService();
