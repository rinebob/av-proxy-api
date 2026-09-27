/**
 * Tests for the pure IV30 metric computer (Task #169).
 *
 * Fixtures use the real AvOptionContract wire shape: all-numeric fields are
 * string-encoded ('strike', 'implied_volatility'), type is 'call'|'put'.
 */
import type { AvOptionContract } from '@shared/alpha-vantage';
import { AvOptionType } from '@shared/alpha-vantage';
import { computeIv30 } from '../../../src/v2/symbol-metrics/metrics/iv30.computer';

const DATE = '2026-01-01'; // Thursday
const CLOSE = 100;

function contract(
  expiration: string,
  strike: number,
  type: 'call' | 'put',
  iv: number | string,
): AvOptionContract {
  return {
    contractID: `${type[0].toUpperCase()}${strike}`,
    expiration,
    strike: String(strike),
    type: type === 'call' ? AvOptionType.CALL : AvOptionType.PUT,
    implied_volatility: String(iv),
  };
}

describe('computeIv30 — expiry dimension', () => {
  // DTEs from 2026-01-01: 2026-01-15 → 14d, 2026-02-15 → 45d.
  // Bracketing 30d. Per-expiry ATM: lerp over strikes 99 (put) / 101 (call).
  const chain = [
    contract('2026-01-15', 99, 'put', 0.20),
    contract('2026-01-15', 101, 'call', 0.30),
    contract('2026-02-15', 99, 'put', 0.40),
    contract('2026-02-15', 101, 'call', 0.50),
  ];

  it('interpolates in total variance between bracketing expirations', () => {
    const r = computeIv30({ chain, underlyingClose: CLOSE, date: DATE })!;
    expect(r.iv30Method).toBe('interpolated');
    // w1 = 0.25²·14/365, w2 = 0.45²·45/365, t = 16/31 → iv30 ≈ 0.41340
    expect(r.iv30).toBeCloseTo(0.4134, 3);
    expect(r.iv30Contracts).toBe(4);
  });

  it('falls back to nearest expiration when all are beyond the tenor', () => {
    const r = computeIv30({
      chain: [
        contract('2026-03-01', 99, 'put', 0.30),
        contract('2026-03-01', 101, 'call', 0.40), // ATM ≈ 0.35, DTE 59
        contract('2026-06-01', 99, 'put', 0.50),
        contract('2026-06-01', 101, 'call', 0.60), // ATM ≈ 0.55, DTE 151
      ],
      underlyingClose: CLOSE,
      date: DATE,
    })!;
    expect(r.iv30Method).toBe('nearest');
    expect(r.iv30).toBeCloseTo(0.35, 5); // nearest expiry's ATM, no interpolation
  });

  it('falls back to nearest when all expirations are inside the tenor', () => {
    const r = computeIv30({
      chain: [
        contract('2026-01-10', 100, 'call', 0.33), // DTE 9
        contract('2026-01-25', 100, 'call', 0.44), // DTE 24 — nearest to 30
      ],
      underlyingClose: CLOSE,
      date: DATE,
    })!;
    expect(r.iv30Method).toBe('nearest');
    expect(r.iv30).toBeCloseTo(0.44, 5);
  });

  it('treats an expiration at exactly DTE 30 as an interpolated hit', () => {
    const r = computeIv30({
      chain: [contract('2026-01-31', 100, 'call', 0.37)], // DTE 30
      underlyingClose: CLOSE,
      date: DATE,
    })!;
    expect(r.iv30Method).toBe('interpolated');
    expect(r.iv30).toBeCloseTo(0.37, 5);
  });

  it('ignores malformed expiration strings (NaN DTE) instead of emitting NaN', () => {
    const r = computeIv30({
      chain: [
        contract('not-a-date', 100, 'call', 9.9),
        contract('2026-02-01', 100, 'call', 0.31),
      ],
      underlyingClose: CLOSE,
      date: DATE,
    })!;
    expect(Number.isFinite(r.iv30)).toBe(true);
    expect(r.iv30).toBeCloseTo(0.31, 5);
  });

  it('counts only contracts from contributing expirations', () => {
    const r = computeIv30({
      chain: [
        contract('2026-01-15', 99, 'put', 0.20),
        contract('2026-01-15', 101, 'call', 0.30),
        contract('2026-02-15', 99, 'put', 0.40),
        contract('2026-02-15', 101, 'call', 0.50),
        contract('2027-01-01', 100, 'call', 0.60), // far tail — doesn't contribute
      ],
      underlyingClose: CLOSE,
      date: DATE,
    })!;
    expect(r.iv30Contracts).toBe(4); // the two bracketing expirations only
  });

  it('excludes expired / same-day expirations', () => {
    const r = computeIv30({
      chain: [
        contract('2026-01-01', 100, 'call', 9.0), // same day — excluded
        contract('2025-12-30', 100, 'call', 9.0), // expired — excluded
        contract('2026-02-01', 100, 'call', 0.31),
      ],
      underlyingClose: CLOSE,
      date: DATE,
    })!;
    expect(r.iv30).toBeCloseTo(0.31, 5);
    expect(r.iv30Method).toBe('nearest');
  });
});

