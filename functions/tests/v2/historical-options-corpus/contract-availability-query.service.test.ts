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
  /** How the query was consumed — the service only streams. */
  via: 'stream';
}

/**
 * A chainable fake that records `where` calls per query and evaluates them
 * against a fixed doc set at read time — enough to exercise the streamed
 * scan loops faithfully. `where`/`orderBy` return new instances carrying
 * accumulated state, matching the real SDK's immutable query chain.
 * `streamed.count` tracks docs consumed; `streamed.closed` counts
 * iterators closed early (generator `return()`), proving early exits
 * actually propagate to the stream's consumer side.
 */
class FakeQuery {
  constructor(
    private readonly docs: ContractCatalogDoc[],
    private readonly executed: WhereClause[][],
    private readonly meta: QueryMeta[],
    private readonly streamed: { count: number; closed: number },
    public readonly clauses: WhereClause[] = [],
    private readonly orderBys: string[] = [],
  ) {}
  private derive(o: {
    clauses?: WhereClause[];
    orderBys?: string[];
  }): FakeQuery {
    return new FakeQuery(
      this.docs,
      this.executed,
      this.meta,
      this.streamed,
      o.clauses ?? this.clauses,
      o.orderBys ?? this.orderBys,
    );
  }
  where(field: string, op: string, value: unknown): FakeQuery {
    return this.derive({ clauses: [...this.clauses, { field, op, value }] });
  }
  orderBy(field: unknown): FakeQuery {
    return this.derive({ orderBys: [...this.orderBys, typeof field === 'string' ? field : '__name__'] });
  }
  /** Mirrors `Query.stream()` — records clauses/orderBy, yields matching
   *  docs in order; the generator's `finally` marks early iterator
   *  close so tests can assert the service really exits the consumer
   *  stream early. */
  stream(): AsyncIterable<{ id: string; data(): ContractCatalogDoc }> {
    this.executed.push(this.clauses);
    this.meta.push({ orderBy: [...this.orderBys], via: 'stream' });
    let hits = this.docs.filter((d) => this.clauses.every((c) => matches(d, c)));
    if (this.orderBys.length) hits = [...hits].sort((a, b) => compareByOrder(a, b, this.orderBys));
    const streamed = this.streamed;
    return {
      async *[Symbol.asyncIterator]() {
        let completed = false;
        try {
          for (const d of hits) {
            streamed.count++;
            yield { id: d.contractId, data: () => d };
          }
          completed = true;
        } finally {
          if (!completed) streamed.closed++;
        }
      },
    };
  }
}

interface FakeFirestore {
  executedQueries: WhereClause[][];
  queryMeta: QueryMeta[];
  /** Docs yielded by fake streams + iterators closed early. */
  streamedDocs: { count: number; closed: number };
  /** Every `collection/doc/collection` path walked, joined with `/`. */
  paths: string[];
  db: unknown;
}

function createFakeFirestore(docs: ContractCatalogDoc[]): FakeFirestore {
  const executed: WhereClause[][] = [];
  const meta: QueryMeta[] = [];
  const streamed = { count: 0, closed: 0 };
  const paths: string[] = [];
  const db = {
    collection: jest.fn((col: string) => ({
      doc: jest.fn((docId: string) => ({
        collection: jest.fn((sub: string) => {
          paths.push(`${col}/${docId}/${sub}`);
          return new FakeQuery(docs, executed, meta, streamed);
        }),
      })),
    })),
  };
  return { executedQueries: executed, queryMeta: meta, streamedDocs: streamed, paths, db };
}

// ---- Tests ----

const DOCS = [
  catalogDoc({ contractId: 'QQQ260515C00500000', expiration: '2026-05-15', strike: 500, type: 'call', firstObserved: '2026-01-05' }),
  catalogDoc({ contractId: 'QQQ260515P00500000', expiration: '2026-05-15', strike: 500, type: 'put', firstObserved: '2026-02-10' }),
  catalogDoc({ contractId: 'QQQ260515C00510000', expiration: '2026-05-15', strike: 510, type: 'call', firstObserved: '2026-01-05' }),
  catalogDoc({ contractId: 'QQQ260619C00500000', expiration: '2026-06-19', strike: 500, type: 'call', firstObserved: '2026-03-01' }),
  catalogDoc({ contractId: 'QQZTEST', expiration: '2026-05-15', strike: 512.5, type: 'call', firstObserved: '2026-01-05' }),
];

