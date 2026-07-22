import { AlphaVantageUpstreamError, AlphaVantageUpstreamErrorCategory } from '../../../src/v2/alpha-vantage/utils';
import { CorpusMetadataService } from '../../../src/v2/historical-options-corpus/services/corpus-metadata.service';
import { GcsCorpusAdapter, GcsCorpusWriteError } from '../../../src/v2/historical-options-corpus/services/gcs-corpus-adapter.service';
import { HistoricalOptionsRetrievalService } from '../../../src/v2/historical-options-corpus/services/historical-options-retrieval.service';
import {
  isCorpusSeedRetryable,
  MAX_CORPUS_SEED_ATTEMPTS,
  seedCorpusItem,
  type SeedWorkerDependencies,
} from '../../../src/v2/historical-options-corpus/services/corpus-seed.worker';

const responsePayload = {
  response: {
    endpoint: 'HISTORICAL_OPTIONS',
    message: 'success',
    data: [],
  },
  analysis: {
    summary: {
      totalContracts: 0,
      totalVolume: 0,
      totalOpenInterest: 0,
      callContracts: 0,
      putContracts: 0,
      uniqueStrikes: 0,
      avgVolumePerContract: 0,
      avgOpenInterest: 0,
    },
    expirations: [],
    strikes: [],
  },
};

function createDependencies(overrides: Partial<SeedWorkerDependencies> = {}): SeedWorkerDependencies {
  return {
    retrieval: {
      fetch: jest.fn().mockResolvedValue(responsePayload),
    } as unknown as HistoricalOptionsRetrievalService,
    gcs: {
      getMetadata: jest.fn().mockResolvedValue(undefined),
      readItem: jest.fn().mockResolvedValue({ status: 'NOT_FOUND' }),
      writeItem: jest.fn().mockResolvedValue({
        gcsPath: 'gs://bucket/historical-options/v1/QQQ/2026-01-02.json.gz',
        bytes: 100,
        sha256: 'abc',
        generation: '123',
        alreadyExists: false,
      }),
      getObjectPath: jest.fn().mockReturnValue('historical-options/v1/QQQ/2026-01-02.json.gz'),
    } as unknown as GcsCorpusAdapter,
    metadata: {
      getItemDoc: jest.fn().mockResolvedValue(undefined),
      touchItem: jest.fn().mockResolvedValue(undefined),
      setItemSuccess: jest.fn().mockResolvedValue(undefined),
      setItemFailure: jest.fn().mockResolvedValue(undefined),
      incrementCompleted: jest.fn().mockResolvedValue(undefined),
      incrementFailed: jest.fn().mockResolvedValue(undefined),
    } as unknown as CorpusMetadataService,
    enqueueTask: jest.fn().mockResolvedValue(undefined),
    maxAttempts: MAX_CORPUS_SEED_ATTEMPTS,
    logger: jest.fn(),
    ...overrides,
  };
}

