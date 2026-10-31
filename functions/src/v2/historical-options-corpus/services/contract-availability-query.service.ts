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

/**
 * Hard bound on docs scanned per query. Wide primaries (e.g.
 * `strikeGte=0`, full-history `firstObserved`) would otherwise materialize
 * the entire subcollection and blow the function's time/memory budget.
 * Hitting the ceiling sets `truncated` — honest "more matches may exist".
 */
const DEFAULT_READ_CEILING = 25_000;

export interface AvailabilityQueryResult {
  contracts: ContractCatalogEntry[];
  /** True when results were capped at `maxContracts` OR the read
   *  ceiling stopped a scan before exhaustion — either way, more
   *  matching contracts may exist beyond what was returned. */
  truncated: boolean;
}

type RangeField = 'expiration' | 'firstObserved' | 'strike';

/** Fetch outcome: post-filtered docs plus whether the read ceiling fired. */
interface ScanFetch {
  docs: ContractCatalogDoc[];
  hitReadCeiling: boolean;
}

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
 * Read bounding: all scans run via `Query.stream()` in a deterministic
 * server-side order under a hard scanned-doc ceiling
 * ({@link DEFAULT_READ_CEILING}) — `truncated` reports when the ceiling
 * fired. Early `for await` exit destroys the consumer-side stream; the
 * SDK's internal pipe chain does NOT forward the destroy to the gRPC
 * `runQuery` RPC, which pauses via flow-control backpressure (billed
 * reads stay bounded near the ceiling) and closes on server idle
 * timeout. The ordered scan (only server-side dims `type` +
 * `expiration`, i.e. unfiltered and expiration-primary) additionally
 * early-exits once `maxContracts + 1` post-filtered matches are
 * collected — an unfiltered `?symbol=QQQ` reads ~2001 docs. Requires
 * the (expiration, strike), (type, expiration, strike),
 * (type, firstObserved), and (type, strike) composite indexes — all
 * already exist in `firestore.indexes.json`. firstObserved- and
 * strike-primary scans stream in primary-field order and cannot
 * early-exit on matches (stream order ≠ response order), so the
 * ceiling is their only bound besides range width.
 */
