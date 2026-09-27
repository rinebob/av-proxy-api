/**
 * IV30 — constant-maturity ATM implied volatility at the 30-day tenor,
 * computed from a single day's options chain snapshot (Topic #158).
 *
 * Recipe (IMPL §1):
 *   1. Per expiration: find the two strikes bracketing the underlying close
 *      and take the OTM side (put below, call above; other side at the same
 *      strike if OTM is absent); linear-interpolate IV across the bracket.
 *      One-sided bracket → the nearer available strike's IV. When a strike
 *      equals the close exactly, both sides are OTM-adjacent — average them.
 *   2. Across expirations: calendar-day DTE, interpolate in total variance
 *      (σ²·T) between the expirations bracketing 30 days; result
 *      σ = √(w_interp / T_target).
 *   3. No bracketing expiration pair → nearest expiration, method 'nearest'.
 *      An expiration at exactly DTE 30 is a degenerate interpolation and is
 *      reported as 'interpolated' — the value IS the tenor value.
 *
 * Quality gates: IVs are string-encoded decimals; non-finite or outside
 * [0.005, 5.0] are rejected. Expired/same-day/malformed expirations dropped.
 * Duplicate same-type/same-strike rows: last write wins (corpus chains are
 * unique per (expiration, strike, type); duplicates are chain corruption).
 */
import type { AvOptionContract } from '@shared/alpha-vantage';
import { AvOptionType } from '@shared/alpha-vantage';
import type { SymbolMetricDayEntry } from '@shared/options';
import type { MetricInput } from '../types';

export const IV30_TENOR_DAYS = 30;

const IV_MIN = 0.005;
const IV_MAX = 5.0;
const DAYS_PER_YEAR = 365;
const MS_PER_DAY = 86_400_000;

type StrikeSlot = { put?: number; call?: number };

interface IvAtStrike {
  strike: number;
  iv: number;
}

/** Parse an IV field: finite, in-bounds — else null. */
function parseIv(raw: string | undefined): number | null {
  const iv = raw == null ? NaN : Number(raw);
  return Number.isFinite(iv) && iv >= IV_MIN && iv <= IV_MAX ? iv : null;
}

function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(to) - Date.parse(from)) / MS_PER_DAY);
}

/** IV at one strike on a given side: prefer the OTM type, fall back to the
 *  other side. Slots only hold parsed IVs and a slot exists iff ≥1 side was
 *  set, so this always returns a number. */
function ivAtStrike(slot: StrikeSlot, side: 'below' | 'above'): number {
  const [otm, other] = side === 'below' ? [slot.put, slot.call] : [slot.call, slot.put];
  return (otm ?? other)!;
}

/** All valid side IVs at one strike (put + call both present → [ivPut, ivCall]). */
function ivsAtStrike(slot: StrikeSlot): number[] {
  return [slot.put, slot.call].filter((iv): iv is number => iv != null);
}

/** Per-expiration ATM IV via bracketing-strike OTM interpolation. */
function atmIvForExpiration(
  contracts: AvOptionContract[],
  close: number,
): { iv: number; used: number } | null {
  // strike → {put, call} — slots hold parsed IVs; only contracts whose IV
  // passes the bounds filter enter. A slot exists iff ≥1 side was set.
  const byStrike = new Map<number, StrikeSlot>();
  let used = 0;
  for (const c of contracts) {
    const rawStrike = c.strike?.trim();
    if (!rawStrike) continue; // '' / whitespace would parse as 0
    const strike = Number(rawStrike);
    if (!Number.isFinite(strike)) continue;
    const iv = parseIv(c.implied_volatility);
    if (iv == null) continue;
    const slot = byStrike.get(strike) ?? {};
    if (c.type === AvOptionType.PUT) slot.put = iv;
    else if (c.type === AvOptionType.CALL) slot.call = iv;
    else continue;
    byStrike.set(strike, slot);
    used++;
  }
  if (byStrike.size === 0) return null;

  const strikes = [...byStrike.keys()].sort((a, b) => a - b);
  // Slot invariant: every strike in byStrike has ≥1 valid-IV contract, so
  // ivAtStrike/ivsAtStrike always yield a number — candidates always gets ≥1.
  const splitIdx = strikes.findIndex((s) => s >= close);
  const candidates: IvAtStrike[] = [];

  // nearest strike strictly below close → 'below' side; at-or-above → 'above'
  // splitIdx === -1 → close above all strikes (below = last strike)
  const belowIdx = splitIdx === -1 ? strikes.length - 1 : splitIdx - 1;
  if (belowIdx >= 0) {
    const s = strikes[belowIdx];
    candidates.push({ strike: s, iv: ivAtStrike(byStrike.get(s)!, 'below') });
  }
  if (splitIdx >= 0) {
    const s = strikes[splitIdx];
    const slot = byStrike.get(s)!;
    // strike == close ⇒ both sides are ATM — average valid sides rather than
    // preferring one; otherwise OTM side (call above close).
    let iv: number;
    if (s === close) {
      const ivs = ivsAtStrike(slot);
      iv = ivs.reduce((a, b) => a + b, 0) / ivs.length;
    } else {
      iv = ivAtStrike(slot, 'above');
    }
    candidates.push({ strike: s, iv });
  }

  if (candidates.length === 1) {
    return { iv: candidates[0].iv, used };
  }

  // linear interpolation across the strike bracket
  const [lo, hi] = candidates;
  const t = (close - lo.strike) / (hi.strike - lo.strike);
  return { iv: lo.iv + t * (hi.iv - lo.iv), used };
}

