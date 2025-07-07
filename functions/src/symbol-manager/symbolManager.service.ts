import * as admin from 'firebase-admin';
import { db } from '../firebase-admin-init';
import { Timestamp, DocumentData, Query, FieldValue } from 'firebase-admin/firestore';
import { AvSymbolSearchHandler } from '../data-maintainer/api-handlers/av-symbol-search';
import { FirestoreCollection } from '../common/firestore-collections';
import {
  TrackedSymbol,
  SymbolSyncRequest,
  SymbolSyncResponse,
  ListSymbolsOptions,
  ListSymbolsResponse
} from '../common/common-dm';

/**
 * Service for managing symbols in the system
 */
export class SymbolManagerService {
  private symbolSearchHandler: AvSymbolSearchHandler;
  
  /**
   * Creates a new instance of SymbolManagerService
   */
  constructor() {
    this.symbolSearchHandler = new AvSymbolSearchHandler();
  }

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
    const { symbols, timestamp, remove = false } = request;
    
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

    // Track added/removed symbols
    const processedSymbols: string[] = [];
    let removedCount = 0;

    // Process each symbol
    const symbolPromises = normalizedSymbols.map(async (symbol) => {
      const symbolRef = db.collection(FirestoreCollection.TRACKED_SYMBOLS).doc(symbol);
      
      if (remove) {
        // For removal, mark as inactive
        batch.update(symbolRef, {
          isActive: false,
          lastUpdated: now
        });
        removedCount++;
      } else {
        // For addition, first try to get symbol metadata
        let symbolData: Partial<TrackedSymbol> = {
          symbol,
          isActive: true,
          refreshEnabled: false, // Set default to false for new symbols
          lastUpdated: now,
          createdAt: now,
        };

        try {
          // Fetch symbol metadata
          console.log(`sMSvc sS [SymbolManager] Fetching metadata for symbol: ${symbol}`);
          const { matches } = await this.symbolSearchHandler.fetchAndTransform(symbol);
          const exactMatch = matches.find(m => m.symbol === symbol);
          
          if (exactMatch) {
            // Log successful metadata fetch with full match details
            console.log(`sMSvc sS [SymbolManager] Found metadata for ${symbol}:`, {
              match: exactMatch,  // Log the full match object
              selectedFields: {   // And also log a summary of important fields
                name: exactMatch.name,
                type: exactMatch.type,
                region: exactMatch.region,
                marketOpen: exactMatch.marketOpen,
                marketClose: exactMatch.marketClose,
                timezone: exactMatch.timezone,
                currency: exactMatch.currency,
                matchScore: exactMatch.matchScore
              }
            });
            
            // Merge metadata with basic data
            symbolData = {
              ...symbolData,
              name: exactMatch.name,
              type: exactMatch.type,
              region: exactMatch.region,
              marketOpen: exactMatch.marketOpen,
              marketClose: exactMatch.marketClose,
              timezone: exactMatch.timezone,
              currency: exactMatch.currency,
              matchScore: exactMatch.matchScore,
              refreshEnabled: false // Ensure refreshEnabled is set even if metadata is merged
            };
          } else if (matches.length > 0) {
            console.log(`sMSvc sS [SymbolManager] No exact match found for ${symbol}, but found ${matches.length} similar symbols`);
          } else {
            console.log(`sMSvc sS [SymbolManager] No metadata found for symbol: ${symbol}`);
          }
        } catch (error) {
          console.warn(`sMSvc sS [SymbolManager] Failed to fetch metadata for ${symbol}:`, error);
          // Continue with basic data if metadata fetch fails
        }
        
        // Prepare the symbol data with all fields from the API response
        // Start with the basic symbol data from the API
        const symbolDataToSave: Record<string, any> = {
          ...symbolData,  // Spread all properties from the API response first
          // Ensure required fields have values
          symbol: symbol,  // Use the normalized symbol
          isActive: true,
          lastUpdated: FieldValue.serverTimestamp(),
          // Only set createdAt if it doesn't exist
          ...(symbolData.createdAt ? {} : { createdAt: FieldValue.serverTimestamp() })
        };
        
        // Log the data being saved for debugging
        console.log('Symbol data prepared for Firestore:', JSON.stringify(symbolDataToSave, null, 2));
        
        // Log the data being saved
        console.log('Symbol data being saved to Firestore:');
        console.log(JSON.stringify(symbolDataToSave, null, 2));
        
        // Save to Firestore
        batch.set(symbolRef, symbolDataToSave, { merge: true });
        processedSymbols.push(symbol);
      }
      
      return symbol;
    });
    
    // Wait for all symbol processing to complete
    await Promise.all(symbolPromises);
    
    // Get the first processed symbol's data to include in the response
    let symbolData: any = null;
    if (processedSymbols.length > 0) {
      const firstSymbol = processedSymbols[0];
      const symbolDoc = await db.collection(FirestoreCollection.TRACKED_SYMBOLS).doc(firstSymbol).get();
      if (symbolDoc.exists) {
        symbolData = symbolDoc.data();
      }
    }

    try {
      await batch.commit();
      
      // Count total active symbols
      const totalActive = await this.countActiveSymbols();
      
      return {
        success: true,
        added: processedSymbols.length,
        removed: removedCount,
        totalActive,
        timestamp: now,
        symbolData: symbolData || undefined
      };
    } catch (error) {
      console.error('sMSvc sS [SymbolManager] Error syncing symbols:', error);
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
      const collectionRef = db.collection(FirestoreCollection.TRACKED_SYMBOLS);
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
      console.error('sMSvc lS [SymbolManager] Error listing symbols:', error);
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
      const doc = await db.collection(FirestoreCollection.TRACKED_SYMBOLS)
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
      console.error(`sMSvc gS [SymbolManager] Error getting symbol ${symbol}:`, error);
      throw new Error('Failed to retrieve symbol');
    }
  }

  /**
   * Counts the number of active symbols
   * @returns A promise that resolves to the count of active symbols
   */
  private async countActiveSymbols(): Promise<number> {
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
}

// Create an instance of the service
export const symbolManagerService = new SymbolManagerService();