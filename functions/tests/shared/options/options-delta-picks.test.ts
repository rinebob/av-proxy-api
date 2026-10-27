/**
 * Tests for shared/options delta-pick grid + cell-id codec (Task #219).
 *
 * Verifies:
 * - PICK_GRID enumerates exactly 380 cells (19 deltas x 10 DTEs x 2 types)
 * - cellId encode/decode round-trips and rejects malformed ids
 * - cellYearDocPath matches the year-shard layout (even segment count)
 * - day-entry type guards discriminate pick vs miss
 */
import {
  OPTIONS_DELTA_PICKS_COLLECTION,
  OPTIONS_DELTA_PICKS_YEARS_SUBCOLLECTION,
  PICK_GRID_VERSION,
  type DayPick,
  type DayMiss,
  type DayPickEntry,
  type CellYearDoc,
} from '@shared/options/options-delta-picks.types';
import {
  PICK_GRID,
  PICK_GRID_DELTA_PCTS,
  PICK_GRID_DTES,
  PICK_GRID_TYPES,
  buildCellId,
  parseCellId,
  cellYearDocPath,
  isPickEntry,
  isMissEntry,
  isRepairableEntry,
} from '@shared/options/options-delta-picks.utils';

describe('PICK_GRID', () => {
  it('enumerates 19 delta magnitudes x 10 DTEs x 2 types = 380 cells', () => {
    expect(PICK_GRID).toHaveLength(380);
    expect(PICK_GRID_DELTA_PCTS).toHaveLength(19);
    expect(PICK_GRID_DTES).toHaveLength(10);
    expect(PICK_GRID_TYPES).toEqual(['put', 'call']);
  });

  it('covers delta magnitudes 5..95 in steps of 5', () => {
    expect(PICK_GRID_DELTA_PCTS[0]).toBe(5);
    expect(PICK_GRID_DELTA_PCTS[18]).toBe(95);
    expect(PICK_GRID_DELTA_PCTS).toEqual(
      Array.from({ length: 19 }, (_, i) => (i + 1) * 5),
    );
  });

  it('covers the locked DTE set', () => {
    expect(PICK_GRID_DTES).toEqual([7, 14, 21, 30, 45, 60, 90, 120, 180, 365]);
  });

  it('has no duplicate cells', () => {
    const keys = new Set(PICK_GRID.map((c) => `${c.type}-${c.deltaPct}-${c.dte}`));
    expect(keys.size).toBe(380);
  });
});

describe('cellId codec', () => {
  it('builds the SPEC-shaped id {SYM}-{type}-{deltaPct}-{dte}', () => {
    expect(buildCellId('QQQ', 'put', 20, 45)).toBe('QQQ-put-20-45');
    expect(buildCellId('SPY', 'call', 30, 30)).toBe('SPY-call-30-30');
  });

  it('uppercases the symbol segment', () => {
    expect(buildCellId('qqq', 'put', 20, 45)).toBe('QQQ-put-20-45');
  });

  it('round-trips build -> parse', () => {
    const id = buildCellId('QQQ', 'put', 20, 45);
    expect(parseCellId(id)).toEqual({ symbol: 'QQQ', type: 'put', deltaPct: 20, dte: 45 });
  });

  it('rejects malformed ids', () => {
    expect(parseCellId('QQQ-put-20')).toBeNull();            // missing segment
    expect(parseCellId('QQQ-put-20-45-extra')).toBeNull();   // extra segment
    expect(parseCellId('QQQ-straddle-20-45')).toBeNull();    // bad type
    expect(parseCellId('QQQ-put-0.2-45')).toBeNull();        // non-integer deltaPct
    expect(parseCellId('QQQ-put--20-45')).toBeNull();        // empty segment (type slot)
    expect(parseCellId('QQQ-put-20-0')).toBeNull();          // zero dte
    expect(parseCellId('QQQ-put-99999999999999999999-45')).toBeNull(); // unsafe integer
    expect(parseCellId('QQQ-put-9007199254740993-45')).toBeNull();     // > MAX_SAFE_INTEGER
    expect(parseCellId('-put-20-45')).toBeNull();            // empty symbol
    expect(parseCellId('')).toBeNull();
  });

  it('round-trips hyphenated symbols (BRK-B, BF-B)', () => {
    const id = buildCellId('BRK-B', 'put', 20, 45);
    expect(id).toBe('BRK-B-put-20-45');
    expect(parseCellId(id)).toEqual({ symbol: 'BRK-B', type: 'put', deltaPct: 20, dte: 45 });
    expect(parseCellId('BF-B-call-30-30')).toEqual({ symbol: 'BF-B', type: 'call', deltaPct: 30, dte: 30 });
  });

  it('rejects non-decimal numeric segments the encoder never emits', () => {
    expect(parseCellId('QQQ-put-1e2-45')).toBeNull();   // scientific notation
    expect(parseCellId('QQQ-put-0x14-45')).toBeNull();  // hex
    expect(parseCellId('QQQ-put- 20-45')).toBeNull();   // leading space
    expect(parseCellId('QQQ-put-20-4.5')).toBeNull();   // decimal dte
  });

  it('uppercases a lowercase symbol segment on parse', () => {
    expect(parseCellId('qqq-put-20-45')).toEqual({ symbol: 'QQQ', type: 'put', deltaPct: 20, dte: 45 });
  });

  it('buildCellId throws on components its parser would reject', () => {
    expect(() => buildCellId('QQQ', 'put', 0.2, 45)).toThrow();  // non-integer deltaPct
    expect(() => buildCellId('QQQ', 'put', 20, 0)).toThrow();    // zero dte
    expect(() => buildCellId('QQQ', 'put', 1e21, 45)).toThrow(); // unsafe integer → '1e+21' segment
    expect(() => buildCellId('', 'put', 20, 45)).toThrow();      // empty symbol
    expect(() => buildCellId('-', 'put', 20, 45)).toThrow();     // bare-hyphen symbol
    expect(() => buildCellId('Q QQ', 'put', 20, 45)).toThrow();  // whitespace symbol
  });

  it('does not require grid membership — custom cells parse too', () => {
    // Off-grid deltas/DTEs are deferred, but the codec itself is generic:
    // a future materialized custom cell must parse.
    expect(parseCellId('QQQ-put-37-63')).toEqual({ symbol: 'QQQ', type: 'put', deltaPct: 37, dte: 63 });
  });
});

