import type { Firestore } from 'firebase-admin/firestore';

import {
  OPTIONS_FILE_INDEX_COLLECTION,
  TS_CONTRACTS_SUBCOLLECTION,
  LENGTH_BUCKET_LABELS,
  LENGTH_BUCKET_SORT_INDEX,
  type ContractSummaryDoc,
  type LengthBucketEntry,
} from '@shared/options';

export type SummaryLogger = (message: string, meta?: Record<string, unknown>) => void;

/**
 * Aggregation service that scans all `ts-contracts` docs for a symbol and
 * writes the symbol summary doc with a length-bucket histogram and totals.
 *
 * Single concern: aggregating catalog docs into a summary doc.
 * Runs once per day per symbol after the builder completes.
 */
export class ContractSummaryAggregator {
  private readonly log: SummaryLogger;

  constructor(
    private readonly db: Firestore,
    logger?: SummaryLogger,
  ) {
    this.log = logger ?? ((msg: string) => console.log(msg));
  }

  /**
   * Scans all `ts-contracts` docs for the given symbol, computes the
   * length-bucket histogram, total contract count, and expiration count,
   * then writes the summary doc.
   */
  async aggregateAndWriteSummary(symbol: string): Promise<ContractSummaryDoc> {
    const upperSymbol = symbol.toUpperCase();

    const colRef = this.db
      .collection(OPTIONS_FILE_INDEX_COLLECTION)
      .doc(upperSymbol)
      .collection(TS_CONTRACTS_SUBCOLLECTION);

    const snap = await colRef.get();

    const rawCounts = new Map<string, number>();
    const expirationSet = new Set<string>();
    let totalContracts = 0;

    for (const doc of snap.docs) {
      const data = doc.data();
      totalContracts++;

      const bucket = data.contractLengthBucket as string | undefined;
      if (bucket) {
        rawCounts.set(bucket, (rawCounts.get(bucket) ?? 0) + 1);
      }

      const expiration = data.expiration as string | undefined;
      if (expiration) {
        expirationSet.add(expiration);
      }
    }

    // # Reason: Iterate LENGTH_BUCKET_LABELS in canonical order so the
    // output array is pre-sorted by contract length. Only include buckets
    // with at least one contract.
    const lengthBuckets: LengthBucketEntry[] = [];
    for (const label of LENGTH_BUCKET_LABELS) {
      const count = rawCounts.get(label);
      if (count) {
        lengthBuckets.push({
          label,
          count,
          sortOrder: LENGTH_BUCKET_SORT_INDEX.get(label) ?? -1,
        });
      }
    }

    const summary: ContractSummaryDoc = {
      symbol: upperSymbol,
      totalContracts,
      expirationCount: expirationSet.size,
      lengthBuckets,
      lastUpdated: new Date().toISOString(),
    };

    const docRef = this.db.collection(OPTIONS_FILE_INDEX_COLLECTION).doc(upperSymbol);
    await docRef.set(summary, { merge: true });

    this.log('catalog.summary.aggregated', {
      symbol: upperSymbol,
      totalContracts,
      expirationCount: expirationSet.size,
      bucketCount: lengthBuckets.length,
    });

    return summary;
  }
}
