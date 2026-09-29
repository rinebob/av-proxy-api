import type { Firestore } from 'firebase-admin/firestore';

import { db, FieldValue } from '../../../firebase-admin-init';
import {
  OPTIONS_CORPUS_ITEMS_SUBCOLLECTION,
  OPTIONS_CORPUS_RUNS_COLLECTION,
  type CorpusItemDoc,
  type CorpusItemKey,
  type CorpusRunDoc,
} from '../types';

/** Cap on runs scanned by listItemsForSymbol — newest first by createdAt. */
const LIST_ITEMS_FOR_SYMBOL_RECENT_RUNS = 50;

export interface CorpusRunPlan {
  runId: string;
  symbols: string[];
  startDate: string;
  endDate: string;
  totalItems: number;
  items: CorpusItemKey[];
  dryRun: boolean;
  pilot: boolean;
}

/**
 * Firestore metadata service for the historical options corpus.
 *
 * Owns small metadata documents (`options_corpus_runs/{runId}` and
 * `options_corpus_runs/{runId}/items/{symbol}_{date}`). Raw options chains
 * are never written to Firestore.
 */
export class CorpusMetadataService {
  constructor(private readonly firestore: Firestore = db) {}

  private runRef(runId: string) {
    return this.firestore.collection(OPTIONS_CORPUS_RUNS_COLLECTION).doc(runId);
  }

  private itemRef(runId: string, itemKey: string) {
    return this.runRef(runId).collection(OPTIONS_CORPUS_ITEMS_SUBCOLLECTION).doc(itemKey);
  }

  async runExists(runId: string): Promise<boolean> {
    const snap = await this.runRef(runId).get();
    return snap.exists;
  }

  async getRunDoc(runId: string): Promise<CorpusRunDoc | undefined> {
    const snap = await this.runRef(runId).get();
    return snap.exists ? (snap.data() as CorpusRunDoc) : undefined;
  }

  async getItemDoc(runId: string, itemKey: string): Promise<CorpusItemDoc | undefined> {
    const snap = await this.itemRef(runId, itemKey).get();
    return snap.exists ? (snap.data() as CorpusItemDoc) : undefined;
  }

  /**
   * Creates a run document and its pending item documents. Items are written
   * in chunks — a single batch caps at 500 writes and pivot-driven fanouts
   * can exceed that on volatile symbols.
   */
  async createRunPlan(plan: CorpusRunPlan): Promise<void> {
    const now = FieldValue.serverTimestamp();

    const runDoc: Omit<CorpusRunDoc, 'createdAt' | 'updatedAt'> & {
      createdAt: FirebaseFirestore.FieldValue;
      updatedAt: FirebaseFirestore.FieldValue;
    } = {
      runId: plan.runId,
      createdAt: now,
      updatedAt: now,
      status: 'planned',
      symbols: plan.symbols,
      startDate: plan.startDate,
      endDate: plan.endDate,
      totalItems: plan.totalItems,
      completedItems: 0,
      failedItems: 0,
      apiCalls: 0,
      dryRun: plan.dryRun,
      pilot: plan.pilot,
    };

    const runBatch = this.firestore.batch();
    runBatch.set(this.runRef(plan.runId), runDoc);
    await runBatch.commit();

    const ITEM_BATCH_SIZE = 450;
    for (let i = 0; i < plan.items.length; i += ITEM_BATCH_SIZE) {
      const batch = this.firestore.batch();
      for (const item of plan.items.slice(i, i + ITEM_BATCH_SIZE)) {
        const key = this.itemKey(item);
        const itemDoc: Omit<CorpusItemDoc, 'attemptedAt'> & {
          attemptedAt?: FirebaseFirestore.FieldValue;
        } = {
          symbol: item.symbol,
          date: item.date,
          status: 'pending',
          attempts: 0,
        };
        batch.set(this.itemRef(plan.runId, key), itemDoc);
      }
      await batch.commit();
    }
  }

  /**
   * Idempotently updates an item document. `attemptedAt` is always bumped to
   * the server timestamp and `attempts` is incremented by one.
   */
  async touchItem(runId: string, itemKey: string, status: CorpusItemDoc['status']): Promise<void> {
    await this.itemRef(runId, itemKey).set(
      {
        status,
        attempts: FieldValue.increment(1),
        attemptedAt: FieldValue.serverTimestamp(),
      } as any,
      { merge: true },
    );
  }

  async updateItem(
    runId: string,
    itemKey: string,
    fields: Partial<CorpusItemDoc>,
  ): Promise<void> {
    const data: Record<string, unknown> = { ...fields };
    if (!('attemptedAt' in data)) {
      data.attemptedAt = FieldValue.serverTimestamp();
    }
    await this.itemRef(runId, itemKey).set(data as any, { merge: true });
  }

