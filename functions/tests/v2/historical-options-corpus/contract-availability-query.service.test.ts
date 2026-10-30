import type { Firestore } from 'firebase-admin/firestore';
import type { ContractCatalogDoc } from '@shared/options';

import { ContractAvailabilityQueryService } from '../../../src/v2/historical-options-corpus/services/contract-availability-query.service';

// ---- In-memory Firestore fake ----

type WhereClause = { field: string; op: string; value: unknown };

/** Minimal doc shape the service reads — tests may extend freely. */
function catalogDoc(overrides: Partial<ContractCatalogDoc> & { contractId: string }): ContractCatalogDoc {
  return {
    expiration: '2026-05-15',
    strike: 500,
    type: 'call',
    firstObserved: '2026-01-01',
    firstObservedDow: 'Thu',
    lastObserved: '2026-05-15',
    lastObservedDow: 'Fri',
    observationCount: 10,
    expectedObservationCount: 10,
    contractLengthDays: 100,
    contractLengthBucket: '3mo',
    lastUpdated: '2026-05-15T00:00:00Z',
    ...overrides,
  };
}

function matches(doc: ContractCatalogDoc, clause: WhereClause): boolean {
  const v = (doc as unknown as Record<string, unknown>)[clause.field];
  switch (clause.op) {
    case '==': return v === clause.value;
    case '>=': return (v as number | string) >= (clause.value as number | string);
    case '<=': return (v as number | string) <= (clause.value as number | string);
    case 'in': return (clause.value as unknown[]).includes(v);
    default: throw new Error(`unhandled op ${clause.op}`);
  }
}

/** `__name__` stands in for FieldPath.documentId() in the fake. */
function keyPart(doc: ContractCatalogDoc, field: string): unknown {
  return field === '__name__'
    ? doc.contractId
    : (doc as unknown as Record<string, unknown>)[field];
}

function compareByOrder(a: ContractCatalogDoc, b: ContractCatalogDoc, orderBys: string[]): number {
  for (const f of orderBys) {
    const va = keyPart(a, f) as number | string;
    const vb = keyPart(b, f) as number | string;
    if (va === vb) continue;
    return va < vb ? -1 : 1;
  }
  return 0;
}

interface QueryMeta {
  orderBy: string[];
  limit?: number;
  startAfter: boolean;
}

/**
 * A chainable fake that records `where` calls per query and evaluates them
 * against a fixed doc set at `get()` time, including `orderBy`, `limit`,
 * and `startAfter` semantics — enough to exercise the ordered paging
 * loop faithfully. `where`/`orderBy`/etc. return new instances carrying
 * accumulated state, matching the real SDK's immutable query chain.
 */
class FakeQuery {
  constructor(
    private readonly docs: ContractCatalogDoc[],
    private readonly executed: WhereClause[][],
    private readonly meta: QueryMeta[],
    public readonly clauses: WhereClause[] = [],
    private readonly orderBys: string[] = [],
    private readonly limitN?: number,
    private readonly afterDoc?: ContractCatalogDoc,
  ) {}
  private derive(o: {
    clauses?: WhereClause[];
    orderBys?: string[];
    limitN?: number;
    afterDoc?: ContractCatalogDoc;
  }): FakeQuery {
    return new FakeQuery(
      this.docs,
      this.executed,
      this.meta,
      o.clauses ?? this.clauses,
      o.orderBys ?? this.orderBys,
      o.limitN ?? this.limitN,
      o.afterDoc ?? this.afterDoc,
    );
  }
  where(field: string, op: string, value: unknown): FakeQuery {
    return this.derive({ clauses: [...this.clauses, { field, op, value }] });
  }
  orderBy(field: unknown): FakeQuery {
    return this.derive({ orderBys: [...this.orderBys, typeof field === 'string' ? field : '__name__'] });
  }
  limit(n: number): FakeQuery {
    return this.derive({ limitN: n });
  }
  startAfter(snapshot: { id: string }): FakeQuery {
    return this.derive({ afterDoc: this.docs.find((d) => d.contractId === snapshot.id) });
  }
  async get(): Promise<{ docs: Array<{ id: string; data(): ContractCatalogDoc }> }> {
    this.executed.push(this.clauses);
    this.meta.push({
      orderBy: [...this.orderBys],
      limit: this.limitN,
      startAfter: this.afterDoc !== undefined,
    });
    let hits = this.docs.filter((d) => this.clauses.every((c) => matches(d, c)));
    if (this.orderBys.length) hits = [...hits].sort((a, b) => compareByOrder(a, b, this.orderBys));
    if (this.afterDoc) hits = hits.filter((d) => compareByOrder(d, this.afterDoc!, this.orderBys) > 0);
    if (this.limitN !== undefined) hits = hits.slice(0, this.limitN);
    return { docs: hits.map((d) => ({ id: d.contractId, data: () => d })) };
  }
}

