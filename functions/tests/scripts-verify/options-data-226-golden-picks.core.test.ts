/**
 * Tests for the golden-diff classifier (Thread #214 / Task #226).
 *
 * Seam under test: `reconcileDay` — given one golden day entry, the
 * regenerated entry, and the stored chain the regeneration saw, it must
 * assign a root-cause category and mark the diff explained/unexplained.
 * The classifier is the gate: regenerated output may legitimately diverge
 * from the prototype asset (corpus self-repair, interim-snapshot
 * supersession) — but only for reasons it can prove from the chain.
 */
import { AvOptionType, type AvOptionContract } from '@shared/alpha-vantage/av-historical-options';
import type { DayMiss, DayPick } from '@shared/options';

import {
  diffEntries,
  reconcileDay,
  specWinner,
} from '../../scripts/verify/options-data-226-golden-picks.core';
import { pickCellsForDate } from '../../src/v2/historical-options-corpus/services/options-delta-picker.service';
import { isPickEntry } from '@shared/options';

const CELL = { type: 'put' as const, deltaPct: 20, dte: 45 };
const DATE = '2026-04-01';

// 2026-05-15 is 44 calendar days after 2026-04-01 — nearest listed
// expiration to the cell's 45-DTE target.
const GOLDEN_CONTRACT = 'QQQ260515P00565000';
const BETTER_CONTRACT = 'QQQ260515P00570000';
const OTHER_CONTRACT = 'QQQ260619P00555000';

const GOLDEN_ROW: AvOptionContract = {
  contractID: GOLDEN_CONTRACT,
  symbol: 'QQQ',
  expiration: '2026-05-15',
  strike: '565',
  type: AvOptionType.PUT,
  delta: '-0.204',
  implied_volatility: '0.198',
  mark: '8.42',
  bid: '8.3',
  ask: '8.54',
  volume: '412',
  open_interest: '5210',
};

const BETTER_ROW: AvOptionContract = {
  ...GOLDEN_ROW,
  contractID: BETTER_CONTRACT,
  strike: '570',
  delta: '-0.201',
};

const OTHER_ROW: AvOptionContract = {
  ...GOLDEN_ROW,
  contractID: OTHER_CONTRACT,
  expiration: '2026-06-19',
  strike: '555',
  delta: '-0.201',
};