export class ContractAvailabilityQueryService {
  constructor(
    private readonly db: Firestore,
    private readonly readCeiling = DEFAULT_READ_CEILING,
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
    let hitReadCeiling = false;
    if (filters.expirations !== undefined) {
      const fetched = await this.fetchByExpirationList(colRef, filters, filters.expirations);
      hitReadCeiling = fetched.hitReadCeiling;
      filtered = fetched.docs.filter((d) => this.postFilter(d, filters, null));
    } else if (primary === 'firstObserved' || primary === 'strike') {
      ({ docs: filtered, hitReadCeiling } = await this.fetchByPrimaryRange(colRef, filters, primary));
    } else {
      // Ordered scan emits docs post-filtered and in response order,
      // capped at maxContracts + 1 matches or the read ceiling.
      ({ docs: filtered, hitReadCeiling } = await this.fetchOrderedScan(colRef, filters, maxContracts + 1));
    }
    filtered.sort(compareContracts);

    const truncated = filtered.length > maxContracts || hitReadCeiling;
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

  /**
   * Streams the pushed primary range in primary-field order,
   * post-filtering each doc and collecting every match — a `cap + 1`
   * early exit would be wrong here (stream order ≠ response order), so
   * the scan runs to range exhaustion or the read ceiling.
   */
  private async fetchByPrimaryRange(
    colRef: CollectionReference,
    filters: ContractAvailabilityFilters,
    primary: 'firstObserved' | 'strike',
  ): Promise<ScanFetch> {
    let q: Query = colRef;
    if (filters.type) q = q.where('type', '==', filters.type);
    if (primary === 'firstObserved') {
      if (filters.firstObservedGte !== undefined) q = q.where('firstObserved', '>=', filters.firstObservedGte);
      if (filters.firstObservedLte !== undefined) q = q.where('firstObserved', '<=', filters.firstObservedLte);
    } else if (primary === 'strike') {
      if (filters.strikeGte !== undefined) q = q.where('strike', '>=', filters.strikeGte);
      if (filters.strikeLte !== undefined) q = q.where('strike', '<=', filters.strikeLte);
    }
    q = q.orderBy(primary).orderBy(FieldPath.documentId());

    const matched: ContractCatalogDoc[] = [];
    const hitReadCeiling = await this.scanBounded(q, (doc) => {
      if (this.postFilter(doc, filters, primary)) matched.push(doc);
      return 'continue';
    });
    return { docs: matched, hitReadCeiling };
  }

  /**
   * Streams the collection in response order —
   * (expiration, strike, __name__) — post-filtering each doc and
   * stopping as soon as `want` matches are collected, the collection
   * is exhausted, or the read ceiling is hit — a dense range + sparse
   * post-filter would otherwise scan every doc. Expiration bounds and
   * `type` are pushed server-side; every other dimension post-filters.
   * Correct for early exit because the stream order IS the sort order.
   */
  private async fetchOrderedScan(
    colRef: CollectionReference,
    filters: ContractAvailabilityFilters,
    want: number,
  ): Promise<ScanFetch> {
    let q: Query = colRef;
    if (filters.type) q = q.where('type', '==', filters.type);
    if (filters.expirationGte !== undefined) q = q.where('expiration', '>=', filters.expirationGte);
    if (filters.expirationLte !== undefined) q = q.where('expiration', '<=', filters.expirationLte);
    q = q
      .orderBy('expiration')
      .orderBy('strike')
      .orderBy(FieldPath.documentId());

    const matched: ContractCatalogDoc[] = [];
    const hitReadCeiling = await this.scanBounded(q, (doc) => {
      if (!this.postFilter(doc, filters, 'expiration')) return 'continue';
      matched.push(doc);
      return matched.length >= want ? 'stop' : 'continue';
    });
    return { docs: matched, hitReadCeiling };
  }

  /**
   * Chunked `expiration in (…)` queries, merged and deduped by
   * contractId. Chunks share one scanned-doc budget so the ceiling is a
   * per-request bound, not per-chunk — the 30-value `in` cap bounds
   * value count, not doc count, so an un-capped `get()` on a dense
   * expiration could still materialize tens of thousands of docs.
   * Sequential per chunk: the ceiling makes parallel fan-out pointless
   * once it fires.
   */
  private async fetchByExpirationList(
    colRef: CollectionReference,
    filters: ContractAvailabilityFilters,
    expirations: string[],
  ): Promise<ScanFetch> {
    const byId = new Map<string, ContractCatalogDoc>();
    const budget = { scanned: 0 };
    let hitReadCeiling = false;
    for (let i = 0; i < expirations.length && !hitReadCeiling; i += IN_CHUNK_SIZE) {
      let q: Query = colRef.where('expiration', 'in', expirations.slice(i, i + IN_CHUNK_SIZE));
      if (filters.type) q = q.where('type', '==', filters.type);
      hitReadCeiling = await this.scanBounded(q, (doc) => {
        byId.set(doc.contractId, doc);
        return 'continue';
      }, budget);
    }
    return { docs: [...byId.values()], hitReadCeiling };
  }

  /**
   * Streams `q`, invoking `visit` on each doc until it returns `'stop'`
   * (early exit, no ceiling), the stream exhausts, or the scanned-doc
   * budget reaches the read ceiling. `budget` lets multi-query paths
   * (the `expirations` chunk loop) share one ceiling across scans —
   * when omitted each call gets a fresh counter. The ceiling check
   * runs after `visit` so an early exit on the ceiling-th doc still
   * wins — matching the ordered scan's cap+1 semantics. A mid-stream
   * error propagates to the caller (→ 500) — partial results are never
   * returned silently.
   */
  private async scanBounded(
    q: Query,
    visit: (doc: ContractCatalogDoc) => 'continue' | 'stop',
    budget: { scanned: number } = { scanned: 0 },
  ): Promise<boolean> {
    if (budget.scanned >= this.readCeiling) return true;
    for await (const snap of this.scan(q)) {
      budget.scanned++;
      if (visit(snap.data() as ContractCatalogDoc) === 'stop') return false;
      if (budget.scanned >= this.readCeiling) return true;
    }
    return false;
  }

  /**
   * Server-pushed doc stream for a query. `Query.stream()` returns a
   * Node Readable at runtime (async-iterable — the SDK types it as
   * `NodeJS.ReadableStream`, which omits `[Symbol.asyncIterator]`, hence
   * the cast). Early `for await` exit destroys the consumer-side
   * stream; the upstream gRPC RPC is NOT cancelled (the SDK's pipe
   * chain doesn't forward destroy) — it pauses on flow-control
   * backpressure and closes on server idle timeout.
   */
  private scan(q: Query): AsyncIterable<QueryDocumentSnapshot> {
    return q.stream() as unknown as AsyncIterable<QueryDocumentSnapshot>;
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
