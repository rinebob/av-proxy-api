/**
 * Shared types for delta-pick cell documents (Thread #214 / Task #219).
 *
 * Storage: `options-delta-picks/{cellId}/years/{YYYY}` — a year-sharded doc
 * whose `days` map keys YYYY-MM-DD dates to one entry per trading day: either
 * a picked contract with observed fields, or an explicit miss status.
 * cellId = `{SYM}-{type}-{deltaPct}-{dte}` (e.g. `QQQ-put-20-45`).
 *
 * This file is the storage + wire contract shared by BE writers, the partner
 * endpoint, and consumers — see SPEC 213-215-options-delta-picks-consumer-contract.
 */

import type { TimestampLike } from '../firestore/timestamp';

// ---- Firestore path constants ----

/** Root collection for delta-pick cell docs. */
export const OPTIONS_DELTA_PICKS_COLLECTION = 'options-delta-picks';

/** Year-shard subcollection under each cell doc. */
export const OPTIONS_DELTA_PICKS_YEARS_SUBCOLLECTION = 'years';

/** Bump when the cell doc schema changes incompatibly. */
export const PICK_GRID_VERSION = 1;

// ---- Cell identity ----

export type PickOptionType = 'put' | 'call';

// ---- Day entries ----

/** A successful pick: the real listed contract closest to the cell's target
 *  delta at the nearest listed expiration to the target DTE. All fields are
 *  observed on that day's chain — never synthesized. */
export interface DayPick {
  /** Symbol's split-adjusted close that day — present on every entry. */
  underlyingClose: number;
  contractId: string;
  expiration: string;
  /** Actual calendar days to expiration — differs from the target DTE when
   *  the nearest listed expiration isn't exact. */
  dte: number;
  strike: number;
  /** Observed delta — closest to the target, not exactly the target. */
  delta: number;
  iv: number;
  mark: number;
  bid: number;
  ask: number;
  volume: number;
  openInterest: number;
}

export type DayMissStatus = 'no_chain' | 'no_match';

/** An explicit miss. `no_chain` = no corpus chain for that date (self-repairs
 *  when the chain is later seeded). `no_match` = chain present but nothing
 *  selectable for this cell. */
export interface DayMiss {
  status: DayMissStatus;
  /** Present whenever an adjusted close exists for the date. */
  underlyingClose?: number;
  reason?: string;
}

export type DayPickEntry = DayPick | DayMiss;

// ---- Cell-year document ----

export interface PickExpiry {
  mode: 'nearestDte';
  /** Target DTE (calendar days) — the cell's configured tenor. */
  dte: number;
}

export interface CellYearDoc {
  symbol: string;
  type: PickOptionType;
  /** Signed target delta: negative for puts, positive for calls. */
  targetDelta: number;
  expiry: PickExpiry;
  gridVersion: number;
  /** First day key in this shard. */
  firstDate: string;
  /** Latest day key — grows nightly. */
  lastDate: string;
  /** Days with a pick entry (contractId present). */
  pickCount: number;
  /** Days with a miss status. */
  missCount: number;
  days: Record<string, DayPickEntry>;
  updatedAt: TimestampLike;
}