const GOLDEN_PICK: DayPick = {
  underlyingClose: 614.85,
  contractId: GOLDEN_CONTRACT,
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

const pickFrom = (row: AvOptionContract, dte: number, close = 614.85): DayPick => ({
  underlyingClose: close,
  contractId: row.contractID!,
  expiration: row.expiration!,
  dte,
  strike: Number(row.strike),
  delta: Number(row.delta),
  iv: Number(row.implied_volatility),
  mark: Number(row.mark),
  bid: Number(row.bid),
  ask: Number(row.ask),
  volume: Number(row.volume),
  openInterest: Number(row.open_interest),
});

const NO_CHAIN: DayMiss = { status: 'no_chain', underlyingClose: 614.85 };
const NO_MATCH: DayMiss = { status: 'no_match', underlyingClose: 614.85, reason: 'no eligible contract' };

describe('diffEntries', () => {
  it('reports no diffs for identical entries', () => {
    expect(diffEntries(GOLDEN_PICK, { ...GOLDEN_PICK })).toEqual([]);
  });

  it('reports union-of-keys diffs including presence-only fields', () => {
    // A field present in golden and absent from actual surfaces as a diff
    // (entries omit unparseable fields entirely).
    const { volume: _omitted, ...removed } = GOLDEN_PICK;
    const realDiffs = diffEntries(GOLDEN_PICK, removed);
    expect(realDiffs).toEqual([{ field: 'volume', golden: 412, actual: undefined }]);
  });

  it('reports a field present only in actual', () => {
    const actual = { ...GOLDEN_PICK, openInterest: 5210 };
    const { openInterest: _omitted, ...golden } = GOLDEN_PICK;
    expect(diffEntries(golden, actual)).toEqual([
      { field: 'openInterest', golden: undefined, actual: 5210 },
    ]);
  });
});

describe('reconcileDay — miss transitions', () => {
  it('golden no_chain -> pick is a repaired gap', () => {
    const r = reconcileDay(DATE, NO_CHAIN, GOLDEN_PICK, [GOLDEN_ROW], CELL);
    expect(r.category).toBe('repaired-gap');
    expect(r.explained).toBe(true);
  });

  it('golden no_chain -> pick that is not the SPEC winner is a regression', () => {
    // The chain offers a better put (delta -0.201) on the same expiration;
    // a pick of the -0.204 contract cannot be justified by the stored data.
    const better = { ...GOLDEN_ROW, contractID: BETTER_CONTRACT, delta: '-0.201' };
    const r = reconcileDay(DATE, NO_CHAIN, GOLDEN_PICK, [GOLDEN_ROW, better], CELL);
    expect(r.category).toBe('regression');
    expect(r.explained).toBe(false);
  });

  it('golden no_chain -> pick with no stored chain is unexplained', () => {
    const r = reconcileDay(DATE, NO_CHAIN, GOLDEN_PICK, null, CELL);
    expect(r.category).toBe('unexplained');
    expect(r.explained).toBe(false);
  });

  it('golden no_chain -> no_match is a repaired gap (chain stored, still no eligible contract)', () => {
    const r = reconcileDay(DATE, NO_CHAIN, NO_MATCH, [OTHER_ROW], CELL);
    expect(r.category).toBe('repaired-gap');
    expect(r.explained).toBe(true);
  });

  it('golden no_match -> no_chain is a regression (stored chain vanished)', () => {
    const r = reconcileDay(DATE, NO_MATCH, NO_CHAIN, null, CELL);
    expect(r.category).toBe('regression');
    expect(r.explained).toBe(false);
  });

  it('golden pick -> miss is a regression', () => {
    const r = reconcileDay(DATE, GOLDEN_PICK, NO_MATCH, [OTHER_ROW], CELL);
    expect(r.category).toBe('regression');
    expect(r.explained).toBe(false);
  });

  it('same miss status with differing detail fields is miss-detail', () => {
    const actual: DayMiss = { status: 'no_match', underlyingClose: 615.0, reason: 'no put contracts' };
    const r = reconcileDay(DATE, NO_MATCH, actual, [], CELL);
    expect(r.category).toBe('miss-detail');
    expect(r.explained).toBe(true);
  });
});

describe('reconcileDay — pick vs pick', () => {
  it('identical picks classify as identical', () => {
    const r = reconcileDay(DATE, GOLDEN_PICK, { ...GOLDEN_PICK }, [GOLDEN_ROW], CELL);
    expect(r.category).toBe('identical');
    expect(r.explained).toBe(true);
    expect(r.fieldDiffs).toEqual([]);
  });

  it('same contract, golden fields stale vs stored row -> fields-refreshed', () => {
    // Stored snapshot now carries updated delta/iv; regenerated pick uses them.
    const stored = { ...GOLDEN_ROW, delta: '-0.205', implied_volatility: '0.21' };
    const actual = pickFrom(stored, 44);
    const r = reconcileDay(DATE, GOLDEN_PICK, actual, [stored], CELL);
    expect(r.category).toBe('fields-refreshed');
    expect(r.explained).toBe(true);
    expect(r.fieldDiffs.map((d) => d.field).sort()).toEqual(['delta', 'iv']);
  });

  it('same contract, only underlyingClose differs -> close-only', () => {
    const actual = { ...GOLDEN_PICK, underlyingClose: 615.0 };
    const r = reconcileDay(DATE, GOLDEN_PICK, actual, [GOLDEN_ROW], CELL);
    expect(r.category).toBe('close-only');
    expect(r.explained).toBe(true);
  });

  it('same contract, actual field diverges from stored row -> unexplained', () => {
    // Stored row says delta -0.205 but the regenerated entry has -0.203:
    // the pipeline wrote a value that is not in the chain it read.
    const stored = { ...GOLDEN_ROW, delta: '-0.205' };
    const actual = { ...GOLDEN_PICK, delta: -0.203 };
    const r = reconcileDay(DATE, GOLDEN_PICK, actual, [stored], CELL);
    expect(r.category).toBe('unexplained');
    expect(r.explained).toBe(false);
  });

  it('different contract, golden contract absent from stored chain -> contract-superseded', () => {
    const actual = pickFrom(BETTER_ROW, 44);
    const r = reconcileDay(DATE, GOLDEN_PICK, actual, [BETTER_ROW], CELL);
    expect(r.category).toBe('contract-superseded');
    expect(r.explained).toBe(true);
  });

  it('different contract, golden present but legitimately outranked -> outranked', () => {
    // Same expiration; BETTER_ROW's delta (-0.201, gap .001) beats
    // GOLDEN_ROW's (-0.204, gap .004).
    const actual = pickFrom(BETTER_ROW, 44);
    const r = reconcileDay(DATE, GOLDEN_PICK, actual, [GOLDEN_ROW, BETTER_ROW], CELL);
    expect(r.category).toBe('outranked');
    expect(r.explained).toBe(true);
  });

  it('different contract when the golden contract is still the SPEC winner -> regression', () => {
    // OTHER_ROW is in the chain but golden still wins argmin on 05-15;
    // picking OTHER_CONTRACT means the picker chose a non-winner.
    const goldenWinner = { ...GOLDEN_ROW, delta: '-0.201' };
    const chain: AvOptionContract[] = [
      goldenWinner,
      { ...GOLDEN_ROW, contractID: OTHER_CONTRACT, delta: '-0.25' },
    ];
    const golden = { ...GOLDEN_PICK, delta: -0.201 };
    const actual = { ...golden, contractId: OTHER_CONTRACT, delta: -0.25 };
    const r = reconcileDay(DATE, golden, actual, chain, CELL);
    expect(r.category).toBe('regression');
    expect(r.explained).toBe(false);
  });

  it('pick -> pick with no stored chain is unexplained', () => {
    const actual = { ...GOLDEN_PICK, delta: -0.203 };
    const r = reconcileDay(DATE, GOLDEN_PICK, actual, null, CELL);
    expect(r.category).toBe('unexplained');
    expect(r.explained).toBe(false);
  });

  it('different expiration winner -> outranked via nearest-DTE, not delta', () => {
    // Golden contract stays on 05-15 (dte 44, gap 1); a new chain row on
    // 04-24 (dte 23) does not displace it — but a new expiration at dte 46
    // is closer to the 45 target than dte 44 and wins outright.
    const nearerExpRow: AvOptionContract = {
      ...BETTER_ROW,
      contractID: 'QQQ260517P00560000',
      expiration: '2026-05-17', // dte 46
      delta: '-0.26',
    };
    const actual = pickFrom(nearerExpRow, 46);
    const r = reconcileDay(
      DATE,
      GOLDEN_PICK,
      actual,
      [GOLDEN_ROW, nearerExpRow],
      CELL,
    );
    expect(r.category).toBe('outranked');
    expect(r.explained).toBe(true);
    expect(r.detail).toContain('2026-05-17');
  });
});

describe('specWinner oracle — SPEC selection-rule tie-breaks', () => {
  it('expiration tie on |dte - target| picks the longer actual DTE', () => {
    // 2026-05-15 is dte 44 (gap 1) and 2026-05-17 is dte 46 (gap 1):
    // equal distance from the 45 target -> longer DTE wins.
    const shorter: AvOptionContract = { ...GOLDEN_ROW, contractID: 'QQQ260515P00565000', expiration: '2026-05-15' };
    const longer: AvOptionContract = { ...OTHER_ROW, contractID: 'QQQ260517P00560000', expiration: '2026-05-17', delta: '-0.30' };
    const w = specWinner([shorter, longer], DATE, CELL);
    expect(w?.contractId).toBe('QQQ260517P00560000');
  });

  it('delta gap tie picks the larger |delta|', () => {
    // Target -0.20: -0.19 and -0.21 are equidistant (gap .01); -0.21 wins.
    const shallow = { ...GOLDEN_ROW, contractID: 'QQQ260515P00565000', delta: '-0.19' };
    const deep = { ...GOLDEN_ROW, contractID: 'QQQ260515P00570000', delta: '-0.21' };
    const w = specWinner([shallow, deep], DATE, CELL);
    expect(w?.contractId).toBe('QQQ260515P00570000');
  });

  it('full tie falls to the lowest contractId', () => {
    const b = { ...GOLDEN_ROW, contractID: 'QQQ260515P00570000' };
    const a = { ...GOLDEN_ROW, contractID: 'QQQ260515P00560000' };
    const w = specWinner([b, a], DATE, CELL);
    expect(w?.contractId).toBe('QQQ260515P00560000');
  });
});

describe('oracle vs production pickCellsForDate — drift guard', () => {
  // The oracle must independently agree with the production picker on every
  // fixture chain; divergence means one of them drifted from the SPEC.
  const chains: AvOptionContract[][] = [
    [GOLDEN_ROW],
    [GOLDEN_ROW, BETTER_ROW],
    [GOLDEN_ROW, OTHER_ROW],
    [OTHER_ROW], // golden contract absent — only 06-19 remains
    [GOLDEN_ROW, BETTER_ROW, OTHER_ROW],
    [{ ...GOLDEN_ROW, delta: '' }], // no eligible rows -> no winner
  ];

  for (const [i, chain] of chains.entries()) {
    it(`chain ${i}: oracle and production pick the same contract`, () => {
      const prod = pickCellsForDate(chain.slice(), 614.85, DATE, 'QQQ', [
        { type: 'put', deltaPct: 20, dte: 45 },
      ]);
      const prodEntry = prod.get('QQQ-put-20-45')!;
      const oracleWinner = specWinner(chain, DATE, CELL);
      if (isPickEntry(prodEntry)) {
        expect(oracleWinner?.contractId).toBe(prodEntry.contractId);
        expect(oracleWinner?.expiration).toBe(prodEntry.expiration);
      } else {
        expect(oracleWinner).toBeNull();
      }
    });
  }
});