describe('computeIv30 — strike dimension', () => {
  it('uses OTM sides: put below close, call above close', () => {
    // Puts sit above close, calls below — must NOT pick ITM side.
    const r = computeIv30({
      chain: [
        contract('2026-02-01', 99, 'put', 0.20),
        contract('2026-02-01', 99, 'call', 0.95), // ITM call, junk IV — ignored
        contract('2026-02-01', 101, 'call', 0.30),
        contract('2026-02-01', 101, 'put', 0.95), // ITM put — ignored
      ],
      underlyingClose: CLOSE,
      date: DATE,
    })!;
    expect(r.iv30).toBeCloseTo(0.25, 5);
  });

  it('falls back to the single side when the bracket is one-sided', () => {
    const r = computeIv30({
      chain: [contract('2026-02-01', 90, 'put', 0.29)], // no strike above close
      underlyingClose: CLOSE,
      date: DATE,
    })!;
    expect(r.iv30).toBeCloseTo(0.29, 5);
  });

  it('uses the other contract type at the same strike when the OTM side is absent', () => {
    const r = computeIv30({
      chain: [
        contract('2026-02-01', 99, 'call', 0.22), // below close — ITM call is all we have
        contract('2026-02-01', 101, 'call', 0.30),
      ],
      underlyingClose: CLOSE,
      date: DATE,
    })!;
    expect(r.iv30).toBeCloseTo(0.26, 5); // lerp(0.22, 0.30, 0.5)
  });

  it('rejects out-of-bounds / non-finite IVs', () => {
    const r = computeIv30({
      chain: [
        contract('2026-02-01', 99, 'put', 8.5),    // > 5.0 bound — rejected
        contract('2026-02-01', 99, 'call', 'x'),   // unparseable — rejected
        contract('2026-02-01', 101, 'call', 0.30),
      ],
      underlyingClose: CLOSE,
      date: DATE,
    })!;
    expect(r.iv30).toBeCloseTo(0.30, 5);
    expect(r.iv30Contracts).toBe(1);
  });

  it('averages both sides when a strike equals the close exactly', () => {
    const r = computeIv30({
      chain: [
        contract('2026-02-01', 100, 'put', 0.24),
        contract('2026-02-01', 100, 'call', 0.36),
      ],
      underlyingClose: CLOSE,
      date: DATE,
    })!;
    expect(r.iv30).toBeCloseTo(0.30, 5); // mean of both sides, no side preference
  });

  it('uses whichever side exists when the exact-strike contract is one-sided', () => {
    const r = computeIv30({
      chain: [contract('2026-02-01', 100, 'call', 0.41)],
      underlyingClose: CLOSE,
      date: DATE,
    })!;
    expect(r.iv30).toBeCloseTo(0.41, 5);
  });

  it('falls back to the nearest strike above when close is below all strikes', () => {
    const r = computeIv30({
      chain: [contract('2026-02-01', 105, 'call', 0.42)],
      underlyingClose: CLOSE,
      date: DATE,
    })!;
    expect(r.iv30).toBeCloseTo(0.42, 5);
  });

  it('skips contracts with non-numeric or empty strikes', () => {
    const r = computeIv30({
      chain: [
        { expiration: '2026-02-01', strike: 'not-a-strike', type: AvOptionType.CALL, implied_volatility: '0.5' },
        { expiration: '2026-02-01', strike: ' ', type: AvOptionType.CALL, implied_volatility: '0.5' }, // Number(' ') === 0 — must not become a strike-0 slot
        contract('2026-02-01', 101, 'call', 0.35),
      ],
      underlyingClose: CLOSE,
      date: DATE,
    })!;
    expect(r.iv30).toBeCloseTo(0.35, 5);
    expect(r.iv30Contracts).toBe(1);
  });
});

describe('computeIv30 — degenerate inputs', () => {
  it('returns null for an empty chain', () => {
    expect(computeIv30({ chain: [], underlyingClose: CLOSE, date: DATE })).toBeNull();
  });

  it('returns null when no contract survives filtering', () => {
    expect(
      computeIv30({
        chain: [contract('2025-12-01', 100, 'call', 0.3)],
        underlyingClose: CLOSE,
        date: DATE,
      }),
    ).toBeNull();
  });

  it('returns null without an underlying close (nothing to bracket against)', () => {
    expect(
      computeIv30({
        chain: [contract('2026-02-01', 100, 'call', 0.3)],
        underlyingClose: null,
        date: DATE,
      }),
    ).toBeNull();
  });

  it('is deterministic', () => {
    const input = {
      chain: [
        contract('2026-01-15', 99, 'put', 0.20),
        contract('2026-01-15', 101, 'call', 0.30),
        contract('2026-02-15', 99, 'put', 0.40),
        contract('2026-02-15', 101, 'call', 0.50),
      ],
      underlyingClose: CLOSE,
      date: DATE,
    };
    expect(computeIv30(input)).toEqual(computeIv30(input));
  });
});
