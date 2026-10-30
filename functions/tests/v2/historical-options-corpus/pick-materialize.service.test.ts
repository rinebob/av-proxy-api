/**
 * Tests for the pick-materialization core (Thread #214 / Task #223).
 *
 * Firestore is faked in-memory (same approach as the writer tests); GCS
 * listing/loading, closes, and logging are stub deps, so the real
 * pickCellsForDate → mergeDayEntries path runs end-to-end per date.
 */
import { AvOptionType, type AvOptionContract } from '@shared/alpha-vantage';
import {
  PICK_GRID,
  PICK_GRID_VERSION,
  buildCellId,
  cellYearDocPath,
  type CellYearDoc,
} from '@shared/options';

import { materializeSymbolPicks } from '../../../src/v2/historical-options-corpus/services/pick-materialize.service';
import type { PickMaterializeDeps } from '../../../src/v2/historical-options-corpus/services/pick-materialize.service';

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

const docAt = (cellId: string, year: number) =>
  store.get(cellYearDocPath(cellId, year)) as CellYearDoc | undefined;

const allCellIds = (symbol: string) =>
  PICK_GRID.map((c) => buildCellId(symbol, c.type, c.deltaPct, c.dte));

// --- Fixtures ------------------------------------------------------------

const SYM = 'QQQ';
const DATE_A = '2026-04-01';
const DATE_B = '2026-04-02';

/** One put near the 20Δ/45-DTE cell target from DATE_A (target exp ~2026-05-16, Δ -0.20). */
const CHAIN_A: AvOptionContract[] = [
  {
    contractID: 'QQQ260515P00560000',
    expiration: '2026-05-15',
    strike: '560',
    type: AvOptionType.PUT,
    delta: '-0.20',
    implied_volatility: '0.25',
    bid: '8.30',
    ask: '8.50',
    mark: '8.40',
    volume: '100',
    open_interest: '5000',
  },
];

const makeDeps = (over: Partial<PickMaterializeDeps> = {}): PickMaterializeDeps => ({
  db,
  listCorpusDates: jest.fn(async () => [DATE_A]),
  loadChain: jest.fn(async (_s: string, _d: string) => CHAIN_A),
  loadCloses: jest.fn(async () => new Map([[DATE_A, 600]])),
  logger: { info: jest.fn(), warn: jest.fn() },
  ...over,
});

beforeEach(() => {
  store.clear();
  txWrites.length = 0;
});

// --- Coverage iteration ---------------------------------------------------

describe('coverage iteration', () => {
  it('walks every stored corpus date sorted, floor 2026-01-01, one chain load per date', async () => {
    const listCorpusDates = jest.fn(async () => ['2026-04-10', DATE_A, '2025-12-31', '2025-01-05']);
    const loadChain = jest.fn(async (_s: string, _d: string) => CHAIN_A);
    const report = await materializeSymbolPicks(
      { symbol: SYM },
      makeDeps({ listCorpusDates, loadChain }),
    );

    expect(loadChain.mock.calls.map((c) => c[1])).toEqual([DATE_A, '2026-04-10']);
    expect(report.datesSeen).toBe(2);
    expect(report.datesPicked).toBe(2);
    expect(report.loadFailures).toEqual([]);
  });

  it('explicit dates skip the corpus listing (nightly/single-date bound)', async () => {
    const listCorpusDates = jest.fn(async () => { throw new Error('must not be called'); });
    const loadChain = jest.fn(async (_s: string, _d: string) => CHAIN_A);
    const report = await materializeSymbolPicks(
      { symbol: SYM, dates: [DATE_B] },
      makeDeps({ listCorpusDates, loadChain }),
    );

    expect(listCorpusDates).not.toHaveBeenCalled();
    expect(loadChain).toHaveBeenCalledWith(SYM, DATE_B);
    expect(report.datesPicked).toBe(1);
  });

  it('dedupes and floor-filters explicit dates', async () => {
    const loadChain = jest.fn(async (_s: string, _d: string) => CHAIN_A);
    const report = await materializeSymbolPicks(
      { symbol: SYM, dates: [DATE_B, DATE_A, DATE_B, '2019-06-01'] },
      makeDeps({ loadChain }),
    );
    expect(loadChain.mock.calls.map((c) => c[1])).toEqual([DATE_A, DATE_B]);
    expect(report.datesSeen).toBe(2);
  });

  it('normalizes the symbol to uppercase for listing, loading, and cell ids', async () => {
    const listCorpusDates = jest.fn(async () => [DATE_A]);
    const loadChain = jest.fn(async (_s: string, _d: string) => CHAIN_A);
    const report = await materializeSymbolPicks(
      { symbol: ' qqq ', dates: [DATE_A] },
      makeDeps({ listCorpusDates, loadChain }),
    );
    expect(loadChain).toHaveBeenCalledWith(SYM, DATE_A);
    expect(report.symbol).toBe(SYM);
    expect(docAt('QQQ-put-20-45', 2026)).toBeDefined();
    expect(listCorpusDates).not.toHaveBeenCalled();
  });

  it('explicit empty dates produce a zero report without touching deps', async () => {
    const loadChain = jest.fn();
    const loadCloses = jest.fn();
    const report = await materializeSymbolPicks(
      { symbol: SYM, dates: [] },
      makeDeps({ loadChain, loadCloses }),
    );
    expect(report).toMatchObject({
      datesSeen: 0, datesPicked: 0, datesNoChain: 0,
      loadFailures: [], cellDocsTouched: 0, daysWritten: 0, daysSkipped: 0,
    });
    expect(loadChain).not.toHaveBeenCalled();
    expect(loadCloses).not.toHaveBeenCalled();
  });
});

