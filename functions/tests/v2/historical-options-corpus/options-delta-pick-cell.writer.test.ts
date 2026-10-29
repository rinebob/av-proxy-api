/**
 * Tests for the options-delta-picks cell doc writer (Thread #214 / Task #222).
 *
 * Firestore is faked with an in-memory doc store: tx.get reads it, tx.set
 * mutates it, so merge semantics (absent→write, miss→upgrade, pick→immutable)
 * and header recompute are exercised through the real code path — no emulator.
 */
import {
  OPTIONS_DELTA_PICKS_COLLECTION,
  PICK_GRID_VERSION,
  type CellYearDoc,
  type DayPick,
  type DayPickEntry,
} from '@shared/options';

import { mergeDayEntries } from '../../../src/v2/historical-options-corpus/services/options-delta-pick-cell.writer';

// --- In-memory Firestore fake -------------------------------------------

const store = new Map<string, Record<string, unknown>>();
const txWrites: string[] = [];

const fakeDb = {
  doc: (path: string) => ({ path }),
  runTransaction: async (fn: (tx: unknown) => Promise<unknown>) =>
    fn({
      get: async (ref: { path: string }) => {
        const d = store.get(ref.path);
        return { exists: d !== undefined, data: () => d };
      },
      set: (ref: { path: string }, data: Record<string, unknown>) => {
        txWrites.push(ref.path);
        store.set(ref.path, data);
      },
    }),
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = fakeDb as any;

const PATH = (cellId: string, year: number) =>
  `${OPTIONS_DELTA_PICKS_COLLECTION}/${cellId}/years/${year}`;

const docAt = (path: string) => store.get(path) as CellYearDoc | undefined;

// --- Fixtures --------------------------------------------------------------

const PICK: DayPick = {
  contractId: 'QQQ260515P00565000',
  expiration: '2026-05-15',
  dte: 44,
  strike: 565,
  delta: -0.204,
  iv: 0.198,
  mark: 8.42,
  bid: 8.3,
  ask: 8.54,
  volume: 412,
  openInterest: 5210,
  underlyingClose: 584.31,
};

const PICK_B: DayPick = { ...PICK, contractId: 'QQQ260619P00560000', delta: -0.19 };

const NO_CHAIN = { status: 'no_chain' as const, underlyingClose: 600 };
const NO_MATCH = { status: 'no_match' as const, underlyingClose: 600, reason: 'no eligible contracts' };

const merge = (cellId: string, entries: Record<string, DayPickEntry>) =>
  mergeDayEntries(db, cellId, new Map(Object.entries(entries)));

const CELL = 'QQQ-put-20-45';

beforeEach(() => {
  store.clear();
  txWrites.length = 0;
});

// --- Merge decision table ---------------------------------------------------

describe('merge decision table', () => {
  it('writes when the date is absent', async () => {
    const res = await merge(CELL, { '2026-04-01': PICK });
    expect(res.written).toEqual(['2026-04-01']);
    expect(res.skipped).toEqual([]);
    expect(docAt(PATH(CELL, 2026))?.days['2026-04-01']).toEqual(PICK);
  });

  it('never overwrites an existing pick — even with another pick', async () => {
    await merge(CELL, { '2026-04-01': PICK });
    const res = await merge(CELL, { '2026-04-01': PICK_B });
    expect(res.skipped).toEqual(['2026-04-01']);
    expect(docAt(PATH(CELL, 2026))?.days['2026-04-01']).toEqual(PICK);
  });

  it('never overwrites an existing pick with a miss', async () => {
    await merge(CELL, { '2026-04-01': PICK });
    const res = await merge(CELL, { '2026-04-01': NO_MATCH });
    expect(res.skipped).toEqual(['2026-04-01']);
    expect(docAt(PATH(CELL, 2026))?.days['2026-04-01']).toEqual(PICK);
  });

  it('upgrades a no_chain miss to a real pick (self-repair)', async () => {
    await merge(CELL, { '2026-04-01': NO_CHAIN });
    const res = await merge(CELL, { '2026-04-01': PICK });
    expect(res.written).toEqual(['2026-04-01']);
    expect(docAt(PATH(CELL, 2026))?.days['2026-04-01']).toEqual(PICK);
  });

  it('upgrades no_chain to no_match — a more informative status', async () => {
    await merge(CELL, { '2026-04-01': NO_CHAIN });
    const res = await merge(CELL, { '2026-04-01': NO_MATCH });
    expect(res.written).toEqual(['2026-04-01']);
    expect(docAt(PATH(CELL, 2026))?.days['2026-04-01']).toEqual(NO_MATCH);
  });

  it('does not downgrade no_match back to no_chain', async () => {
    await merge(CELL, { '2026-04-01': NO_MATCH });
    const res = await merge(CELL, { '2026-04-01': NO_CHAIN });
    expect(res.skipped).toEqual(['2026-04-01']);
    expect(docAt(PATH(CELL, 2026))?.days['2026-04-01']).toEqual(NO_MATCH);
  });

  it('does not rewrite a miss with the same status (not better)', async () => {
    await merge(CELL, { '2026-04-01': NO_CHAIN });
    const res = await merge(CELL, { '2026-04-01': { status: 'no_chain', underlyingClose: 1 } });
    expect(res.skipped).toEqual(['2026-04-01']);
    expect(docAt(PATH(CELL, 2026))?.days['2026-04-01']).toEqual(NO_CHAIN);
  });

  it('leaves unrecognized existing shapes untouched', async () => {
    store.set(PATH(CELL, 2026), {
      days: { '2026-04-01': { garbage: true } },
    });
    const res = await merge(CELL, { '2026-04-01': PICK });
    expect(res.skipped).toEqual(['2026-04-01']);
    expect((docAt(PATH(CELL, 2026))?.days as Record<string, unknown>)['2026-04-01']).toEqual({ garbage: true });
  });
});

// --- Header fields ----------------------------------------------------------

describe('header maintenance', () => {
  it('scaffolds the full doc on first write with signed targetDelta', async () => {
    await merge('QQQ-put-20-45', { '2026-04-01': PICK });
    const doc = docAt(PATH('QQQ-put-20-45', 2026))!;
    expect(doc.symbol).toBe('QQQ');
    expect(doc.type).toBe('put');
    expect(doc.targetDelta).toBe(-0.2);
    expect(doc.expiry).toEqual({ mode: 'nearestDte', dte: 45 });
    expect(doc.gridVersion).toBe(PICK_GRID_VERSION);
    expect(doc.firstDate).toBe('2026-04-01');
    expect(doc.lastDate).toBe('2026-04-01');
    expect(doc.pickCount).toBe(1);
    expect(doc.missCount).toBe(0);
    expect(doc.updatedAt).toBeDefined();
  });

  it('emits positive targetDelta for calls', async () => {
    await merge('SPY-call-30-30', { '2026-04-01': { ...PICK, delta: 0.31 } });
    expect(docAt(PATH('SPY-call-30-30', 2026))!.targetDelta).toBe(0.3);
  });

  it('recomputes counts and date bounds after merges', async () => {
    await merge(CELL, {
      '2026-04-01': PICK,
      '2026-04-02': NO_CHAIN,
      '2026-04-03': NO_MATCH,
    });
    await merge(CELL, { '2026-04-02': PICK_B }); // self-repair the miss
    const doc = docAt(PATH(CELL, 2026))!;
    expect(doc.firstDate).toBe('2026-04-01');
    expect(doc.lastDate).toBe('2026-04-03');
    expect(doc.pickCount).toBe(2);
    expect(doc.missCount).toBe(1);
  });

  it('counts unrecognized entries as neither pick nor miss', async () => {
    store.set(PATH(CELL, 2026), {
      days: { '2026-03-31': { garbage: true } },
    });
    await merge(CELL, { '2026-04-01': PICK });
    const doc = docAt(PATH(CELL, 2026))!;
    expect(doc.pickCount).toBe(1);
    expect(doc.missCount).toBe(0);
    expect(doc.firstDate).toBe('2026-03-31');
  });
});

// --- Batching & year shards ---------------------------------------------------

describe('batching', () => {
  it('merges many dates into one year doc in a single write', async () => {
    const res = await merge(CELL, {
      '2026-04-01': PICK,
      '2026-04-02': NO_CHAIN,
      '2026-04-03': PICK_B,
    });
    expect(res.written).toHaveLength(3);
    // One doc → one tx.set (not one write per date).
    expect(txWrites).toEqual([PATH(CELL, 2026)]);
  });

  it('shards by chain-date year, not expiration year (Dec 31 / Jan 1)', async () => {
    const res = await merge(CELL, {
      '2026-12-31': PICK,
      '2027-01-01': PICK_B,
    });
    expect(res.written).toHaveLength(2);
    expect(docAt(PATH(CELL, 2026))?.days['2026-12-31']).toEqual(PICK);
    expect(docAt(PATH(CELL, 2027))?.days['2027-01-01']).toEqual(PICK_B);
    expect(docAt(PATH(CELL, 2026))?.lastDate).toBe('2026-12-31');
    expect(docAt(PATH(CELL, 2027))?.firstDate).toBe('2027-01-01');
  });
});

// --- Idempotency & validation -------------------------------------------------

describe('idempotency and validation', () => {
  it('re-running with identical picks performs zero writes', async () => {
    await merge(CELL, { '2026-04-01': PICK, '2026-04-02': PICK_B });
    txWrites.length = 0;
    const res = await merge(CELL, { '2026-04-01': PICK, '2026-04-02': PICK_B });
    expect(res.written).toEqual([]);
    expect(res.skipped).toEqual(['2026-04-01', '2026-04-02']);
    expect(txWrites).toEqual([]); // unchanged doc → no set at all
  });

  it('throws on a malformed cellId', async () => {
    await expect(merge('not-a-cell', { '2026-04-01': PICK })).rejects.toThrow(/cellId/);
  });

  it('throws on a malformed day key', async () => {
    await expect(merge(CELL, { '2026-13-45': PICK })).rejects.toThrow(/day key/);
  });

  it('throws on an entry that is neither pick nor miss (would become un-repairable)', async () => {
    await expect(
      merge(CELL, { '2026-04-01': { garbage: true } as unknown as DayPickEntry }),
    ).rejects.toThrow(/not a valid pick-or-miss/);
    expect(txWrites).toEqual([]);
  });

  it('throws on a hybrid pick+status entry (double-counts as pick AND miss)', async () => {
    await expect(
      merge(CELL, { '2026-04-01': { ...PICK, status: 'no_chain' } as unknown as DayPickEntry }),
    ).rejects.toThrow(/not a valid pick-or-miss/);
    expect(txWrites).toEqual([]);
  });

  it('throws a friendly error on a primitive entry (not a TypeError)', async () => {
    await expect(
      merge(CELL, { '2026-04-01': 'garbage' as unknown as DayPickEntry }),
    ).rejects.toThrow(/not a valid pick-or-miss/);
  });

  it('skips a corrupt primitive day value instead of crashing (unrecognized shape)', async () => {
    store.set(PATH(CELL, 2026), {
      days: { '2026-04-01': 'corrupt' },
    });
    const res = await merge(CELL, { '2026-04-01': PICK });
    expect(res.skipped).toEqual(['2026-04-01']);
    expect((docAt(PATH(CELL, 2026))?.days as Record<string, unknown>)['2026-04-01']).toBe('corrupt');
  });

  it('empty entries map performs no writes', async () => {
    const res = await merge(CELL, {});
    expect(res.written).toEqual([]);
    expect(txWrites).toEqual([]);
  });
});