interface FakeFirestore {
  executedQueries: WhereClause[][];
  queryMeta: QueryMeta[];
  /** Every `collection/doc/collection` path walked, joined with `/`. */
  paths: string[];
  db: unknown;
}

function createFakeFirestore(docs: ContractCatalogDoc[]): FakeFirestore {
  const executed: WhereClause[][] = [];
  const meta: QueryMeta[] = [];
  const paths: string[] = [];
  const db = {
    collection: jest.fn((col: string) => ({
      doc: jest.fn((docId: string) => ({
        collection: jest.fn((sub: string) => {
          paths.push(`${col}/${docId}/${sub}`);
          return new FakeQuery(docs, executed, meta);
        }),
      })),
    })),
  };
  return { executedQueries: executed, queryMeta: meta, paths, db };
}

// ---- Tests ----

const DOCS = [
  catalogDoc({ contractId: 'QQQ260515C00500000', expiration: '2026-05-15', strike: 500, type: 'call', firstObserved: '2026-01-05' }),
  catalogDoc({ contractId: 'QQQ260515P00500000', expiration: '2026-05-15', strike: 500, type: 'put', firstObserved: '2026-02-10' }),
  catalogDoc({ contractId: 'QQQ260515C00510000', expiration: '2026-05-15', strike: 510, type: 'call', firstObserved: '2026-01-05' }),
  catalogDoc({ contractId: 'QQQ260619C00500000', expiration: '2026-06-19', strike: 500, type: 'call', firstObserved: '2026-03-01' }),
  catalogDoc({ contractId: 'QQZTEST', expiration: '2026-05-15', strike: 512.5, type: 'call', firstObserved: '2026-01-05' }),
];

function svc(docs: ContractCatalogDoc[] = DOCS, pageSize?: number) {
  const fake = createFakeFirestore(docs);
  const service = new ContractAvailabilityQueryService(fake.db as unknown as Firestore, pageSize);
  return { service, executed: fake.executedQueries, meta: fake.queryMeta, paths: fake.paths };
}

describe('ContractAvailabilityQueryService — collection path', () => {
  it('queries options-file-index/{SYMBOL}/ts-contracts with the symbol uppercased', async () => {
    const { service, paths } = svc();
    await service.queryAvailability({ symbol: 'qqq' });
    expect(paths).toEqual(['options-file-index/QQQ/ts-contracts']);
  });
});

describe('ContractAvailabilityQueryService — primary-range selection', () => {
  it('runs expiration server-side when it is the highest-precedence range dim', async () => {
    const { service, executed } = svc();
    await service.queryAvailability({
      symbol: 'QQQ',
      expirationGte: '2026-05-01',
      expirationLte: '2026-08-31',
      strikeGte: 505,
    });
    expect(executed).toHaveLength(1);
    expect(executed[0]).toContainEqual({ field: 'expiration', op: '>=', value: '2026-05-01' });
    expect(executed[0]).toContainEqual({ field: 'expiration', op: '<=', value: '2026-08-31' });
    expect(executed[0].some((c) => c.field === 'strike')).toBe(false);
  });

  it('runs firstObserved server-side when no expiration range or list is given', async () => {
    const { service, executed } = svc();
    await service.queryAvailability({
      symbol: 'QQQ',
      firstObservedGte: '2026-02-01',
      strikeLte: 500,
    });
    expect(executed[0]).toContainEqual({ field: 'firstObserved', op: '>=', value: '2026-02-01' });
    expect(executed[0].some((c) => c.field === 'strike' || c.field === 'expiration')).toBe(false);
  });

  it('runs strike server-side when it is the only range dim', async () => {
    const { service, executed } = svc();
    await service.queryAvailability({ symbol: 'QQQ', strikeGte: 505 });
    expect(executed[0]).toContainEqual({ field: 'strike', op: '>=', value: 505 });
    expect(executed[0].some((c) => c.field === 'expiration' || c.field === 'firstObserved')).toBe(false);
  });

  it('pushes the type equality filter server-side in every strategy', async () => {
    const { service, executed } = svc();
    await service.queryAvailability({ symbol: 'QQQ', type: 'put' });
    expect(executed[0]).toContainEqual({ field: 'type', op: '==', value: 'put' });
  });
});

