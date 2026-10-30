import type {
  CollectionReference,
  Firestore,
  Query,
  QueryDocumentSnapshot,
} from 'firebase-admin/firestore';
import { FieldPath } from 'firebase-admin/firestore';

import {
  OPTIONS_FILE_INDEX_COLLECTION,
  TS_CONTRACTS_SUBCOLLECTION,
  CONTRACT_AVAILABILITY_MAX_CONTRACTS,
  type ContractAvailabilityFilters,
  type ContractCatalogDoc,
  type ContractCatalogEntry,
} from '@shared/options';

/** Firestore `in` operator accepts at most 30 values per query. */
const IN_CHUNK_SIZE = 30;

/** Docs per page on the response-ordered scan. */
const DEFAULT_PAGE_SIZE = 500;

export interface AvailabilityQueryResult {
  contracts: ContractCatalogEntry[];
  /** True when results were capped at `maxContracts`. */
  truncated: boolean;
}

type RangeField = 'expiration' | 'firstObserved' | 'strike';

/**
 * Query service for the contract availability endpoint.
 *
 * Unlike {@link ContractCatalogQueryService} (paginated, one-range-400),
 * this service picks a deterministic primary range dim — `expiration` >
 * `firstObserved` > `strike` — runs it server-side, and post-filters every
 * remaining dimension in memory. An explicit `expirations` list replaces
 * the expiration range entirely and runs as chunked `in` queries.
 * Results are sorted in memory (expiration asc → strike asc →
 * contractId asc), then capped at `maxContracts` — `truncated` reports
 * whether more matches existed beyond the cap.
 *
 * Read bounding: when the only server-side dims are `type` and
 * `expiration` (i.e. the unfiltered and expiration-primary cases), the
 * scan runs in RESPONSE order — (expiration, strike, __name__) — in
 * `pageSize` pages and early-exits once `maxContracts + 1` post-filtered
 * matches are collected. An unfiltered `?symbol=QQQ` reads ~2001 docs
 * instead of the entire ~395k-doc collection. Requires the
 * (expiration, strike) and (type, expiration, strike) composite indexes
 * — both already exist in `firestore.indexes.json`. firstObserved- and
 * strike-primary queries keep a single `get()` on the pushed range:
 * the range itself bounds the read, but their stream order is not the
 * response order, so a `cap + 1` early exit would be incorrect.
 */
export class ContractAvailabilityQueryService {
  constructor(
    private readonly db: Firestore,
    private readonly pageSize = DEFAULT_PAGE_SIZE,
  ) {}

  async queryAvailability(
    filters: ContractAvailabilityFilters,
    maxContracts = CONTRACT_AVAILABILITY_MAX_CONTRACTS,
  ): Promise<AvailabilityQueryResult> {
    const colRef = this.db
      .collection(OPTIONS_FILE_INDEX_COLLECTION)
      .doc(filters.symbol.toUpperCase())
      .collection(TS_CONTRACTS_SUBCOLLECTION);

    const primary = this.selectPrimaryRange(filters);
    let filtered: ContractCatalogDoc[];
    if (filters.expirations !== undefined) {
      const docs = await this.fetchByExpirationList(colRef, filters, filters.expirations);
      filtered = docs.filter((d) => this.postFilter(d, filters, null));
    } else if (primary === 'firstObserved' || primary === 'strike') {
      const docs = await this.fetchByPrimaryRange(colRef, filters, primary);
      filtered = docs.filter((d) => this.postFilter(d, filters, primary));
    } else {
      // Ordered scan already emits docs post-filtered and in response
      // order, capped at maxContracts + 1.
      filtered = await this.fetchOrderedPages(colRef, filters, maxContracts + 1);
    }
    filtered.sort(compareContracts);

    const truncated = filtered.length > maxContracts;
    const contracts = filtered.slice(0, maxContracts).map(stripLastUpdated);
    return { contracts, truncated };
  }

  /**
   * First present range dimension wins server-side execution.
   * When `expirations` is present there is no expiration range — the `in`
   * queries are the primary selection and every other dim post-filters.
   */
  private selectPrimaryRange(filters: ContractAvailabilityFilters): RangeField | null {
    if (filters.expirations !== undefined) return null;
    if (filters.expirationGte !== undefined || filters.expirationLte !== undefined) return 'expiration';
    if (filters.firstObservedGte !== undefined || filters.firstObservedLte !== undefined) return 'firstObserved';
    if (filters.strikeGte !== undefined || filters.strikeLte !== undefined) return 'strike';
    return null;
  }