// --- Picker → writer fanout ----------------------------------------------

describe('picker to writer fanout', () => {
  it('materializes every grid cell doc with an entry per processed date', async () => {
    const report = await materializeSymbolPicks(
      { symbol: SYM, dates: [DATE_A] },
      makeDeps(),
    );

    const cellIds = allCellIds(SYM);
    expect(cellIds).toHaveLength(380);
    for (const cellId of cellIds) {
      const doc = docAt(cellId, 2026);
      expect(doc).toBeDefined();
      expect(doc!.symbol).toBe(SYM);
      expect(doc!.gridVersion).toBe(PICK_GRID_VERSION);
      expect(doc!.days[DATE_A]).toBeDefined();
    }
    expect(report.daysWritten).toBe(380);
    expect(report.cellDocsTouched).toBe(380);
  });

  it('a matched cell carries a real pick copied through the real picker', async () => {
    await materializeSymbolPicks({ symbol: SYM, dates: [DATE_A] }, makeDeps());
    const doc = docAt('QQQ-put-20-45', 2026)!;
    const entry = doc.days[DATE_A] as { contractId?: string; delta?: number; underlyingClose?: number };
    expect(entry.contractId).toBe('QQQ260515P00560000');
    expect(entry.delta).toBeCloseTo(-0.2);
    expect(entry.underlyingClose).toBe(600);
  });

  it('absent chain writes no_chain entries for every cell', async () => {
    const loadChain = jest.fn(async (_s: string, _d: string) => undefined);
    const report = await materializeSymbolPicks(
      { symbol: SYM, dates: [DATE_A] },
      makeDeps({ loadChain }),
    );
    expect(report.datesNoChain).toBe(1);
    expect(report.datesPicked).toBe(0);
    for (const cellId of allCellIds(SYM)) {
      expect((docAt(cellId, 2026)!.days[DATE_A] as { status: string }).status).toBe('no_chain');
    }
  });
});

// --- Failure isolation ----------------------------------------------------

describe('failure isolation', () => {
  it('a chain-load failure skips only that date and is reported', async () => {
    const loadChain = jest.fn(async (_s: string, d: string) => {
      if (d === DATE_A) throw new Error('corrupt object');
      return CHAIN_A;
    });
    const logger = { info: jest.fn(), warn: jest.fn() };
    const report = await materializeSymbolPicks(
      { symbol: SYM, dates: [DATE_A, DATE_B] },
      makeDeps({ loadChain, logger }),
    );

    expect(report.loadFailures).toEqual([DATE_A]);
    expect(report.datesPicked).toBe(1);
    const doc = docAt('QQQ-put-20-45', 2026)!;
    expect(doc.days[DATE_B]).toBeDefined();
    expect(doc.days[DATE_A]).toBeUndefined();
    expect(logger.warn).toHaveBeenCalled();
  });

  it('a closes-load failure degrades to no closes, picks still written', async () => {
    const loadCloses = jest.fn(async () => { throw new Error('bars read failed'); });
    const logger = { info: jest.fn(), warn: jest.fn() };
    const report = await materializeSymbolPicks(
      { symbol: SYM, dates: [DATE_A] },
      makeDeps({ loadCloses, logger }),
    );
    expect(report.datesPicked).toBe(1);
    const entry = docAt('QQQ-put-20-45', 2026)!.days[DATE_A] as { contractId?: string; underlyingClose?: number };
    expect(entry.contractId).toBe('QQQ260515P00560000');
    expect(entry.underlyingClose).toBeUndefined();
    expect(logger.warn).toHaveBeenCalled();
  });
});

// --- Idempotency ----------------------------------------------------------

describe('idempotency', () => {
  it('re-running a fully materialized symbol writes nothing', async () => {
    const deps = makeDeps();
    await materializeSymbolPicks({ symbol: SYM, dates: [DATE_A] }, deps);
    const writesAfterFirst = txWrites.length;
    expect(writesAfterFirst).toBeGreaterThan(0);

    txWrites.length = 0;
    const report = await materializeSymbolPicks({ symbol: SYM, dates: [DATE_A] }, deps);
    expect(report.daysWritten).toBe(0);
    expect(report.daysSkipped).toBe(380);
    expect(report.cellDocsTouched).toBe(0);
    expect(txWrites).toHaveLength(0);
  });

  it('a chain landing later repairs prior no_chain entries', async () => {
    const absent = jest.fn(async (_s: string, _d: string) => undefined);
    await materializeSymbolPicks({ symbol: SYM, dates: [DATE_A] }, makeDeps({ loadChain: absent }));
    expect((docAt('QQQ-put-20-45', 2026)!.days[DATE_A] as { status: string }).status).toBe('no_chain');

    const report = await materializeSymbolPicks({ symbol: SYM, dates: [DATE_A] }, makeDeps());
    const entry = docAt('QQQ-put-20-45', 2026)!.days[DATE_A] as { contractId?: string };
    expect(entry.contractId).toBe('QQQ260515P00560000');
    expect(report.daysWritten).toBeGreaterThan(0);
  });
});
