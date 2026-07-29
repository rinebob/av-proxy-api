import type { TimeSeriesStorageRecord } from '../../historical-options-corpus/services/time-series-contract.utils';

export interface ResolvedMark {
  mark: number;
  updated: boolean;
}

export interface UnresolvedMark {
  mark: null;
  updated: false;
}

/**
 * Resolves the mark price for a single observation using the fallback chain:
 *
 * 1. Use `mark` if present and parseable
 * 2. Compute `(bid + ask) / 2` if both are present and parseable
 * 3. Carry forward the last known resolved mark
 * 4. Return null (skip this day)
 *
 * @param record        The storage record for this observation
 * @param lastKnownMark The last successfully resolved mark, or null if none
 * @returns             The resolved mark, or null if unresolvable
 */
export function resolveMark(
  record: TimeSeriesStorageRecord,
  lastKnownMark: number | null,
): ResolvedMark | UnresolvedMark {
  if (record.m !== undefined && record.m !== '') {
    const value = Number(record.m);
    if (Number.isFinite(value) && value >= 0) {
      return { mark: value, updated: true };
    }
  }

  if (record.b !== undefined && record.a !== undefined && record.b !== '' && record.a !== '') {
    const bid = Number(record.b);
    const ask = Number(record.a);
    if (Number.isFinite(bid) && Number.isFinite(ask) && bid >= 0 && ask >= 0) {
      return { mark: (bid + ask) / 2, updated: true };
    }
  }

  if (lastKnownMark !== null) {
    return { mark: lastKnownMark, updated: false };
  }

  return { mark: null, updated: false };
}