  private async fetchByPrimaryRange(
    colRef: CollectionReference,
    filters: ContractAvailabilityFilters,
    primary: RangeField | null,
  ): Promise<ContractCatalogDoc[]> {
    let q: Query = colRef;
    if (filters.type) q = q.where('type', '==', filters.type);
    if (primary === 'expiration') {
      if (filters.expirationGte !== undefined) q = q.where('expiration', '>=', filters.expirationGte);
      if (filters.expirationLte !== undefined) q = q.where('expiration', '<=', filters.expirationLte);
    } else if (primary === 'firstObserved') {
      if (filters.firstObservedGte !== undefined) q = q.where('firstObserved', '>=', filters.firstObservedGte);
      if (filters.firstObservedLte !== undefined) q = q.where('firstObserved', '<=', filters.firstObservedLte);
    } else if (primary === 'strike') {
      if (filters.strikeGte !== undefined) q = q.where('strike', '>=', filters.strikeGte);
      if (filters.strikeLte !== undefined) q = q.where('strike', '<=', filters.strikeLte);
    }
    const snap = await q.get();
    return snap.docs.map((d) => d.data() as ContractCatalogDoc);
  }

  /**
   * Pages through the collection in response order —
   * (expiration, strike, __name__) — post-filtering each doc and
   * stopping as soon as `want` matches are collected or the collection
   * is exhausted. Expiration bounds and `type` are pushed server-side;
   * every other dimension post-filters. Correct for early exit because
   * the stream order IS the sort order.
   */
  private async fetchOrderedPages(
    colRef: CollectionReference,
    filters: ContractAvailabilityFilters,
    want: number,
  ): Promise<ContractCatalogDoc[]> {
    const matched: ContractCatalogDoc[] = [];
    let cursor: QueryDocumentSnapshot | undefined;
    for (;;) {
      let q: Query = colRef;
      if (filters.type) q = q.where('type', '==', filters.type);
      if (filters.expirationGte !== undefined) q = q.where('expiration', '>=', filters.expirationGte);
      if (filters.expirationLte !== undefined) q = q.where('expiration', '<=', filters.expirationLte);
      q = q
        .orderBy('expiration')
        .orderBy('strike')
        .orderBy(FieldPath.documentId())
        .limit(this.pageSize);
      if (cursor) q = q.startAfter(cursor);
      const snap = await q.get();
      for (const d of snap.docs) {
        const doc = d.data() as ContractCatalogDoc;
        if (this.postFilter(doc, filters, 'expiration')) {
          matched.push(doc);
          if (matched.length >= want) return matched;
        }
      }
      if (snap.docs.length < this.pageSize) return matched;
      cursor = snap.docs[snap.docs.length - 1];
    }
  }

  /** Chunked `expiration in (…)` queries, merged and deduped by contractId. */
  private async fetchByExpirationList(
    colRef: CollectionReference,
    filters: ContractAvailabilityFilters,
    expirations: string[],
  ): Promise<ContractCatalogDoc[]> {
    const byId = new Map<string, ContractCatalogDoc>();
    const snaps = await Promise.all(
      Array.from({ length: Math.ceil(expirations.length / IN_CHUNK_SIZE) }, (_, i) => {
        let q: Query = colRef.where('expiration', 'in', expirations.slice(i * IN_CHUNK_SIZE, (i + 1) * IN_CHUNK_SIZE));
        if (filters.type) q = q.where('type', '==', filters.type);
        return q.get();
      }),
    );
    for (const snap of snaps) {
      for (const d of snap.docs) {
        const doc = d.data() as ContractCatalogDoc;
        byId.set(doc.contractId, doc);
      }
    }
    return [...byId.values()];
  }

  /**
   * In-memory filter for every dimension NOT already guaranteed by the
   * server-side selection: non-primary ranges, `strikeStep`, and (when a
   * dimension was primary) nothing extra on that field.
   */
  private postFilter(
    doc: ContractCatalogDoc,
    filters: ContractAvailabilityFilters,
    primary: RangeField | null,
  ): boolean {
    // `expirations` supersedes the expiration range — the parser drops
    // range params when a list is present, so bounds are skipped here too.
    if (primary !== 'expiration' && filters.expirations === undefined) {
      if (filters.expirationGte !== undefined && doc.expiration < filters.expirationGte) return false;
      if (filters.expirationLte !== undefined && doc.expiration > filters.expirationLte) return false;
    }
    if (primary !== 'firstObserved') {
      if (filters.firstObservedGte !== undefined && doc.firstObserved < filters.firstObservedGte) return false;
      if (filters.firstObservedLte !== undefined && doc.firstObserved > filters.firstObservedLte) return false;
    }
    if (primary !== 'strike') {
      if (filters.strikeGte !== undefined && doc.strike < filters.strikeGte) return false;
      if (filters.strikeLte !== undefined && doc.strike > filters.strikeLte) return false;
    }
    if (filters.strikeStep !== undefined) {
      const stepCents = Math.round(filters.strikeStep * 100);
      if (stepCents > 0 && Math.round(doc.strike * 100) % stepCents !== 0) return false;
    }
    return true;
  }
}

function compareContracts(a: ContractCatalogDoc, b: ContractCatalogDoc): number {
  return (
    a.expiration.localeCompare(b.expiration) ||
    a.strike - b.strike ||
    a.contractId.localeCompare(b.contractId)
  );
}

function stripLastUpdated(doc: ContractCatalogDoc): ContractCatalogEntry {
  const { lastUpdated: _lastUpdated, ...entry } = doc;
  return entry;
}