describe('ContractAvailabilityQueryService — post-filters', () => {
  it('applies non-primary range dims in memory', async () => {
    const { service } = svc();
    const r = await service.queryAvailability({
      symbol: 'QQQ',
      expirationGte: '2026-01-01',
      strikeGte: 500,
      strikeLte: 500,
    });
    expect(r.contracts.map((c) => c.contractId)).toEqual([
      'QQQ260515C00500000',
      'QQQ260515P00500000',
      'QQQ260619C00500000',
    ]);
  });

  it('applies firstObserved bounds in memory when expiration is primary', async () => {
    const { service } = svc();
    const r = await service.queryAvailability({
      symbol: 'QQQ',
      expirationGte: '2026-01-01',
      firstObservedGte: '2026-02-01',
    });
    expect(r.contracts.map((c) => c.contractId)).toEqual(['QQQ260515P00500000', 'QQQ260619C00500000']);
  });

  it('filters strikes on the integer-cent grid for strikeStep', async () => {
    const { service } = svc();
    const r = await service.queryAvailability({ symbol: 'QQQ', strikeStep: 10 });
    // 500 and 510 align to a $10 grid; 512.5 does not.
    expect(r.contracts.map((c) => c.contractId).sort()).toEqual([
      'QQQ260515C00500000',
      'QQQ260515C00510000',
      'QQQ260515P00500000',
      'QQQ260619C00500000',
    ]);
  });

  it('keeps fractional-grid strikes only when aligned (no float error)', async () => {
    const docs = [
      catalogDoc({ contractId: 'A', strike: 502.5 }),
      catalogDoc({ contractId: 'B', strike: 500 }),
    ];
    const { service } = svc(docs);
    const r = await service.queryAvailability({ symbol: 'QQQ', strikeStep: 2.5 });
    expect(r.contracts.map((c) => c.contractId)).toEqual(['B', 'A']); // sorted by strike asc
    const r2 = await service.queryAvailability({ symbol: 'QQQ', strikeStep: 10 });
    expect(r2.contracts.map((c) => c.contractId)).toEqual(['B']);
  });
});

describe('ContractAvailabilityQueryService — expirations list', () => {
  it('runs chunked `in` queries (30 values), merges, dedupes, applies other filters in memory', async () => {
    const expirations = Array.from({ length: 35 }, (_, i) => `2026-0${(i % 9) + 1}-15`);
    const { service, executed } = svc();
    const r = await service.queryAvailability({ symbol: 'QQQ', expirations, type: 'call', strikeLte: 500 });
    expect(executed).toHaveLength(2);
    expect((executed[0].find((c) => c.op === 'in')!.value as string[]).length).toBe(30);
    expect((executed[1].find((c) => c.op === 'in')!.value as string[]).length).toBe(5);
    expect(executed[0]).toContainEqual({ field: 'type', op: '==', value: 'call' });
    expect(executed[0].some((c) => c.field === 'strike')).toBe(false);
    expect(r.contracts.map((c) => c.contractId)).toEqual(['QQQ260515C00500000']);
  });

  it('dedupes docs matched by multiple chunks', async () => {
    const { service } = svc();
    const r = await service.queryAvailability({
      symbol: 'QQQ',
      expirations: ['2026-05-15', '2026-06-19'],
    });
    const ids = r.contracts.map((c) => c.contractId);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toHaveLength(5); // all five docs expire on one of the two dates
  });

  it('issues zero queries for an empty expirations list', async () => {
    const { service, executed } = svc();
    const r = await service.queryAvailability({ symbol: 'QQQ', expirations: [] });
    expect(executed).toHaveLength(0);
    expect(r).toEqual({ contracts: [], truncated: false });
  });

  it('still post-filters firstObserved when expirations is present', async () => {
    const { service } = svc();
    const r = await service.queryAvailability({
      symbol: 'QQQ',
      expirations: ['2026-05-15', '2026-06-19'],
      firstObservedGte: '2026-02-01',
    });
    expect(r.contracts.map((c) => c.contractId)).toEqual(['QQQ260515P00500000', 'QQQ260619C00500000']);
  });

  it('ignores a stray expiration range when expirations is present (parser contract)', async () => {
    const { service } = svc();
    const r = await service.queryAvailability({
      symbol: 'QQQ',
      expirations: ['2026-06-19'],
      expirationGte: '2099-01-01', // would exclude everything if applied
    });
    expect(r.contracts.map((c) => c.contractId)).toEqual(['QQQ260619C00500000']);
  });
});

