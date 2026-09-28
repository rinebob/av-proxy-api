/**
 * Shared types for symbol-level IV metrics (Topic #158).
 *
 * Storage: `symbol-metrics/{SYMBOL}/years/{YYYY}` — a year-sharded doc whose
 * `days` map keys YYYY-MM-DD dates to metric entries. Metrics are computed
 * server-side from the options corpus by pluggable computers; this file is
 * the storage + wire contract shared by BE writers/readers and partner apps.
 */

import type { TimestampLike } from '../firestore/timestamp';

// ---- Firestore path constants ----

/** Root collection for symbol-level metrics. */
export const SYMBOL_METRICS_COLLECTION = 'symbol-metrics';

/** Year-shard subcollection under each symbol doc. */
export const SYMBOL_METRICS_YEARS_SUBCOLLECTION = 'years';

// ---- Metric fields ----

/** IV-rank window lengths, calendar days (Thread #163). Window = trailing
 *  W calendar days of IV30 rows; n = points present. */
export const IV_RANK_WINDOWS = [30, 60, 180, 360] as const;
export type IvRankWindow = (typeof IV_RANK_WINDOWS)[number];

/** Metric fields emit on a day entry; also the `metrics=` whitelist for
 *  partnerIvMetricsV2. Append-only — new metrics add fields, never rename.
 *  Rank fields (Thread #163) flow through the same endpoint automatically. */
export const SYMBOL_METRIC_FIELDS = [
  'iv30',
  'iv30Method',
  'iv30Contracts',
  // IV rank (Thread #163) — rank-in-range, percentile, sample count per window
  'ivRank30', 'ivRank60', 'ivRank180', 'ivRank360',
  'ivPct30', 'ivPct60', 'ivPct180', 'ivPct360',
  'ivN30', 'ivN60', 'ivN180', 'ivN360',
] as const;

export type SymbolMetricField = (typeof SYMBOL_METRIC_FIELDS)[number];

/** How an IV30 point was produced across the expiry dimension. */
export type Iv30Method =
  | 'interpolated' // total-variance interpolation between bracketing expirations
  | 'nearest';     // fallback: no expiration pair bracketed the tenor

/** One day's computed metric values — a `days` map entry. All fields optional;
 *  a computer may decline to emit (absent key = no data, distinct from 0). */
export interface SymbolMetricDayEntry {
  /** Constant-maturity ATM implied volatility, 30-day tenor, decimal. */
  iv30?: number;
  iv30Method?: Iv30Method;
  /** Usable-IV contracts in the contributing expiration(s) — chain-depth
   *  quality signal, not a count of the few contracts feeding the bracket. */
  iv30Contracts?: number;
  // IV rank (Thread #163) — second-order fields over the trailing IV30 series.
  // Latest-only freshness: frozen at write; only the newest day's ranks and
  // the iv-rank-latest doc reflect full coverage. `ivN{W}` is the window's
  // IV30 sample count — always emitted when iv30 exists, even when rank/pct
  // are withheld (n<2).
  ivRank30?: number; ivRank60?: number; ivRank180?: number; ivRank360?: number;
  ivPct30?: number; ivPct60?: number; ivPct180?: number; ivPct360?: number;
  ivN30?: number; ivN60?: number; ivN180?: number; ivN360?: number;
  // reserved: iv60/iv90, mfiv30, …
}

/** `symbol-metrics/{SYMBOL}/years/{YYYY}` document. */
export interface SymbolMetricsYearDoc {
  symbol: string;
  year: number;
  /** Day entries keyed by `YYYY-MM-DD` (ISO trading date). */
  days: Record<string, SymbolMetricDayEntry>;
  updatedAt: TimestampLike; // written with serverTimestamp()
}

// ---- partnerIvMetricsV2 wire shape ----

/** One row of the endpoint response — a date plus whichever metric fields
 *  were requested/present. The index signature keeps the wire shape open:
 *  new registry metrics flow through without a type release. */
export interface IvMetricsRow extends SymbolMetricDayEntry {
  date: string;
  [k: string]: unknown;
}

// ---- iv-rank-latest (Thread #163 screener table) ----

/** Flat top-level collection for the sortable cross-symbol rank table. */
export const IV_RANK_LATEST_COLLECTION = 'iv-rank-latest';

/** `iv-rank-latest/{SYMBOL}` — the symbol's newest known rank values.
 *  Rewritten on every rank pass for the symbol's latest date; deleted on an
 *  `optionsEnabled` false-transition so disabled symbols never linger in the
 *  screener table. */
export interface IvRankLatestDoc {
  symbol: string;
  /** The day entry these values were computed from. */
  asOfDate: string;
  ivRank30?: number; ivRank60?: number; ivRank180?: number; ivRank360?: number;
  ivPct30?: number; ivPct60?: number; ivPct180?: number; ivPct360?: number;
  ivN30?: number; ivN60?: number; ivN180?: number; ivN360?: number;
  updatedAt: TimestampLike;
}
