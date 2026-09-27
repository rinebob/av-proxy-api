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

/** Metric fields emit on a day entry; also the `metrics=` whitelist for
 *  partnerIvMetricsV2. Append-only — new metrics add fields, never rename. */
export const SYMBOL_METRIC_FIELDS = [
  'iv30',
  'iv30Method',
  'iv30Contracts',
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
  // reserved: iv60/iv90, mfiv30, ivRank{W}, ivPct{W}, …
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
