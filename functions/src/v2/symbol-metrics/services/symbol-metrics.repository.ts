/**
 * SymbolMetricsRepository — Firestore read/write layer for
 * `symbol-metrics/{SYMBOL}/years/{YYYY}` (Topic #158, Task #170).
 *
 * Docs hold a `days` map keyed YYYY-MM-DD → SymbolMetricDayEntry. Writes use
 * `mergeFields` field-paths so `days.{date}` is *replaced* (not field-merged)
 * and sibling dates survive — atomic, no read-modify-write, idempotent
 * recompute (dedupe-by-key). Plain `merge: true` would union the entry's
 * fields, letting a field a computer stopped emitting linger stale.
 */
import { FieldValue } from '../../../firebase-admin-init';
import {
  SYMBOL_METRICS_COLLECTION,
  SYMBOL_METRICS_YEARS_SUBCOLLECTION,
  type SymbolMetricDayEntry,
  type SymbolMetricsYearDoc,
} from '@shared/options';
import type { FirestoreLike } from '../../common/firestore/firestore-like';

export class SymbolMetricsRepository {
  constructor(private readonly db: FirestoreLike) {}

  private yearsCollection(symbol: string) {
    return this.db.collection(
      `${SYMBOL_METRICS_COLLECTION}/${symbol.toUpperCase()}/${SYMBOL_METRICS_YEARS_SUBCOLLECTION}`,
    );
  }

  /** Replace one day entry in the year shard (see class docstring). */
  async upsertDay(symbol: string, date: string, entry: SymbolMetricDayEntry): Promise<void> {
    // The date becomes a Firestore field path — a dotted/malformed date would
    // resolve as nested fields and corrupt the days map. Hard-fail on misuse.
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      throw new Error(`upsertDay: malformed date '${date}' (expected YYYY-MM-DD)`);
    }
    const year = date.slice(0, 4);
    await this.yearsCollection(symbol).doc(year).set(
      {
        symbol: symbol.toUpperCase(),
        year: Number(year),
        days: { [date]: entry },
        updatedAt: FieldValue.serverTimestamp(),
      },
      // mergeFields targets `days.{date}` → that entry is replaced wholesale;
      // other dates and doc fields are untouched.
      { mergeFields: ['symbol', 'year', `days.${date}`, 'updatedAt'] },
    );
  }

  /** The whole year shard, or null when the doc doesn't exist. */
  async readYear(symbol: string, year: string | number): Promise<SymbolMetricsYearDoc | null> {
    const snap = await this.yearsCollection(symbol).doc(String(year)).get();
    return snap.exists ? (snap.data() as SymbolMetricsYearDoc) : null;
  }

  /** One day entry, or null when absent (year doc or date key missing). */
  async readDay(symbol: string, date: string): Promise<SymbolMetricDayEntry | null> {
    const doc = await this.readYear(symbol, date.slice(0, 4));
    return doc?.days?.[date] ?? null;
  }
}
