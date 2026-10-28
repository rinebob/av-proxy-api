/**
 * Tests for the delta-pick picker core (Task #221).
 *
 * pickCellsForDate is a pure function: one stored chain -> one DayPickEntry
 * per grid cell (380 keys = full cellIds like 'QQQ-put-20-45'). Verifies:
 * - nearest-DTE expiration then argmin|observedDelta - targetDelta|
 * - signed target deltas (puts negative, calls positive)
 * - actual dte recorded; deterministic tie-breaks
 * - miss statuses: no_chain (absent chain), no_match (nothing selectable)
 * - underlyingClose carried on every entry incl. misses
 */
import type { AvOptionContract, AvOptionType } from '@shared/alpha-vantage/av-historical-options';
import {
  noChainPickEntries,
  pickCellsForDate,
} from '../../../src/v2/historical-options-corpus/services/options-delta-picker.service';

const DATE = '2026-04-01';

/** Fixture factory — AV chain rows are all-string. */
function c(over: Partial<AvOptionContract>): AvOptionContract {
  return {
    contractID: 'QQZ000000C00000000',
    symbol: 'QQQ',
    expiration: '2026-05-15',
    strike: '100',
    type: 'put' as AvOptionType,
    last: '1.00',
    mark: '1.00',
    bid: '0.99',
    bid_size: '10',
    ask: '1.01',
    ask_size: '10',
    volume: '100',
    open_interest: '1000',
    date: DATE,
    implied_volatility: '0.20',
    delta: '-0.20',
    gamma: '0.01',
    theta: '-0.05',
    vega: '0.10',
    rho: '-0.01',
    ...over,
  };
}

/** Chain with two put expirations (May-15=44d, Jun-19=79d) and one call expiry. */
function baseChain(): AvOptionContract[] {
  return [
    // puts, 2026-05-15 (44 DTE from 04-01)
    c({ contractID: 'QQQ260515P00550000', expiration: '2026-05-15', strike: '550', delta: '-0.40' }),
    c({ contractID: 'QQQ260515P00565000', expiration: '2026-05-15', strike: '565', delta: '-0.20', mark: '8.42', bid: '8.30', ask: '8.54', volume: '412', open_interest: '5210', implied_volatility: '0.198' }),
    c({ contractID: 'QQQ260515P00580000', expiration: '2026-05-15', strike: '580', delta: '-0.08' }),
    // puts, 2026-06-19 (79 DTE)
    c({ contractID: 'QQQ260619P00565000', expiration: '2026-06-19', strike: '565', delta: '-0.22' }),
    c({ contractID: 'QQQ260619P00500000', expiration: '2026-06-19', strike: '500', delta: '-0.10' }),
    // calls, 2026-05-15
    c({ contractID: 'QQQ260515C00600000', expiration: '2026-05-15', strike: '600', type: 'call' as AvOptionType, delta: '0.30' }),
    c({ contractID: 'QQQ260515C00650000', expiration: '2026-05-15', strike: '650', type: 'call' as AvOptionType, delta: '0.10' }),
  ];
}

