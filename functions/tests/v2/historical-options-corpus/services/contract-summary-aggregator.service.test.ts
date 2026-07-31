import type { Firestore } from 'firebase-admin/firestore';

import { LENGTH_BUCKET_LABELS } from '@shared/options';
import type { ContractSummaryDoc, LengthBucketEntry } from '@shared/options';

/**
 * Unit tests for ContractSummaryAggregator.
 *
 * Verifies that the summary response uses the LengthBucketEntry[] format,
 * is pre-sorted by canonical bucket order, and only includes buckets with
 * count > 0.
 */

interface MockDocSnap {
  data: () => Record<string, unknown>;
}

interface MockCollectionSnap {
  docs: MockDocSnap[];
}

interface MockSubcollectionRef {
  get: jest.Mock;
}

interface MockSymbolDocRef {
  collection: jest.Mock;
  set: jest.Mock;
}

interface MockCollectionRef {
  doc: jest.Mock;
}

function createMockFirestore(docs: MockDocSnap[]): Firestore {
  const subcollectionRef: MockSubcollectionRef = {
    get: jest.fn().mockResolvedValue({ docs } as MockCollectionSnap),
  };

  const symbolDocRef: MockSymbolDocRef = {
    collection: jest.fn().mockReturnValue(subcollectionRef),
    set: jest.fn().mockResolvedValue(undefined),
  };

  const collectionRef: MockCollectionRef = {
    doc: jest.fn().mockReturnValue(symbolDocRef),
  };

  return {
    collection: jest.fn().mockReturnValue(collectionRef),
  } as unknown as Firestore;
}

function makeContractDoc(overrides: Partial<Record<string, unknown>> = {}): MockDocSnap {
  return {
    data: () => ({
      contractId: 'QQQ260116C00450000',
      expiration: '2026-01-16',
      contractLengthBucket: '3mo',
      ...overrides,
    }),
  };
}

describe('ContractSummaryAggregator.aggregateAndWriteSummary', () => {

  it('returns lengthBuckets as LengthBucketEntry[] array (expected use)', async () => {
    const docs = [
      makeContractDoc({ contractLengthBucket: '1d' }),
      makeContractDoc({ contractLengthBucket: '3mo' }),
      makeContractDoc({ contractLengthBucket: '3mo' }),
      makeContractDoc({ contractLengthBucket: '1yr' }),
    ];
    const db = createMockFirestore(docs);
    const { ContractSummaryAggregator } = require('../../../src/v2/historical-options-corpus/services/contract-summary-aggregator.service');
    const aggregator = new ContractSummaryAggregator(db, jest.fn());

    const summary: ContractSummaryDoc = await aggregator.aggregateAndWriteSummary('QQQ');

    expect(Array.isArray(summary.lengthBuckets)).toBe(true);
    expect(summary.lengthBuckets).toHaveLength(3);

    const entry: LengthBucketEntry = summary.lengthBuckets[0];
    expect(entry).toHaveProperty('label');
    expect(entry).toHaveProperty('count');
    expect(entry).toHaveProperty('sortOrder');
    expect(typeof entry.sortOrder).toBe('number');
  });

  it('pre-sorts lengthBuckets in canonical order (shortest to longest)', async () => {
    const docs = [
      makeContractDoc({ contractLengthBucket: '1yr' }),
      makeContractDoc({ contractLengthBucket: '1d' }),
      makeContractDoc({ contractLengthBucket: '3mo' }),
    ];
    const db = createMockFirestore(docs);
    const { ContractSummaryAggregator } = require('../../../src/v2/historical-options-corpus/services/contract-summary-aggregator.service');
    const aggregator = new ContractSummaryAggregator(db, jest.fn());

    const summary = await aggregator.aggregateAndWriteSummary('QQQ');

    const labels = summary.lengthBuckets.map((b: LengthBucketEntry) => b.label);
    const expectedOrder = LENGTH_BUCKET_LABELS.filter((l) => ['1d', '3mo', '1yr'].includes(l));
    expect(labels).toEqual(expectedOrder);

    const sortOrders = summary.lengthBuckets.map((b: LengthBucketEntry) => b.sortOrder);
    expect(sortOrders).toEqual([...sortOrders].sort((a, b) => a - b));
  });

  it('omits buckets with zero contracts (edge case)', async () => {
    const docs = [
      makeContractDoc({ contractLengthBucket: '3mo' }),
      makeContractDoc({ contractLengthBucket: '3mo' }),
    ];
    const db = createMockFirestore(docs);
    const { ContractSummaryAggregator } = require('../../../src/v2/historical-options-corpus/services/contract-summary-aggregator.service');
    const aggregator = new ContractSummaryAggregator(db, jest.fn());

    const summary = await aggregator.aggregateAndWriteSummary('QQQ');

    expect(summary.lengthBuckets).toHaveLength(1);
    expect(summary.lengthBuckets[0].label).toBe('3mo');
    expect(summary.lengthBuckets[0].count).toBe(2);
  });

  it('handles empty collection (failure case)', async () => {
    const db = createMockFirestore([]);
    const { ContractSummaryAggregator } = require('../../../src/v2/historical-options-corpus/services/contract-summary-aggregator.service');
    const aggregator = new ContractSummaryAggregator(db, jest.fn());

    const summary = await aggregator.aggregateAndWriteSummary('QQQ');

    expect(summary.totalContracts).toBe(0);
    expect(summary.expirationCount).toBe(0);
    expect(summary.lengthBuckets).toEqual([]);
  });

  it('counts distinct expirations correctly', async () => {
    const docs = [
      makeContractDoc({ expiration: '2026-01-16', contractLengthBucket: '3mo' }),
      makeContractDoc({ expiration: '2026-01-16', contractLengthBucket: '3mo' }),
      makeContractDoc({ expiration: '2026-03-20', contractLengthBucket: '6mo' }),
      makeContractDoc({ expiration: '2027-01-15', contractLengthBucket: '1yr' }),
    ];
    const db = createMockFirestore(docs);
    const { ContractSummaryAggregator } = require('../../../src/v2/historical-options-corpus/services/contract-summary-aggregator.service');
    const aggregator = new ContractSummaryAggregator(db, jest.fn());

    const summary = await aggregator.aggregateAndWriteSummary('QQQ');

    expect(summary.totalContracts).toBe(4);
    expect(summary.expirationCount).toBe(3);
  });

  it('writes summary doc to Firestore with merge:true', async () => {
    const docs = [makeContractDoc({ contractLengthBucket: '3mo' })];
    const db = createMockFirestore(docs);
    const { ContractSummaryAggregator } = require('../../../src/v2/historical-options-corpus/services/contract-summary-aggregator.service');
    const aggregator = new ContractSummaryAggregator(db, jest.fn());

    await aggregator.aggregateAndWriteSummary('QQQ');

    const symbolDocRef = (db.collection('') as unknown as MockCollectionRef).doc('QQQ') as MockSymbolDocRef;
    expect(symbolDocRef.set).toHaveBeenCalledWith(
      expect.objectContaining({
        symbol: 'QQQ',
        lengthBuckets: expect.arrayContaining([
          expect.objectContaining({ label: '3mo', count: 1, sortOrder: expect.any(Number) }),
        ]),
      }),
      { merge: true },
    );
  });
});
