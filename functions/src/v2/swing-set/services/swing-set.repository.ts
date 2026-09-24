/**
 * SwingSetRepository — Firestore read/write layer for `options-swing-sets`.
 *
 * Docs are keyed `{symbol}_{paramsId}` and written with `set(merge)` so
 * repeated generation for the same (symbol, config) is idempotent.
 * Consumers: SwingSetGenerationService (#125), Thread #106 corpus ingest.
 */
import { FirestoreCollection } from '@shared/firestore';
import type { Pivot, SwingSetDoc } from '@shared/zigzag';
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
      // keying + listBySymbol filter semantics.
      .set({ ...doc, symbol: doc.symbol.toUpperCase() }, { merge: true });
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

  async listConfirmedPivots(symbol: string, paramsId: string): Promise<Pivot[]> {
    const doc = await this.get(symbol, paramsId);
    const pivots = Array.isArray(doc?.pivots) ? doc.pivots : [];
    return pivots.filter((p) => p.confirmed);
  }

  /**
   * The developing swing's direction and latest extreme.
   *
   * With a projection present, the projection IS the current extreme and its
   * direction is the developing swing's direction (isHigh → 'up'). Without a
   * projection (swing hasn't advanced enough to paint one), the current
   * extreme is the last confirmed pivot itself — its date is returned as the
   * extreme, with direction pointing away from it.
   */
  async getCurrentSwing(symbol: string, paramsId: string): Promise<CurrentSwing | null> {
    const doc = await this.get(symbol, paramsId);
    const pivots = Array.isArray(doc?.pivots) ? doc.pivots : [];
    const lastPivot = pivots[pivots.length - 1];
    if (!doc || !lastPivot) return null;

    if (doc.projection) {
      return {
        direction: doc.projection.isHigh ? 'up' : 'down',
        extremeDate: new Date(doc.projection.time).toISOString().slice(0, 10),
      };
    }
    return {
      direction: lastPivot.isHigh ? 'down' : 'up',
      extremeDate: new Date(lastPivot.time).toISOString().slice(0, 10),
    };
  }
}