describe('seedCorpusItem', () => {
  it('fetches, stores, and records a new item', async () => {
    const deps = createDependencies();

    const result = await seedCorpusItem(
      { runId: 'run-1', symbol: 'QQQ', date: '2026-01-02', attempt: 1 },
      deps,
    );

    expect(result.status).toBe('stored');
    expect(deps.metadata.setItemSuccess).toHaveBeenCalled();
    expect(deps.metadata.incrementCompleted).toHaveBeenCalledWith('run-1', 1);
  });

  it('skips when the metadata already reports success', async () => {
    const deps = createDependencies({
      metadata: {
        getItemDoc: jest.fn().mockResolvedValue({ status: 'success' }),
      } as any,
    });

    const result = await seedCorpusItem(
      { runId: 'run-1', symbol: 'QQQ', date: '2026-01-02', attempt: 1 },
      deps,
    );

    expect(result.status).toBe('skipped');
    expect(deps.retrieval.fetch).not.toHaveBeenCalled();
  });

  it('skips when a valid object is already in GCS', async () => {
    const deps = createDependencies({
      gcs: {
        getMetadata: jest.fn().mockResolvedValue({
          gcsPath: 'historical-options/v1/QQQ/2026-01-02.json.gz',
          bytes: 50,
          sha256: 'existing-sha',
          generation: '999',
          version: 'v1',
          schema: 'historical-options',
          symbol: 'QQQ',
          date: '2026-01-02',
        }),
      } as any,
    });

    const result = await seedCorpusItem(
      { runId: 'run-1', symbol: 'QQQ', date: '2026-01-02', attempt: 1 },
      deps,
    );

    expect(result.status).toBe('skipped');
    expect(deps.retrieval.fetch).not.toHaveBeenCalled();
    expect(deps.metadata.incrementCompleted).toHaveBeenCalledWith('run-1', 0);
  });

  it('re-enqueues a retry on a transient failure', async () => {
    const deps = createDependencies({
      retrieval: {
        fetch: jest.fn().mockRejectedValue(
          new AlphaVantageUpstreamError(AlphaVantageUpstreamErrorCategory.TIMEOUT),
        ),
      } as any,
    });

    const result = await seedCorpusItem(
      { runId: 'run-1', symbol: 'QQQ', date: '2026-01-02', attempt: 1 },
      deps,
    );

    expect(result.status).toBe('retry_enqueued');
    if (result.status === 'retry_enqueued') {
      expect(result.nextAttempt).toBe(2);
    }
    expect(deps.enqueueTask).toHaveBeenCalledWith(
      expect.objectContaining({ attempt: 2 }),
    );
  });

  it('marks permanent failure after exhausting attempts', async () => {
    const deps = createDependencies({
      retrieval: {
        fetch: jest.fn().mockRejectedValue(new Error('broken')),
      } as any,
    });

    const result = await seedCorpusItem(
      { runId: 'run-1', symbol: 'QQQ', date: '2026-01-02', attempt: MAX_CORPUS_SEED_ATTEMPTS },
      deps,
    );

    expect(result.status).toBe('permanent_failure');
    expect(deps.metadata.incrementFailed).toHaveBeenCalledWith('run-1');
    expect(deps.enqueueTask).not.toHaveBeenCalled();
  });

  it('marks a generic error as a permanent failure on the first attempt', async () => {
    const deps = createDependencies({
      retrieval: {
        fetch: jest.fn().mockRejectedValue(new Error('malformed response')),
      } as any,
    });

    const result = await seedCorpusItem(
      { runId: 'run-1', symbol: 'QQQ', date: '2026-01-02', attempt: 1 },
      deps,
    );

    expect(result.status).toBe('permanent_failure');
    expect(deps.metadata.setItemFailure).toHaveBeenCalledWith(
      'run-1',
      'QQQ_2026-01-02',
      'malformed response',
      'permanent_failure',
    );
    expect(deps.metadata.incrementFailed).toHaveBeenCalledWith('run-1');
    expect(deps.enqueueTask).not.toHaveBeenCalled();
  });

  it('marks a GCS write error as a permanent failure on the first attempt', async () => {
    const deps = createDependencies({
      retrieval: { fetch: jest.fn().mockResolvedValue(responsePayload) } as any,
      gcs: {
        getMetadata: jest.fn().mockResolvedValue(undefined),
        readItem: jest.fn().mockResolvedValue({ status: 'NOT_FOUND' }),
        writeItem: jest.fn().mockRejectedValue(
          new GcsCorpusWriteError('GCS write failed', 'WRITE_FAILED'),
        ),
        getObjectPath: jest.fn().mockReturnValue('historical-options/v1/QQQ/2026-01-02.json.gz'),
      } as any,
    });

    const result = await seedCorpusItem(
      { runId: 'run-1', symbol: 'QQQ', date: '2026-01-02', attempt: 1 },
      deps,
    );

    expect(result.status).toBe('permanent_failure');
    expect(deps.metadata.incrementFailed).toHaveBeenCalledWith('run-1');
    expect(deps.enqueueTask).not.toHaveBeenCalled();
  });

  describe('isCorpusSeedRetryable', () => {
    it('treats rate-limited, timeout, and upstream errors as retryable', () => {
      expect(
        isCorpusSeedRetryable(new AlphaVantageUpstreamError(AlphaVantageUpstreamErrorCategory.RATE_LIMITED)),
      ).toBe(true);
      expect(
        isCorpusSeedRetryable(new AlphaVantageUpstreamError(AlphaVantageUpstreamErrorCategory.TIMEOUT)),
      ).toBe(true);
      expect(
        isCorpusSeedRetryable(new AlphaVantageUpstreamError(AlphaVantageUpstreamErrorCategory.UPSTREAM_ERROR)),
      ).toBe(true);
    });

    it('treats generic and GCS errors as non-retryable', () => {
      expect(isCorpusSeedRetryable(new Error('broken'))).toBe(false);
      expect(isCorpusSeedRetryable(new GcsCorpusWriteError('fail', 'WRITE_FAILED'))).toBe(false);
    });
  });
});
