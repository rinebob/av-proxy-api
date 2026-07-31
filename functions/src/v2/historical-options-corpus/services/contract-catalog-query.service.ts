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
 * (expiration, strike, delta, iv, or observationCount) may be used per
 * query — Firestore does not support range filters on two different
 * fields in the same query.
 */
export interface CatalogQueryFilters {
  symbol: string;
  /** Exact-match expiration date (YYYY-MM-DD). Mutually exclusive with expirationGte/expirationLte. */
  expiration?: string;
  /** Lower bound (inclusive) for expiration date range filtering. */
  expirationGte?: string;
  /** Upper bound (inclusive) for expiration date range filtering. */
  expirationLte?: string;
  /** One or more length bucket labels for equality filtering (e.g. ['3mo', '6mo']). */
  contractLengthBuckets?: string[];
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

    const rangeDims = this.getActiveRangeDimensions(filters);
    if (rangeDims.length > 1) {
      throw new FilterConflictError(
        `At most one range dimension is supported per query. ` +
          `Found: ${rangeDims.map((d) => d.dimension).join(', ')}. ` +
          `Use equality filters where possible and apply the remaining range filter client-side.`,
      );
    }

    const colRef = this.db
      .collection(OPTIONS_FILE_INDEX_COLLECTION)
      .doc(upperSymbol)
      .collection(TS_CONTRACTS_SUBCOLLECTION);

    let q: Query = colRef;

    // Equality filters
    if (filters.expiration) {
      q = q.where('expiration', '==', filters.expiration);
    }
    // Range filter on expiration — counts as the one allowed range dimension
    if (filters.expirationGte) {
      q = q.where('expiration', '>=', filters.expirationGte);
    }
    if (filters.expirationLte) {
      q = q.where('expiration', '<=', filters.expirationLte);
    }
    if (filters.contractLengthBuckets && filters.contractLengthBuckets.length > 0) {
      if (filters.contractLengthBuckets.length === 1) {
        q = q.where('contractLengthBucket', '==', filters.contractLengthBuckets[0]);
      } else {
        q = q.where('contractLengthBucket', 'in', filters.contractLengthBuckets);
      }
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
    // # Reason: Firestore requires that the first orderBy matches the field
    // used in a range filter. When the user's sortBy differs from the range
    // field, we must prepend orderBy on the range field, then add the user's
    // requested sort as a secondary orderBy.
    const rangeField = rangeDims.length > 0 ? rangeDims[0].fieldPath : null;
    if (rangeField && rangeField !== sortField) {
      q = q.orderBy(rangeField, 'asc');
    }
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
   * Returns all active range dimensions from the filters.
   * Each entry contains the dimension name (for error messages) and the
   * Firestore field path (for orderBy).
   *
   * # Reason: Consolidates range-dimension detection so validation and
   * orderBy construction share a single source of truth.
   */
  private getActiveRangeDimensions(filters: CatalogQueryFilters): Array<{ dimension: string; fieldPath: string }> {
    const dims: Array<{ dimension: string; fieldPath: string }> = [];

    if (filters.expirationGte !== undefined || filters.expirationLte !== undefined) {
      dims.push({ dimension: 'expiration', fieldPath: 'expiration' });
    }
    if (filters.strikeGte !== undefined || filters.strikeLte !== undefined) {
      dims.push({ dimension: 'strike', fieldPath: 'strike' });
    }
    if (filters.deltaGte !== undefined || filters.deltaLte !== undefined) {
      dims.push({ dimension: 'delta', fieldPath: 'latestDelta' });
    }
    if (filters.ivGte !== undefined || filters.ivLte !== undefined) {
      dims.push({ dimension: 'iv', fieldPath: 'latestIv' });
    }
    if (filters.minObservationCount !== undefined) {
      dims.push({ dimension: 'observationCount', fieldPath: 'observationCount' });
    }

    return dims;
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
