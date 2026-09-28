/**
 * IV rank / IV percentile computers (Topic #158, Thread #163, Task #186).
 *
 * Second-order functions over the symbol's IV30 series — NOT MetricComputers
 * (no chain input); a separate rank pass (RankBuildService, #187) feeds them.
 *
 * Definitions (calendar-day windows over corpus-covered IV30 rows):
 *   window(W, asOf) = rows with  asOf − W days ≤ date ≤ asOf   (asOf included)
 *   ivRank = (iv_cur − min) / (max − min) · 100   — needs n ≥ 2; max==min → 0
 *   ivPct  = count(iv ≤ iv_cur) / n · 100       — needs n ≥ 1 (asOf present)
 *   ivN    = window sample count — always emitted when iv30 exists at asOf,
 *            even when rank/pct are withheld (immature windows stay honest)
 */
import { IV_RANK_WINDOWS, type SymbolMetricDayEntry } from '@shared/options';

/** One IV30 observation — a day entry's date + iv30 value. */
export interface IvRankPoint {
  /** YYYY-MM-DD. */
  date: string;
  iv30: number;
}

export interface IvRankWindowResult {
  /** 0–100; omitted (undefined) when n < 2. Constant series → 0. */
  ivRank?: number;
  /** 0–100; omitted when n < 1 (asOf row absent — caller filters anyway). */
  ivPct?: number;
  ivN: number;
}

const MS_PER_DAY = 86_400_000;

/** Rows in the trailing W-calendar-day window ending at (and including) asOf. */
export function windowRows(
  series: readonly IvRankPoint[],
  asOf: string,
  windowDays: number,
): IvRankPoint[] {
  const asOfMs = Date.parse(asOf);
  const floorMs = asOfMs - windowDays * MS_PER_DAY;
  return series.filter((p) => {
    const ms = Date.parse(p.date);
    return Number.isFinite(ms) && ms >= floorMs && ms <= asOfMs;
  });
}

/** Rank + percentile + n for one window. cur must be in `rows`. */
export function rankWindow(rows: readonly IvRankPoint[], cur: number): IvRankWindowResult {
  const n = rows.length;
  if (n === 0) return { ivN: 0 };
  const ivPct = (rows.filter((p) => p.iv30 <= cur).length / n) * 100;
  if (n < 2) return { ivN: n, ivPct };

  let min = Infinity;
  let max = -Infinity;
  for (const p of rows) {
    if (p.iv30 < min) min = p.iv30;
    if (p.iv30 > max) max = p.iv30;
  }
  // Constant window: rank is defined-but-degenerate → 0 (current == min == max).
  const ivRank = max === min ? 0 : ((cur - min) / (max - min)) * 100;
  return { ivN: n, ivPct, ivRank };
}

/**
 * All four windows' fields for one observation date — a partial day entry
 * the rank pass merge-writes. `cur` is that date's iv30.
 */
export function computeRankFields(
  series: readonly IvRankPoint[],
  asOf: string,
  cur: number,
): SymbolMetricDayEntry {
  const out: SymbolMetricDayEntry = {};
  for (const w of IV_RANK_WINDOWS) {
    const r = rankWindow(windowRows(series, asOf, w), cur);
    (out as Record<string, number>)[`ivN${w}`] = r.ivN;
    if (r.ivPct !== undefined) (out as Record<string, number>)[`ivPct${w}`] = r.ivPct;
    if (r.ivRank !== undefined) (out as Record<string, number>)[`ivRank${w}`] = r.ivRank;
  }
  return out;
}