describe('cellYearDocPath', () => {
  it('produces options-delta-picks/{cell}/years/{YYYY} — an even segment count', () => {
    const path = cellYearDocPath('QQQ-put-20-45', 2026);
    expect(path).toBe('options-delta-picks/QQQ-put-20-45/years/2026');
    expect(path.split('/').length % 2).toBe(0);
    expect(path.startsWith(OPTIONS_DELTA_PICKS_COLLECTION)).toBe(true);
    expect(path.split('/')[2]).toBe(OPTIONS_DELTA_PICKS_YEARS_SUBCOLLECTION);
  });
});

describe('day-entry guards', () => {
  const pick: DayPick = {
    underlyingClose: 584.31,
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
  };
  const miss: DayMiss = { status: 'no_chain', underlyingClose: 617.8 };

  it('isPickEntry keys on contractId presence, not a status field', () => {
    expect(isPickEntry(pick)).toBe(true);
    expect(isPickEntry(miss)).toBe(false);
  });

  it('isMissEntry keys on status', () => {
    expect(isMissEntry(miss)).toBe(true);
    expect(isMissEntry(pick)).toBe(false);
  });

  it('isRepairableEntry: misses self-heal, picks are immutable', () => {
    expect(isRepairableEntry(miss)).toBe(true);
    expect(isRepairableEntry({ status: 'no_match' })).toBe(true);
    expect(isRepairableEntry(pick)).toBe(false);
  });

  it('isRepairableEntry refuses corrupt pick+miss hybrids', () => {
    const hybrid = { status: 'no_chain', contractId: 'QQQ260515P00565000' } as DayPickEntry;
    expect(isPickEntry(hybrid)).toBe(true);
    expect(isRepairableEntry(hybrid)).toBe(false);
  });
});

describe('CellYearDoc wire shape', () => {
  it('survives JSON round-trip (Firestore-writeable)', () => {
    const doc: CellYearDoc = {
      symbol: 'QQQ',
      type: 'put',
      targetDelta: -0.2,
      expiry: { mode: 'nearestDte', dte: 45 },
      gridVersion: PICK_GRID_VERSION,
      firstDate: '2026-01-02',
      lastDate: '2026-04-30',
      pickCount: 80,
      missCount: 2,
      days: {
        '2026-01-02': {
          underlyingClose: 510.12,
          contractId: 'QQQ260220P00500000',
          expiration: '2026-02-20',
          dte: 49,
          strike: 500,
          delta: -0.201,
          iv: 0.21,
          mark: 7.9,
          bid: 7.8,
          ask: 8.0,
          volume: 900,
          openInterest: 12000,
        },
        '2026-01-05': { status: 'no_chain' },
      },
      updatedAt: { seconds: 1777507200, nanoseconds: 0 },
    };
    const roundTrip = JSON.parse(JSON.stringify(doc)) as CellYearDoc;
    expect(roundTrip).toEqual(doc);
    expect(isPickEntry(roundTrip.days['2026-01-02'])).toBe(true);
    expect(isMissEntry(roundTrip.days['2026-01-05'])).toBe(true);
  });
});

describe('constants', () => {
  it('grid version is 1 for the initial schema', () => {
    expect(PICK_GRID_VERSION).toBe(1);
  });
});
