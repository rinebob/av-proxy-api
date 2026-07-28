import type { Firestore } from 'firebase-admin/firestore';

import {
  OPTIONS_FILE_INDEX_COLLECTION,
  TS_CONTRACTS_SUBCOLLECTION,
  type ContractSummaryDoc,
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

    const lengthBuckets: Record<string, number> = {};
    const expirationSet = new Set<string>();
    let totalContracts = 0;

    for (const doc of snap.docs) {
      const data = doc.data();
      totalContracts++;

      const bucket = data.contractLengthBucket as string | undefined;
      if (bucket) {
        lengthBuckets[bucket] = (lengthBuckets[bucket] ?? 0) + 1;
      }

      const expiration = data.expiration as string | undefined;
      if (expiration) {
        expirationSet.add(expiration);
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
      bucketCount: Object.keys(lengthBuckets).length,
    });

    return summary;
  }
}
