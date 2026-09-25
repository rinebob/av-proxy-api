import * as admin from 'firebase-admin';
import { db } from '../../../firebase-admin-init';
import { DocumentData, Query } from 'firebase-admin/firestore';
import { FirestoreCollection } from '@shared/firestore';
import {
    ListSymbolsOptions,
    ListSymbolsV2Response,
    TRACKED_SYMBOL_V2_FIELDS,
    resolveTrackedSymbolSortField,
    TrackedSymbolV2
} from '@shared/alpha-vantage';

import { toTrackedSymbolV2 } from '../../common/common-dm';

/**
 * In-memory comparator for flag-filtered list queries (Task #142). Handles
 * dotted field paths (e.g. 'companyInfo.Sector'), Firestore Timestamps and
 * Dates; docs lacking the sort field go last in either direction.
 */
export function compareTrackedSymbolsByField(
  sortField: string,
  direction: 'asc' | 'desc',
): (a: TrackedSymbolV2, b: TrackedSymbolV2) => number {
  const path = sortField.split('.');
  const read = (obj: any): any => path.reduce((o: any, k) => o?.[k], obj);
  const sign = direction === 'desc' ? -1 : 1;
  const num = (v: any): number =>
    v?.toMillis ? v.toMillis() : v instanceof Date ? v.getTime() : v;
  return (a, b) => {
    const va = num(read(a));
    const vb = num(read(b));
    if (va === undefined || va === null) return vb === undefined || vb === null ? 0 : 1;
    if (vb === undefined || vb === null) return -1;
    if (va < vb) return -sign;
    if (va > vb) return sign;
    // Deterministic tie-break so pagination is stable.
    return String(a.symbol ?? '').localeCompare(String(b.symbol ?? ''));
  };
}

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
   * Checks whether a symbol is tracked (exists in the TRACKED_SYMBOLS collection).
   * @param symbol - The symbol to check (case-insensitive)
   * @returns A promise that resolves to true if the symbol is tracked, false otherwise
   */
  async isSymbolTracked(symbol: string): Promise<boolean> {
    if (!symbol || typeof symbol !== 'string') {
      return false;
    }
    try {
      return (await this.getSymbol(symbol)) !== null;
    } catch {
      return false;
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
        optionable,
        optionsEnabled,
      } = options;

        console.log('sMSvc lSV2 begin listSymbolsV2.options: ', options);

      try {
        const collectionRef = db.collection(FirestoreCollection.TRACKED_SYMBOLS);
        let query: Query<DocumentData> = collectionRef;

        if (activeOnly) {
          query = query.where(TRACKED_SYMBOL_V2_FIELDS.IS_ACTIVE, '==', true);
        }

        // Opt-in flag filters (Task #142) — boolean equality.
        if (optionable !== undefined) {
          query = query.where(TRACKED_SYMBOL_V2_FIELDS.OPTIONABLE, '==', optionable);
        }
        if (optionsEnabled !== undefined) {
          query = query.where(TRACKED_SYMBOL_V2_FIELDS.OPTIONS_ENABLED, '==', optionsEnabled);
        }

        // Map sortBy (from UI or API) to a whitelisted Firestore field path
        const sortField = resolveTrackedSymbolSortField(sortBy);
        const direction = sortDirection === 'desc' ? 'desc' : 'asc';

        // Flag-filtered requests sort/paginate in memory instead of adding
        // orderBy to the query: equality filters + orderBy on a different
        // field would require a composite index per (flag × sortable field ×
        // direction) combination. Equality-only queries use zigzag merge —
        // no index needed. The tracked-symbols set is small (~1k docs), so
        // fetching all matches then sorting client-side is cheap. NOTE: docs
        // lacking the sort field are included here (sorted last) and counted
        // in total — the unfiltered path below excludes them via orderBy, so
        // `total` semantics differ slightly between paths.
        if (optionable !== undefined || optionsEnabled !== undefined) {
          const snapshot = await query.get();
          const all = snapshot.docs.map(doc => toTrackedSymbolV2(doc.data()));
          all.sort(compareTrackedSymbolsByField(sortField, direction));
          return {
            symbols: all.slice(offset, offset + limit),
            total: all.length,
            limit,
            offset,
          };
        }

        // Get total count matching the sorted query — orderBy on a field also
        // filters out docs lacking it (sparse companyInfo.* fields), so the count
        // must carry the same orderBy or `total` overstates the result set.
        // (with fallback if aggregate query fails)
        let total = 0;
        try {
          const countSnapshot = await query.orderBy(sortField, direction).count().get();
          total = countSnapshot.data().count;
        } catch (countErr: any) {
          console.error('sMSvc lSV2 count() failed; falling back to approximate count via documentId():', {
            message: countErr?.message,
            code: countErr?.code,
            details: countErr?.details,
          });
          total = await this._fallbackCount(query);
          console.log('sMSvc lSV2 fallback total computed as:', total);
        }

        // Apply sorting and pagination
        const paginatedQuery = query
          .orderBy(sortField, direction)
          .offset(offset)
          .limit(limit);

        const snapshot = await paginatedQuery.get();

        const symbols = snapshot.docs.map(doc => toTrackedSymbolV2(doc.data()));

        console.log('sMSvc lSV2 final symbols slice 2: ', symbols.slice(0, 2));

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

    /**
     * Fallback counter when Firestore aggregate count() is unavailable.
     * Uses select(documentId()) to minimize payload size.
     */
    private async _fallbackCount(query: Query<DocumentData>): Promise<number> {
      try {
        const snapshot = await (query as any)
          .select(admin.firestore.FieldPath.documentId())
          .get();
        return snapshot.size;
      } catch (err: any) {
        console.error('sMSvc lSV2 _fallbackCount failed:', {
          message: err?.message,
          code: err?.code,
          details: err?.details,
        });
        // As a last resort, return 0 to avoid failing the entire request
        return 0;
      }
    }
}

// Create an instance of the service
export const symbolManagerService = new SymbolManagerService();