describe('ContractAvailabilityQueryService — ordering, cap, shape', () => {
  it('sorts by expiration asc → strike asc → contractId asc', async () => {
    const docs = [
      catalogDoc({ contractId: 'B', expiration: '2026-06-19', strike: 500 }),
      catalogDoc({ contractId: 'A', expiration: '2026-05-15', strike: 500 }),
      catalogDoc({ contractId: 'D', expiration: '2026-05-15', strike: 510 }),
      catalogDoc({ contractId: 'C', expiration: '2026-05-15', strike: 500 }),
    ];
    const { service } = svc(docs);
    const r = await service.queryAvailability({ symbol: 'QQQ' });
    expect(r.contracts.map((c) => c.contractId)).toEqual(['A', 'C', 'D', 'B']);
  });

  it('sets truncated and drops the overflow doc at cap+1', async () => {
    const docs = Array.from({ length: 4 }, (_, i) =>
      catalogDoc({ contractId: `C${i}`, expiration: '2026-05-15', strike: 500 + i }),
    );
    const { service } = svc(docs);
    const r = await service.queryAvailability({ symbol: 'QQQ' }, 3);
    expect(r.contracts).toHaveLength(3);
    expect(r.truncated).toBe(true);
    expect(r.contracts.map((c) => c.strike)).toEqual([500, 501, 502]);
    const r2 = await service.queryAvailability({ symbol: 'QQQ' }, 4);
    expect(r2.truncated).toBe(false);
    expect(r2.contracts).toHaveLength(4);
  });

  it('strips lastUpdated from returned entries', async () => {
    const { service } = svc();
    const r = await service.queryAvailability({ symbol: 'QQQ' });
    expect(r.contracts.every((c) => !('lastUpdated' in c))).toBe(true);
  });

  it('returns an empty result for an unmatched symbol', async () => {
    const { service } = svc([]);
    const r = await service.queryAvailability({ symbol: 'QQQ' });
    expect(r).toEqual({ contracts: [], truncated: false });
  });
});

describe('ContractAvailabilityQueryService — ordered pages', () => {
  it('orders server-side (expiration → strike → __name__) and caps reads at cap+1 matches', async () => {
    const docs = Array.from({ length: 10 }, (_, i) =>
      catalogDoc({ contractId: `C${String(i).padStart(2, '0')}`, expiration: '2026-05-15', strike: 500 + i }),
    );
    const { service, meta } = svc(docs, 3);
    const r = await service.queryAvailability({ symbol: 'QQQ' }, 4);
    expect(meta[0].orderBy).toEqual(['expiration', 'strike', '__name__']);
    expect(meta[0].limit).toBe(3);
    // want = 5 → page 1 (3) + page 2 (2 consumed) — never reads page 3
    expect(meta).toHaveLength(2);
    expect(meta[1].startAfter).toBe(true);
    expect(r.truncated).toBe(true);
    expect(r.contracts.map((c) => c.contractId)).toEqual(['C00', 'C01', 'C02', 'C03']);
  });

  it('keeps paging until cap+1 post-filtered matches, skipping non-matches', async () => {
    // strikes 500..509; only even-dollar strikes pass strikeStep=2
    const docs = Array.from({ length: 10 }, (_, i) =>
      catalogDoc({ contractId: `C${i}`, expiration: '2026-05-15', strike: 500 + i }),
    );
    const { service, meta } = svc(docs, 3);
    const r = await service.queryAvailability({ symbol: 'QQQ', strikeStep: 2 }, 2);
    // page1: 500,502 match (2); page2: 504 match (3 ≥ want) → stops
    expect(meta).toHaveLength(2);
    expect(r.truncated).toBe(true);
    expect(r.contracts.map((c) => c.contractId)).toEqual(['C0', 'C2']);
  });

  it('reads every page when the post-filter is sparse and matches are late in the scan', async () => {
    const docs = Array.from({ length: 7 }, (_, i) =>
      catalogDoc({ contractId: `C${i}`, expiration: '2026-05-15', strike: 500 + i }),
    );
    const { service, meta } = svc(docs, 3);
    // 50600¢ is the only strike divisible by 1100¢ — a strikeStep-only
    // query stays on the ordered path (no range dim) and must scan to
    // the last doc.
    const r = await service.queryAvailability({ symbol: 'QQQ', strikeStep: 11 });
    expect(r.contracts.map((c) => c.contractId)).toEqual(['C6']);
    expect(meta).toHaveLength(3); // 3 + 3 + 1 — exhausted
    expect(r.truncated).toBe(false);
  });

  it('pushes expiration bounds alongside the ordering on the ordered path', async () => {
    const { service, executed, meta } = svc();
    await service.queryAvailability({ symbol: 'QQQ', expirationGte: '2026-06-01' });
    expect(executed[0]).toContainEqual({ field: 'expiration', op: '>=', value: '2026-06-01' });
    expect(meta[0].orderBy).toEqual(['expiration', 'strike', '__name__']);
  });

  it('does NOT order/paginate for firstObserved or strike primaries — one selective get()', async () => {
    const { service, meta } = svc();
    await service.queryAvailability({ symbol: 'QQQ', firstObservedGte: '2026-02-01' });
    await service.queryAvailability({ symbol: 'QQQ', strikeGte: 505 });
    expect(meta).toHaveLength(2);
    expect(meta.every((m) => m.orderBy.length === 0 && m.limit === undefined)).toBe(true);
  });
});
