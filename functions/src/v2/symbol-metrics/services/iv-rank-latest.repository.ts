/**
 * IvRankLatestRepository — flat `iv-rank-latest/{SYMBOL}` docs backing the
 * partnerIvRankV2 screener table (Topic #158, Thread #163, Task #187).
 *
 * The doc is a whole-document replace — it carries exactly the newest rank
 * snapshot; merge semantics would let a dropped field linger stale. Disabled
 * symbols' docs are deleted on the optionsEnabled false-transition (#188).
 */
import { FieldValue } from '../../../firebase-admin-init';
import { IV_RANK_LATEST_COLLECTION, type IvRankLatestDoc } from '@shared/options';
import type { FirestoreLike } from '../../common/firestore/firestore-like';

export class IvRankLatestRepository {
  constructor(private readonly db: FirestoreLike) {}

  private docRef(symbol: string) {
    return this.db.collection(IV_RANK_LATEST_COLLECTION).doc(symbol.toUpperCase());
  }

  async read(symbol: string): Promise<IvRankLatestDoc | null> {
    const snap = await this.docRef(symbol).get();
    return snap.exists ? (snap.data() as IvRankLatestDoc) : null;
  }

  /** Whole-doc replace — the doc IS the latest snapshot. */
  async upsert(
    symbol: string,
    asOfDate: string,
    fields: Record<string, number | undefined>,
  ): Promise<void> {
    await this.docRef(symbol).set({
      symbol: symbol.toUpperCase(),
      asOfDate,
      ...fields,
      updatedAt: FieldValue.serverTimestamp(),
    });
  }

  async delete(symbol: string): Promise<void> {
    await this.docRef(symbol).delete();
  }
}
