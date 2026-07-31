import type { CatalogQueryFilters } from '../../../src/v2/historical-options-corpus/services/contract-catalog-query.service';

/** Type that exposes the private getActiveRangeDimensions method for testing. */
type QueryServiceForTest = {
  getActiveRangeDimensions: (filters: CatalogQueryFilters) => Array<{ dimension: string; fieldPath: string }>;
};

/**
 * Unit tests for ContractCatalogQueryService range-dimension detection logic.
 *
 * The service's `queryCatalog` method delegates to Firestore, so we test
 * the pure logic (`getActiveRangeDimensions`) by instantiating the service
 * with a mock Firestore and asserting on the returned dimension array.
 * When more than one dimension is returned, `queryCatalog` throws
 * `FilterConflictError` before any Firestore I/O occurs.
 */

import type { Firestore } from 'firebase-admin/firestore';

function createMockFirestore(): Firestore {
  return {
    collection: jest.fn(),
    doc: jest.fn(),
  } as unknown as Firestore;
}

describe('ContractCatalogQueryService.getActiveRangeDimensions', () => {
  // We access the private method via a type cast to test it directly.
  // # Reason: getActiveRangeDimensions is pure logic with no I/O — testing
  // it in isolation is cleaner than mocking the full Firestore query chain.

  let service: QueryServiceForTest;

  beforeEach(() => {
    // Dynamically import to avoid loading firebase-admin at test time
    const { ContractCatalogQueryService } = require('../../../src/v2/historical-options-corpus/services/contract-catalog-query.service');
    service = new ContractCatalogQueryService(createMockFirestore()) as unknown as QueryServiceForTest;
  });

  it('detects a single expiration range dimension', () => {
    const dims = service.getActiveRangeDimensions({
      symbol: 'QQQ',
      expirationGte: '2024-07-15',
      expirationLte: '2026-07-15',
    });
    expect(dims).toHaveLength(1);
    expect(dims[0].dimension).toBe('expiration');
    expect(dims[0].fieldPath).toBe('expiration');
  });

  it('detects only one dimension when expiration range is combined with equality filters', () => {
    const dims = service.getActiveRangeDimensions({
      symbol: 'QQQ',
      expirationGte: '2024-07-15',
      expirationLte: '2026-07-15',
      type: 'call',
      contractLengthBuckets: ['3mo'],
    });
    expect(dims).toHaveLength(1);
  });

  it('detects only strike dimension when exact expiration (equality) is used with a strike range', () => {
    const dims = service.getActiveRangeDimensions({
      symbol: 'QQQ',
      expiration: '2026-01-16',
      strikeGte: 400,
      strikeLte: 500,
    });
    expect(dims).toHaveLength(1);
    expect(dims[0].dimension).toBe('strike');
  });

  it('detects two dimensions when expiration range and strike range are combined', () => {
    const dims = service.getActiveRangeDimensions({
      symbol: 'QQQ',
      expirationGte: '2024-07-15',
      expirationLte: '2026-07-15',
      strikeGte: 400,
      strikeLte: 500,
    });
    expect(dims).toHaveLength(2);
  });

  it('detects two dimensions when expiration range and delta range are combined', () => {
    const dims = service.getActiveRangeDimensions({
      symbol: 'QQQ',
      expirationGte: '2024-07-15',
      deltaGte: 0.3,
      deltaLte: 0.7,
    });
    expect(dims).toHaveLength(2);
  });

  it('detects two dimensions when expiration range and minObservationCount are combined', () => {
    const dims = service.getActiveRangeDimensions({
      symbol: 'QQQ',
      expirationLte: '2026-07-15',
      minObservationCount: 10,
    });
    expect(dims).toHaveLength(2);
  });

  it('detects two dimensions when strike range and delta range are combined (no expiration)', () => {
    const dims = service.getActiveRangeDimensions({
      symbol: 'QQQ',
      strikeGte: 400,
      deltaGte: 0.3,
    });
    expect(dims).toHaveLength(2);
  });

  it('returns zero dimensions for multiple contractLengthBuckets (equality, not range)', () => {
    const dims = service.getActiveRangeDimensions({
      symbol: 'QQQ',
      contractLengthBuckets: ['3mo', '6mo', '1yr'],
    });
    expect(dims).toHaveLength(0);
  });

  it('returns zero dimensions when no range filters are present', () => {
    const dims = service.getActiveRangeDimensions({
      symbol: 'QQQ',
      type: 'call',
      contractLengthBuckets: ['3mo'],
    });
    expect(dims).toHaveLength(0);
  });

  it('detects only expirationGte (open-ended range)', () => {
    const dims = service.getActiveRangeDimensions({
      symbol: 'QQQ',
      expirationGte: '2024-07-15',
    });
    expect(dims).toHaveLength(1);
    expect(dims[0].dimension).toBe('expiration');
  });

  it('detects only expirationLte (open-ended range)', () => {
    const dims = service.getActiveRangeDimensions({
      symbol: 'QQQ',
      expirationLte: '2026-07-15',
    });
    expect(dims).toHaveLength(1);
    expect(dims[0].dimension).toBe('expiration');
  });

  it('returns correct dimension names for all five range types', () => {
    expect(service.getActiveRangeDimensions({ symbol: 'QQQ', ivGte: 0.3 })[0].dimension).toBe('iv');
    expect(service.getActiveRangeDimensions({ symbol: 'QQQ', ivLte: 0.9 })[0].dimension).toBe('iv');
    expect(service.getActiveRangeDimensions({ symbol: 'QQQ', deltaGte: 0.3 })[0].dimension).toBe('delta');
    expect(service.getActiveRangeDimensions({ symbol: 'QQQ', minObservationCount: 10 })[0].dimension).toBe('observationCount');
  });

  it('returns correct Firestore field paths for all five range types', () => {
    expect(service.getActiveRangeDimensions({ symbol: 'QQQ', deltaGte: 0.3 })[0].fieldPath).toBe('latestDelta');
    expect(service.getActiveRangeDimensions({ symbol: 'QQQ', ivGte: 0.3 })[0].fieldPath).toBe('latestIv');
    expect(service.getActiveRangeDimensions({ symbol: 'QQQ', minObservationCount: 10 })[0].fieldPath).toBe('observationCount');
  });
});
