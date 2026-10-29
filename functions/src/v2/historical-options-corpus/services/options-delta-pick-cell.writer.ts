/**
 * Cell doc writer for `options-delta-picks` (Thread #214 / Task #222).
 *
 * Merges `days.{date}` entries into `options-delta-picks/{cellId}/years/{YYYY}`
 * inside one transaction per year doc. Merge rules per date:
 *
 *  - absent date                  → write
 *  - existing pick entry          → immutable, never overwritten
 *  - existing repairable miss     → rewrite only when the new entry is more
 *    (`no_chain` / `no_match`)      informative: pick > no_match > no_chain
 *  - unrecognized existing shape  → untouched (conservative — don't clobber
 *                                   data the guards don't understand)
 *
 * Header fields (`firstDate`, `lastDate`, `pickCount`, `missCount`) are
 * recomputed from the merged `days` map rather than incremented — the map is
 * bounded (~260 trading days/year) and recompute can't drift. `updatedAt` is
 * a serverTimestamp on every actual write; a merge that changes nothing
 * performs no write at all, which is what makes re-running materialization
 * idempotent.
 *
 * Day keys shard by **chain date**, not expiration date — an entries map
 * spanning Dec 31 / Jan 1 splits across two year docs (TEST edge case).
 *
 * One writer per cell doc by design (per-symbol fanout serializes cells), so
 * transactions here guard against nightly-vs-backfill overlap, not contention
 * between materialization writers.
 */

import type { Firestore } from 'firebase-admin/firestore';
import { FieldValue } from 'firebase-admin/firestore';

import {
  cellYearDocPath,
  isMissEntry,
  isPickEntry,
  isRepairableEntry,
  parseCellId,
  PICK_GRID_VERSION,
  type CellYearDoc,
  type DayPickEntry,
} from '@shared/options';

import { isValidIsoDate } from '../../common/utils/date-time.utils';

export interface MergeDayEntriesResult {
  /** ISO dates whose entries were written (new or upgraded). */
  written: string[];
  /** ISO dates skipped — existing entry immutable, or the new entry no
   *  better than the existing miss. */
  skipped: string[];
}

/** Informativeness rank for merge upgrades: pick > no_match > no_chain. */
function entryRank(entry: DayPickEntry): number {
  if (isPickEntry(entry)) return 2;
  if (isMissEntry(entry)) return entry.status === 'no_match' ? 1 : 0;
  return -1;
}

/**
 * Merges day entries into the year-sharded cell doc(s) for `cellId`.
 * `entries` maps ISO dates (YYYY-MM-DD) to pick/miss entries; dates across
 * a year boundary are routed to their own shards. Returns which dates were
 * written vs skipped so callers can log idempotency/repair stats.
 */
export async function mergeDayEntries(
  db: Firestore,
  cellId: string,
  entries: ReadonlyMap<string, DayPickEntry>,
): Promise<MergeDayEntriesResult> {
  const cell = parseCellId(cellId);
  if (!cell) throw new Error(`mergeDayEntries: malformed cellId: ${cellId}`);

  const byYear = new Map<number, Array<[string, DayPickEntry]>>();
  for (const [date, entry] of entries) {
    if (!isValidIsoDate(date)) {
      throw new Error(`mergeDayEntries: malformed day key: ${date}`);
    }
    // Entries must be exactly one object shape — neither-shape becomes a
    // dead entry no merge can repair; both-shape (contractId + status)
    // double-counts as pick AND miss. The typeof check precedes the guards:
    // `in` on a primitive throws TypeError.
    if (
      typeof entry !== 'object' ||
      entry === null ||
      isPickEntry(entry) === isMissEntry(entry)
    ) {
      throw new Error(`mergeDayEntries: entry for ${date} is not a valid pick-or-miss shape`);
    }
    const year = Number(date.slice(0, 4));
    const bucket = byYear.get(year) ?? [];
    bucket.push([date, entry]);
    byYear.set(year, bucket);
  }

  const written: string[] = [];
  const skipped: string[] = [];

  for (const [year, yearEntries] of [...byYear.entries()].sort(([a], [b]) => a - b)) {
    const ref = db.doc(cellYearDocPath(cellId, year));
    // Decisions are computed inside the retryable callback and returned —
    // accumulating into outer arrays here would duplicate them on a retry
    // (and a retried attempt may legitimately decide differently).
    const outcome = await db.runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      const existing = snap.data() as Partial<CellYearDoc> | undefined;
      const days: Record<string, DayPickEntry> = { ...(existing?.days ?? {}) };

      const txWritten: string[] = [];
      const txSkipped: string[] = [];
      let changed = false;
      for (const [date, entry] of yearEntries) {
        const prev = days[date];
        // typeof check before the guards — a corrupt primitive day value is
        // an "unrecognized shape" (skip, don't clobber), and `in` on a
        // primitive would throw TypeError inside the transaction.
        if (
          prev === undefined ||
          (typeof prev === 'object' && prev !== null && isRepairableEntry(prev) && entryRank(entry) > entryRank(prev))
        ) {
          days[date] = entry;
          txWritten.push(date);
          changed = true;
        } else {
          txSkipped.push(date);
        }
      }
      // Idempotent re-run: nothing writable → no write, no updatedAt bump.
      if (!changed) return { txWritten, txSkipped };

      let pickCount = 0;
      let missCount = 0;
      for (const e of Object.values(days)) {
        if (isPickEntry(e)) pickCount++;
        else if (isMissEntry(e)) missCount++;
      }
      const dates = Object.keys(days).sort();

      const doc: Omit<CellYearDoc, 'updatedAt'> & { updatedAt: FieldValue } = {
        symbol: cell.symbol,
        type: cell.type,
        targetDelta: cell.type === 'put' ? -cell.deltaPct / 100 : cell.deltaPct / 100,
        expiry: { mode: 'nearestDte', dte: cell.dte },
        gridVersion: PICK_GRID_VERSION,
        firstDate: dates[0],
        lastDate: dates[dates.length - 1],
        pickCount,
        missCount,
        days,
        updatedAt: FieldValue.serverTimestamp(),
      };
      tx.set(ref, doc);
      return { txWritten, txSkipped };
    });
    written.push(...outcome.txWritten);
    skipped.push(...outcome.txSkipped);
  }

  return { written, skipped };
}