export function computeIv30(input: MetricInput): SymbolMetricDayEntry | null {
  const { chain, underlyingClose, date } = input;
  if (underlyingClose == null || !Number.isFinite(underlyingClose)) return null;

  // group by expiration, computing DTE once; drop expired/same-day/malformed
  const byExpiration = new Map<string, AvOptionContract[]>();
  const dteByExpiration = new Map<string, number>();
  for (const c of chain) {
    if (!c.expiration) continue;
    const dte = dteByExpiration.get(c.expiration) ?? daysBetween(date, c.expiration);
    if (!Number.isFinite(dte) || dte <= 0) continue;
    if (!byExpiration.has(c.expiration)) {
      byExpiration.set(c.expiration, []);
      dteByExpiration.set(c.expiration, dte);
    }
    byExpiration.get(c.expiration)!.push(c);
  }
  if (byExpiration.size === 0) return null;

  // per-expiration ATM IV → total variance terms, ascending DTE
  const terms: { dte: number; totalVariance: number; used: number }[] = [];
  for (const [expiration, contracts] of byExpiration) {
    const dte = dteByExpiration.get(expiration)!;
    const atm = atmIvForExpiration(contracts, underlyingClose);
    if (atm == null) continue;
    terms.push({ dte, totalVariance: atm.iv * atm.iv * (dte / DAYS_PER_YEAR), used: atm.used });
  }
  if (terms.length === 0) return null;
  terms.sort((a, b) => a.dte - b.dte);

  // Distinct expiration strings can share a DTE (non-normalized input);
  // below/above resolve deterministically by ascending-DTE order.
  const below = [...terms].reverse().find((t) => t.dte <= IV30_TENOR_DAYS);
  const above = terms.find((t) => t.dte >= IV30_TENOR_DAYS);

  if (below && above) {
    if (below.dte === above.dte) {
      // below needs dte ≤ 30 and above needs dte ≥ 30, so shared DTE is only
      // possible at exactly 30 — an exact-tenor hit (degenerate t=0 lerp).
      const T = below.dte / DAYS_PER_YEAR;
      return {
        iv30: Math.sqrt(below.totalVariance / T),
        iv30Method: 'interpolated',
        iv30Contracts: below.used,
      };
    }
    const t = (targetT(IV30_TENOR_DAYS) - below.dte / DAYS_PER_YEAR) / ((above.dte - below.dte) / DAYS_PER_YEAR);
    const w = below.totalVariance + t * (above.totalVariance - below.totalVariance);
    return {
      iv30: Math.sqrt(w / targetT(IV30_TENOR_DAYS)),
      iv30Method: 'interpolated',
      iv30Contracts: below.used + above.used,
    };
  }

  // one-sided → nearest expiration's ATM IV (equidistant ties keep the
  // shorter-dated term — terms is ascending, strict < keeps the first)
  const nearest = terms.reduce((a, b) =>
    Math.abs(b.dte - IV30_TENOR_DAYS) < Math.abs(a.dte - IV30_TENOR_DAYS) ? b : a,
  );
  return {
    iv30: Math.sqrt(nearest.totalVariance / (nearest.dte / DAYS_PER_YEAR)),
    iv30Method: 'nearest',
    iv30Contracts: nearest.used,
  };
}

function targetT(tenorDays: number): number {
  return tenorDays / DAYS_PER_YEAR;
}