describe('pickCellsForDate', () => {
  it('returns one entry per grid cell keyed by full cellId', () => {
    const out = pickCellsForDate(baseChain(), 612.4, DATE, 'QQQ');
    expect(out.size).toBe(380);
    expect(out.has('QQQ-put-20-45')).toBe(true);
    expect(out.has('QQQ-call-30-30')).toBe(true);
  });

  it('picks nearest-DTE expiration then argmin delta for puts', () => {
    const out = pickCellsForDate(baseChain(), 612.4, DATE, 'QQQ');
    const e = out.get('QQQ-put-20-45');
    // target 45 DTE -> nearest expiry is 05-15 (44d) not 06-19 (79d)
    // target -0.20 -> 565 strike has delta -0.20 exactly
    expect(e).toEqual({
      underlyingClose: 612.4,
      contractId: 'QQQ260515P00565000',
      expiration: '2026-05-15',
      dte: 44,
      strike: 565,
      delta: -0.2,
      iv: 0.198,
      mark: 8.42,
      bid: 8.3,
      ask: 8.54,
      volume: 412,
      openInterest: 5210,
    });
  });

  it('records the actual DTE, not the target', () => {
    // target 365 -> nearest listed expiry is 06-19 (79d)
    const e = pickCellsForDate(baseChain(), 612.4, DATE, 'QQQ').get('QQQ-put-20-365');
    expect(e && 'dte' in e ? e.dte : null).toBe(79);
  });

  it('uses positive signed deltas for calls', () => {
    const e = pickCellsForDate(baseChain(), 612.4, DATE, 'QQQ').get('QQQ-call-30-45');
    expect(e && 'contractId' in e ? e.contractId : null).toBe('QQQ260515C00600000');
    expect(e && 'delta' in e ? e.delta : null).toBe(0.3);
  });

  it('short-DTE cells still resolve to the nearest listed expiry', () => {
    // target 7 -> nearest is still 05-15 (44d) — coarse targets hop, never miss
    const e = pickCellsForDate(baseChain(), 612.4, DATE, 'QQQ').get('QQQ-put-20-7');
    expect(e && 'expiration' in e ? e.expiration : null).toBe('2026-05-15');
  });

  it('noChainPickEntries emits no_chain for every cell (caller-side, absent chain)', () => {
    const out = noChainPickEntries('QQQ', 612.4);
    expect(out.size).toBe(380);
    const e = out.get('QQQ-put-20-45');
    expect(e).toEqual({ status: 'no_chain', underlyingClose: 612.4 });
  });

  it('noChainPickEntries returns distinct entry objects per cell (no aliasing)', () => {
    const out = noChainPickEntries('QQQ', 612.4);
    expect(out.get('QQQ-put-20-45')).not.toBe(out.get('QQQ-call-20-45'));
  });

  it('no_chain omits underlyingClose when no close exists', () => {
    const e = noChainPickEntries('QQQ', undefined).get('QQQ-put-20-45');
    expect(e).toEqual({ status: 'no_chain' });
    expect(e && 'underlyingClose' in e).toBe(false);
  });

  it('throws on a malformed date (fail-loud caller bug)', () => {
    expect(() => pickCellsForDate(baseChain(), 612.4, '04/01/2026', 'QQQ')).toThrow();
    expect(() => pickCellsForDate(baseChain(), 612.4, '2026-13-40', 'QQQ')).toThrow();
  });

  it('emits no_match when the chain has no contracts of the cell type', () => {
    const callsOnly = baseChain().filter((x) => x.type === 'call');
    const e = pickCellsForDate(callsOnly, 612.4, DATE, 'QQQ').get('QQQ-put-20-45');
    expect(e && 'status' in e ? e.status : null).toBe('no_match');
    expect(e && 'underlyingClose' in e ? e.underlyingClose : null).toBe(612.4);
  });

  it('emits no_match when no listed expiration is usable', () => {
    const expired = baseChain().map((x) => ({ ...x, expiration: '2026-03-01' }));
    const e = pickCellsForDate(expired, 612.4, DATE, 'QQQ').get('QQQ-put-20-45');
    expect(e && 'status' in e ? e.status : null).toBe('no_match');
  });

  it('skips contracts with unparseable delta; no_match when none remain', () => {
    const chain = [
      c({ contractID: 'A', delta: '' }),
      c({ contractID: 'B', delta: 'n/a' }),
    ];
    const e = pickCellsForDate(chain, 612.4, DATE, 'QQQ').get('QQQ-put-20-45');
    expect(e && 'status' in e ? e.status : null).toBe('no_match');
  });

  it('identity fields required: rows missing contractID or strike are ineligible', () => {
    const chain = [
      c({ contractID: undefined }),
      c({ contractID: 'NOSTRIKE', strike: undefined, delta: '-0.20' }),
    ];
    const e = pickCellsForDate(chain, 612.4, DATE, 'QQQ').get('QQQ-put-20-45');
    expect(e && 'status' in e ? e.status : null).toBe('no_match');
  });

  it('quote fields are omitted (not zero-fabricated) when the row lacks them', () => {
    const chain = [
      c({ contractID: 'NOQ', bid: undefined, ask: undefined, volume: undefined, open_interest: undefined, implied_volatility: undefined, mark: undefined }),
    ];
    const e = pickCellsForDate(chain, 612.4, DATE, 'QQQ').get('QQQ-put-20-45');
    expect(e && 'contractId' in e ? e.contractId : null).toBe('NOQ');
    for (const f of ['bid', 'ask', 'volume', 'openInterest', 'iv', 'mark']) {
      expect(e && f in e).toBe(false);
    }
  });

  it('deterministic tie-breaks: equidistant expirations prefer the longer DTE', () => {
    // target 45; expirations at 44d (equidistant=1) and 46d (equidistant=1)
    const chain = [
      c({ contractID: 'NEAR', expiration: '2026-05-15', delta: '-0.20' }), // 44d
      c({ contractID: 'FAR', expiration: '2026-05-17', delta: '-0.20' }),  // 46d
    ];
    const e = pickCellsForDate(chain, 612.4, DATE, 'QQQ').get('QQQ-put-20-45');
    expect(e && 'contractId' in e ? e.contractId : null).toBe('FAR');
    expect(e && 'dte' in e ? e.dte : null).toBe(46);
  });

  it('deterministic tie-breaks: equidistant deltas prefer larger |delta|', () => {
    // target -0.20; -0.19 and -0.21 are equidistant -> prefer -0.21 (more ITM)
    const chain = [
      c({ contractID: 'OTM', delta: '-0.19' }),
      c({ contractID: 'ITM', delta: '-0.21' }),
    ];
    const e = pickCellsForDate(chain, 612.4, DATE, 'QQQ').get('QQQ-put-20-45');
    expect(e && 'contractId' in e ? e.contractId : null).toBe('ITM');
  });

  it('handles negative/zero actual DTE: dte>=0 expirations only', () => {
    // same-day expiry (dte=0) is still a real pick; yesterday's is not
    const chain = [
      c({ contractID: 'STALE', expiration: '2026-03-31', delta: '-0.20' }),
      c({ contractID: 'TODAY', expiration: '2026-04-01', delta: '-0.50' }),
    ];
    const e = pickCellsForDate(chain, 612.4, DATE, 'QQQ').get('QQQ-put-20-7');
    expect(e && 'contractId' in e ? e.contractId : null).toBe('TODAY');
    expect(e && 'dte' in e ? e.dte : null).toBe(0);
  });

  it('pick entry omits underlyingClose when no adjusted close exists (never zero-fabricated)', () => {
    const e = pickCellsForDate(baseChain(), undefined, DATE, 'QQQ').get('QQQ-put-20-45');
    expect(e && 'contractId' in e).toBe(true);
    expect(e && 'underlyingClose' in e).toBe(false);
  });

  it('empty chain array is a present chain -> no_match, not no_chain', () => {
    const e = pickCellsForDate([], 612.4, DATE, 'QQQ').get('QQQ-put-20-45');
    expect(e && 'status' in e ? e.status : null).toBe('no_match');
  });

  it('hyphenated symbols produce valid cellId keys', () => {
    const out = pickCellsForDate(baseChain(), 400, DATE, 'BRK-B');
    expect(out.has('BRK-B-put-20-45')).toBe(true);
  });

  it('accepts a custom grid (off-grid cells parse through the same core)', () => {
    const out = pickCellsForDate(baseChain(), 612.4, DATE, 'QQQ', [
      { type: 'put', deltaPct: 37, dte: 63 },
    ]);
    expect(out.size).toBe(1);
    expect(out.has('QQQ-put-37-63')).toBe(true);
  });
});
