import type { Firestore, Query, DocumentData, QueryDocumentSnapshot } from 'firebase-admin/firestore';

import {
  OPTIONS_FILE_INDEX_COLLECTION,
  TS_CONTRACTS_SUBCOLLECTION,
  type ContractCatalogDoc,
  type ContractSummaryDoc,
  type CatalogSortField,
  type CatalogSortOrder,
} from '@shared/options';

/**
 * Filters accepted by the catalog query service.
 *
 * Equality filters can be combined freely.  At most one range dimension
 * (strike, delta, or iv) may be used per query — Firestore does not support
 * range filters on two different fields in the same query.
 */
export interface CatalogQueryFilters {
  symbol: string;
  expiration?: string;
  contractLengthBucket?: string;
  type?: 'call' | 'put';
  strike?: number;
  strikeGte?: number;
  strikeLte?: number;
  deltaGte?: number;
  deltaLte?: number;
  ivGte?: number;
  ivLte?: number;
  minObservationCount?: number;
  sortBy?: CatalogSortField;
  sortOrder?: CatalogSortOrder;
  pageSize?: number;
  pageToken?: string;
}

/**
 * Result of a catalog query.
 */
export interface CatalogQueryResult {
  contracts: ContractCatalogDoc[];
  nextPageToken?: string;
}

/**
 * Error thrown when the filter combination is invalid (e.g. two different
 * range dimensions).
 */
export class FilterConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'FilterConflictError';
  }
}

/** Maps `CatalogSortField` values to Firestore field paths. */
const SORT_FIELD_MAP: Record<CatalogSortField, string> = {
  expiration: 'expiration',
  strike: 'strike',
  contractLengthDays: 'contractLengthDays',
  observationCount: 'observationCount',
  delta: 'latestDelta',
};

/** Default page size when none is specified. */
const DEFAULT_PAGE_SIZE = 200;

/** Maximum allowed page size. */
const MAX_PAGE_SIZE = 500;

/**
 * Query service for the `ts-contracts` subcollection.
 *
 * Single concern: building and executing Firestore queries against
 * per-contract catalog docs with filtering, sorting, and cursor pagination.
 */
export class ContractCatalogQueryService {
  constructor(private readonly db: Firestore) {}

  /**
   * Queries `ts-contracts` with the provided filters and returns a
   * paginated result.
   *
   * @throws {FilterConflictError} when two different range dimensions are used.
   */
  async queryCatalog(filters: CatalogQueryFilters): Promise<CatalogQueryResult> {
    const upperSymbol = filters.symbol.toUpperCase();
    const pageSize = Math.min(Math.max(filters.pageSize ?? DEFAULT_PAGE_SIZE, 1), MAX_PAGE_SIZE);
    const sortBy = filters.sortBy ?? 'expiration';
    const sortOrder = filters.sortOrder ?? 'asc';
    const sortField = SORT_FIELD_MAP[sortBy];

    this.validateFilterCombination(filters);

    const colRef = this.db
      .collection(OPTIONS_FILE_INDEX_COLLECTION)
      .doc(upperSymbol)
      .collection(TS_CONTRACTS_SUBCOLLECTION);

    let q: Query = colRef;

    // Equality filters
    if (filters.expiration) {
      q = q.where('expiration', '==', filters.expiration);
    }
    if (filters.contractLengthBucket) {
      q = q.where('contractLengthBucket', '==', filters.contractLengthBucket);
    }
    if (filters.type) {
      q = q.where('type', '==', filters.type);
    }
    if (filters.strike !== undefined) {
      q = q.where('strike', '==', filters.strike);
    }

    // Range filters — at most one dimension (validated above)
    if (filters.strikeGte !== undefined) {
      q = q.where('strike', '>=', filters.strikeGte);
    }
    if (filters.strikeLte !== undefined) {
      q = q.where('strike', '<=', filters.strikeLte);
    }
    if (filters.deltaGte !== undefined) {
      q = q.where('latestDelta', '>=', filters.deltaGte);
    }
    if (filters.deltaLte !== undefined) {
      q = q.where('latestDelta', '<=', filters.deltaLte);
    }
    if (filters.ivGte !== undefined) {
      q = q.where('latestIv', '>=', filters.ivGte);
    }
    if (filters.ivLte !== undefined) {
      q = q.where('latestIv', '<=', filters.ivLte);
    }
    if (filters.minObservationCount !== undefined) {
      q = q.where('observationCount', '>=', filters.minObservationCount);
    }

    // Sort
    q = q.orderBy(sortField, sortOrder);

    // Cursor pagination
    if (filters.pageToken) {
      const cursorDoc = await this.decodeCursor(upperSymbol, filters.pageToken);
      if (cursorDoc) {
        q = q.startAfter(cursorDoc);
      }
    }

    // Fetch one extra to determine if there's a next page
    q = q.limit(pageSize + 1);

    const snap = await q.get();
    const docs = snap.docs.slice(0, pageSize);
    const contracts = docs.map((doc) => doc.data() as ContractCatalogDoc);

    let nextPageToken: string | undefined;
    if (snap.docs.length > pageSize) {
      const lastDoc = docs[docs.length - 1];
      nextPageToken = lastDoc.id;
    }

    return { contracts, nextPageToken };
  }

  /**
   * Reads the symbol summary doc (length histogram + totals).
   * Returns `null` when the doc doesn't exist.
   */
  async getSummary(symbol: string): Promise<ContractSummaryDoc | null> {
    const upperSymbol = symbol.toUpperCase();
    const docRef = this.db.collection(OPTIONS_FILE_INDEX_COLLECTION).doc(upperSymbol);
    const snap = await docRef.get();
    if (!snap.exists) return null;
    return snap.data() as ContractSummaryDoc;
  }

  /**
   * Validates that at most one range dimension is used.
   * @throws {FilterConflictError} when two different range dimensions are used.
   */
  private validateFilterCombination(filters: CatalogQueryFilters): void {
    const rangeDimensions: string[] = [];

    if (filters.strikeGte !== undefined || filters.strikeLte !== undefined) {
      rangeDimensions.push('strike');
    }
    if (filters.deltaGte !== undefined || filters.deltaLte !== undefined) {
      rangeDimensions.push('delta');
    }
    if (filters.ivGte !== undefined || filters.ivLte !== undefined) {
      rangeDimensions.push('iv');
    }
    if (filters.minObservationCount !== undefined) {
      rangeDimensions.push('observationCount');
    }

    if (rangeDimensions.length > 1) {
      throw new FilterConflictError(
        `At most one range dimension is supported per query. ` +
          `Found: ${rangeDimensions.join(', ')}. ` +
          `Use equality filters where possible and apply the remaining range filter client-side.`,
      );
    }
  }

  /**
   * Decodes the opaque page token (contract ID) into a DocumentSnapshot
   * for use as a cursor.
   *
   * # Reason: We use the contract ID as the cursor because it's the document
   * ID in `ts-contracts/{contractId}`. Firestore's `startAfter` accepts a
   * DocumentSnapshot, so we fetch the doc and pass it.
   */
  private async decodeCursor(
    symbol: string,
    pageToken: string,
  ): Promise<QueryDocumentSnapshot<DocumentData> | null> {
    const docRef = this.db
      .collection(OPTIONS_FILE_INDEX_COLLECTION)
      .doc(symbol)
      .collection(TS_CONTRACTS_SUBCOLLECTION)
      .doc(pageToken);

    const snap = await docRef.get();
    if (!snap.exists) return null;
    return snap as QueryDocumentSnapshot<DocumentData>;
  }
}