function svc(docs: ContractCatalogDoc[] = DOCS, readCeiling?: number) {
  const fake = createFakeFirestore(docs);
  const service = new ContractAvailabilityQueryService(fake.db as unknown as Firestore, readCeiling);
  return { service, executed: fake.executedQueries, meta: fake.queryMeta, streamed: fake.streamedDocs, paths: fake.paths };
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

describe('ContractAvailabilityQueryService — ordered scan', () => {
  it('orders server-side (expiration → strike → __name__) and stops at cap+1 matches', async () => {
    const docs = Array.from({ length: 10 }, (_, i) =>
      catalogDoc({ contractId: `C${String(i).padStart(2, '0')}`, expiration: '2026-05-15', strike: 500 + i }),
    );
    const { service, meta, streamed } = svc(docs);
    const r = await service.queryAvailability({ symbol: 'QQQ' }, 4);
    expect(meta[0].orderBy).toEqual(['expiration', 'strike', '__name__']);
    expect(meta[0].via).toBe('stream');
    // want = 5 → consumes only 5 docs — never scans the rest
    expect(streamed.count).toBe(5);
    expect(r.truncated).toBe(true);
    expect(r.contracts.map((c) => c.contractId)).toEqual(['C00', 'C01', 'C02', 'C03']);
  });

  it('keeps scanning until cap+1 post-filtered matches, skipping non-matches', async () => {
    // strikes 500..509; only even-dollar strikes pass strikeStep=2
    const docs = Array.from({ length: 10 }, (_, i) =>
      catalogDoc({ contractId: `C${i}`, expiration: '2026-05-15', strike: 500 + i }),
    );
    const { service, streamed } = svc(docs);
    const r = await service.queryAvailability({ symbol: 'QQQ', strikeStep: 2 }, 2);
    // want = 3 → 500,502,504 match on docs 0,2,4 → stops after 5 consumed
    expect(streamed.count).toBe(5);
    expect(r.truncated).toBe(true);
    expect(r.contracts.map((c) => c.contractId)).toEqual(['C0', 'C2']);
  });

  it('reads every doc when the post-filter is sparse and matches are late in the scan', async () => {
    const docs = Array.from({ length: 7 }, (_, i) =>
      catalogDoc({ contractId: `C${i}`, expiration: '2026-05-15', strike: 500 + i }),
    );
    const { service, streamed } = svc(docs);
    // 50600¢ is the only strike divisible by 1100¢ — a strikeStep-only
    // query stays on the ordered path (no range dim) and must scan to
    // the last doc.
    const r = await service.queryAvailability({ symbol: 'QQQ', strikeStep: 11 });
    expect(r.contracts.map((c) => c.contractId)).toEqual(['C6']);
    expect(streamed.count).toBe(7); // exhausted
    expect(r.truncated).toBe(false);
  });

  it('pushes expiration bounds alongside the ordering on the ordered path', async () => {
    const { service, executed, meta } = svc();
    await service.queryAvailability({ symbol: 'QQQ', expirationGte: '2026-06-01' });
    expect(executed[0]).toContainEqual({ field: 'expiration', op: '>=', value: '2026-06-01' });
    expect(meta[0].orderBy).toEqual(['expiration', 'strike', '__name__']);
  });

  it('streams primary-range scans in primary-field order', async () => {
    const docs = Array.from({ length: 7 }, (_, i) =>
      catalogDoc({ contractId: `C${i}`, firstObserved: `2026-01-0${i + 1}` }),
    );
    const { service, meta, streamed } = svc(docs);
    const r = await service.queryAvailability({ symbol: 'QQQ', firstObservedGte: '2026-01-01' });
    expect(meta[0].orderBy).toEqual(['firstObserved', '__name__']);
    expect(meta[0].via).toBe('stream');
    expect(streamed.count).toBe(7); // exhausted
    expect(r.contracts).toHaveLength(7);
    expect(r.truncated).toBe(false);
  });

  it('streams strike-primary scans in strike order', async () => {
    const { service, meta } = svc();
    await service.queryAvailability({ symbol: 'QQQ', strikeGte: 505 });
    expect(meta[0].orderBy).toEqual(['strike', '__name__']);
    expect(meta[0].via).toBe('stream');
  });
});

describe('ContractAvailabilityQueryService — read ceiling', () => {
  it('stops the primary-range scan at the ceiling and reports truncated', async () => {
    // 10 matching docs, ceiling 5 → consumes 5 and stops.
    const docs = Array.from({ length: 10 }, (_, i) =>
      catalogDoc({ contractId: `C${String(i).padStart(2, '0')}`, firstObserved: `2026-01-${String(i + 1).padStart(2, '0')}` }),
    );
    const { service, streamed } = svc(docs, 5);
    const r = await service.queryAvailability({ symbol: 'QQQ', firstObservedGte: '2026-01-01' }, 100);
    expect(streamed.count).toBe(5);
    expect(streamed.closed).toBe(1); // iterator closed early — consumer-side close propagated
    expect(r.truncated).toBe(true);
    expect(r.contracts).toHaveLength(5); // everything scanned so far matched
  });

  it('stops the ordered scan at the ceiling before cap+1 matches and reports truncated', async () => {
    // strikeStep-only query stays on the ordered path. Only doc C9
    // (strike 510) would pass step 10 — but the ceiling stops the scan
    // at doc 5 before it's reached, so matches never reach `want`.
    const docs = Array.from({ length: 10 }, (_, i) =>
      catalogDoc({ contractId: `C${i}`, expiration: '2026-05-15', strike: 501 + i }),
    );
    const { service, streamed } = svc(docs, 5);
    const r = await service.queryAvailability({ symbol: 'QQQ', strikeStep: 10 });
    expect(streamed.count).toBe(5);
    expect(r.contracts).toHaveLength(0);
    expect(r.truncated).toBe(true);
  });

  it('does not trigger when the collection exhausts under the ceiling', async () => {
    const docs = Array.from({ length: 5 }, (_, i) =>
      catalogDoc({ contractId: `C${i}`, firstObserved: `2026-01-0${i + 1}` }),
    );
    const { service } = svc(docs, 50);
    const r = await service.queryAvailability({ symbol: 'QQQ', firstObservedGte: '2026-01-01' });
    expect(r.truncated).toBe(false);
    expect(r.contracts).toHaveLength(5);
  });

  it('applies the same ceiling on the expirations `in` path', async () => {
    // The 30-value `in` cap bounds value count, not doc count — a dense
    // expiration could still return thousands of docs per chunk.
    const { service, streamed } = svc(DOCS, 3);
    const r = await service.queryAvailability({ symbol: 'QQQ', expirations: ['2026-05-15', '2026-06-19'] });
    expect(streamed.count).toBe(3);
    expect(r.truncated).toBe(true);
    expect(r.contracts).toHaveLength(3);
  });

  it('does not trigger on the expirations path under the ceiling', async () => {
    const { service } = svc(DOCS, 50);
    const r = await service.queryAvailability({ symbol: 'QQQ', expirations: ['2026-05-15', '2026-06-19'] });
    expect(r.truncated).toBe(false);
    expect(r.contracts).toHaveLength(5);
  });

  it('shares the scanned-doc budget across in-list chunks', async () => {
    // 35 expirations → 2 chunks. Chunk 1 scans the 4 docs expiring
    // 2026-05-15; chunk 2 scans the single 06-19 doc — neither chunk
    // alone reaches ceiling 5, but the shared budget does.
    const expirations = [
      ...Array.from({ length: 29 }, (_, i) => `2027-01-${String(i + 1).padStart(2, '0')}`),
      '2026-05-15',
      ...Array.from({ length: 4 }, (_, i) => `2027-02-0${i + 1}`),
      '2026-06-19',
    ];
    const { service, executed, streamed } = svc(DOCS, 5);
    const r = await service.queryAvailability({ symbol: 'QQQ', expirations });
    expect(executed).toHaveLength(2);
    expect(streamed.count).toBe(5); // 4 from chunk 1 + 1 from chunk 2
    expect(r.truncated).toBe(true);
    expect(r.contracts).toHaveLength(5);
  });
});