  async setItemSuccess(
    runId: string,
    itemKey: string,
    details: {
      gcsPath: string;
      sha256: string;
      bytes: number;
      generation?: string;
      apiCalls: number;
    },
  ): Promise<void> {
    await this.itemRef(runId, itemKey).set(
      {
        status: 'success',
        gcsPath: details.gcsPath,
        sha256: details.sha256,
        bytes: details.bytes,
        ...(details.generation ? { generation: details.generation } : {}),
        apiCalls: details.apiCalls,
        completedAt: FieldValue.serverTimestamp(),
      } as any,
      { merge: true },
    );
  }

  async setItemFailure(
    runId: string,
    itemKey: string,
    error: string,
    status: CorpusItemDoc['status'] = 'failure',
  ): Promise<void> {
    await this.itemRef(runId, itemKey).set(
      {
        status,
        error,
        completedAt: FieldValue.serverTimestamp(),
      } as any,
      { merge: true },
    );
  }

  async incrementCompleted(runId: string, apiCalls = 1): Promise<void> {
    await this.runRef(runId).update({
      completedItems: FieldValue.increment(1),
      apiCalls: FieldValue.increment(apiCalls),
      updatedAt: FieldValue.serverTimestamp(),
    } as any);
  }

  async incrementFailed(runId: string): Promise<void> {
    await this.runRef(runId).update({
      failedItems: FieldValue.increment(1),
      updatedAt: FieldValue.serverTimestamp(),
    } as any);
  }

  async markRunStatus(runId: string, status: CorpusRunDoc['status']): Promise<void> {
    await this.runRef(runId).update({
      status,
      updatedAt: FieldValue.serverTimestamp(),
    } as any);
  }

  async listItems(runId: string): Promise<Array<{ id: string; data: CorpusItemDoc }>> {
    const snap = await this.runRef(runId).collection(OPTIONS_CORPUS_ITEMS_SUBCOLLECTION).get();
    return snap.docs.map((doc) => ({ id: doc.id, data: doc.data() as CorpusItemDoc }));
  }

  /**
   * Seed items for a symbol across its recent runs (Task #156 coverage
   * report). Finds runs via `symbols array-contains` on the run docs
   * (automatic single-field index — a collectionGroup scan on `items` would
   * need a new COLLECTION_GROUP index deploy), keeps the newest
   * `RECENT_RUN_LIMIT` by `createdAt` (latest-wins ordering means only the
   * most recent attempt per date can win anyway), then fetches each run's
   * matching items in bounded-parallel chunks.
   *
   * `touchedAtMs` is the item's latest touch (completedAt ?? attemptedAt),
   * falling back to the run's `createdAt` — pending items carry neither
   * timestamp, and without the fallback a newly-queued retry would lose
   * latest-wins ordering to an older failure. `runState` is the owning run
   * doc's status so callers can tell live queue entries from dead-run
   * leftovers.
   */
  async listItemsForSymbol(
    symbol: string,
  ): Promise<Array<{ id: string; runId: string; runState: CorpusRunDoc['status']; data: CorpusItemDoc; touchedAtMs: number }>> {
    const upper = symbol.trim().toUpperCase();
    const runs = await this.firestore
      .collection(OPTIONS_CORPUS_RUNS_COLLECTION)
      .where('symbols', 'array-contains', upper)
      .get();
    const recent = runs.docs
      .map((doc) => ({ id: doc.id, data: doc.data() as CorpusRunDoc }))
      .sort((a, b) => (b.data.createdAt?.toMillis() ?? 0) - (a.data.createdAt?.toMillis() ?? 0))
      .slice(0, LIST_ITEMS_FOR_SYMBOL_RECENT_RUNS);

    const out: Array<{ id: string; runId: string; runState: CorpusRunDoc['status']; data: CorpusItemDoc; touchedAtMs: number }> = [];
    const CHUNK = 10;
    for (let i = 0; i < recent.length; i += CHUNK) {
      const batch = await Promise.all(
        recent.slice(i, i + CHUNK).map(async (run) => {
          const runCreatedAtMs = run.data.createdAt?.toMillis() ?? 0;
          const items = await this.runRef(run.id)
            .collection(OPTIONS_CORPUS_ITEMS_SUBCOLLECTION)
            .where('symbol', '==', upper)
            .get();
          return items.docs.map((doc) => {
            const data = doc.data() as CorpusItemDoc;
            const touched = data.completedAt ?? data.attemptedAt;
            return {
              id: doc.id,
              runId: run.id,
              runState: run.data.status,
              data,
              touchedAtMs: touched ? touched.toMillis() : runCreatedAtMs,
            };
          });
        }),
      );
      out.push(...batch.flat());
    }
    return out;
  }

  itemKey(item: CorpusItemKey): string {
    return `${item.symbol.toUpperCase()}_${item.date}`;
  }
}
