/**
 * SwingSetRepository — Firestore read/write layer for `options-swing-sets`.
 *
 * Docs are keyed `{symbol}_{paramsId}` and written with `set(merge)` so
 * repeated generation for the same (symbol, config) is idempotent.
 * Consumers: SwingSetGenerationService (#125), Thread #106 corpus ingest.
 */
import { FirestoreCollection } from '@shared/firestore';
import type { SwingSetDoc } from '@shared/zigzag';
import type { FirestoreLike } from '../../common/firestore/firestore-like';
import type { CurrentSwing } from '../types';

export class SwingSetRepository {
  constructor(private readonly db: FirestoreLike) {}

  private docId(symbol: string, paramsId: string): string {
    return `${symbol.toUpperCase()}_${paramsId}`;
  }

  async upsert(doc: SwingSetDoc): Promise<void> {
    await this.db
      .collection(FirestoreCollection.OPTIONS_SWING_SETS)
      .doc(this.docId(doc.symbol, doc.paramsId))
      // Normalize symbol so the stored field always matches the uppercase
      // keying + listBySymbol filter semantics. Full (non-merge) write so a
      // regenerate also wipes fields dropped by the slim doc shape.
      .set({ ...doc, symbol: doc.symbol.toUpperCase() });
  }

  async get(symbol: string, paramsId: string): Promise<SwingSetDoc | null> {
    const snap = await this.db
      .collection(FirestoreCollection.OPTIONS_SWING_SETS)
      .doc(this.docId(symbol, paramsId))
      .get();
    return snap.exists ? (snap.data() as SwingSetDoc) : null;
  }

  async listBySymbol(symbol: string): Promise<SwingSetDoc[]> {
    const snap = await this.db
      .collection(FirestoreCollection.OPTIONS_SWING_SETS)
      .where('symbol', '==', symbol.toUpperCase())
      .get();
    return snap.docs.map((d) => d.data() as SwingSetDoc);
  }

  /** Confirmed pivot dates for a symbol/config (empty when no doc). */
  async listConfirmedPivotDates(symbol: string, paramsId: string): Promise<string[]> {
    const doc = await this.get(symbol, paramsId);
    return Array.isArray(doc?.pivotDates) ? doc.pivotDates : [];
  }

  /**
   * The developing swing's direction and latest extreme — a straight read of
   * the `currentDirection`/`currentExtremeDate` fields stamped at generation
   * time (see SwingSetGenerationService.currentExtreme).
   */
  async getCurrentSwing(symbol: string, paramsId: string): Promise<CurrentSwing | null> {
    const doc = await this.get(symbol, paramsId);
    if (!doc || !doc.currentExtremeDate || !doc.currentDirection) return null;
    return { direction: doc.currentDirection, extremeDate: doc.currentExtremeDate };
  }
}
