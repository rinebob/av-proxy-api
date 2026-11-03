import { AvOptionType } from '@shared/alpha-vantage';
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
    isOptionsEnabled: jest.fn().mockResolvedValue(true),
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
      deleteItem: jest.fn().mockResolvedValue(true),
      markChainConfirmed: jest.fn().mockResolvedValue(undefined),
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
  it('stamps the payload kind onto the stored object metadata (Task #154)', async () => {
    const deps = createDependencies();
    await seedCorpusItem(
      { runId: 'run-1', symbol: 'QQQ', date: '2026-01-02', attempt: 1, kind: 'interim' },
      deps,
    );
    expect(deps.gcs.writeItem).toHaveBeenCalledWith(
      'QQQ', '2026-01-02', responsePayload.response, responsePayload.analysis, 'interim',
    );
  });

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

  it('does not fire onSeedSuccess on a permanent failure (Task #224 — no pick task on no-store)', async () => {
    const onSeedSuccess = jest.fn().mockResolvedValue(undefined);
    const deps = createDependencies({
      retrieval: {
        fetch: jest.fn().mockRejectedValue(new Error('malformed response')),
      } as any,
      onSeedSuccess,
    });

    const result = await seedCorpusItem(
      { runId: 'run-1', symbol: 'QQQ', date: '2026-01-02', attempt: 1 },
      deps,
    );

    expect(result.status).toBe('permanent_failure');
    expect(onSeedSuccess).not.toHaveBeenCalled();
  });

  it('does not fire onSeedSuccess on a pre-floor skip', async () => {
    const onSeedSuccess = jest.fn().mockResolvedValue(undefined);
    const deps = createDependencies({ onSeedSuccess });

    const result = await seedCorpusItem(
      { runId: 'run-1', symbol: 'QQQ', date: '2018-12-31', attempt: 1 },
      deps,
    );

    expect(result.status).toBe('skipped');
    expect(onSeedSuccess).not.toHaveBeenCalled();
  });

  it('computes metrics after a fresh write (Task #171)', async () => {
    const computeForDate = jest.fn().mockResolvedValue({ symbol: 'QQQ', date: '2026-01-02', written: true, fields: [] });
    const deps = createDependencies({ metrics: { computeForDate } });

    const result = await seedCorpusItem(
      { runId: 'run-1', symbol: 'QQQ', date: '2026-01-02', attempt: 1 },
      deps,
    );

    expect(result.status).toBe('stored');
    expect(computeForDate).toHaveBeenCalledWith('QQQ', '2026-01-02');
  });

  it('still computes metrics on the gcs-hit path (gap healing)', async () => {
    const computeForDate = jest.fn().mockResolvedValue({ symbol: 'QQQ', date: '2026-01-02', written: true, fields: [] });
    const deps = createDependencies({
      metrics: { computeForDate },
      gcs: {
        getMetadata: jest.fn().mockResolvedValue({
          gcsPath: 'historical-options/v1/QQQ/2026-01-02.json.gz',
          bytes: 50, sha256: 'existing-sha', generation: '999',
          version: 'v1', schema: 'historical-options', symbol: 'QQQ', date: '2026-01-02',
        }),
        readItem: jest.fn().mockResolvedValue({ status: 'NOT_FOUND' }),
      } as any,
    });

    const result = await seedCorpusItem(
      { runId: 'run-1', symbol: 'QQQ', date: '2026-01-02', attempt: 1 },
      deps,
    );

    expect(result.status).toBe('skipped');
    expect(computeForDate).toHaveBeenCalledWith('QQQ', '2026-01-02');
  });

  it('runs the rank pass after the metrics pass (Task #188)', async () => {
    const order: string[] = [];
    const computeForDate = jest.fn(async () => { order.push('metrics'); return { symbol: 'QQQ', date: '2026-01-02', written: true, fields: [] }; });
    const computeRankForDate = jest.fn(async () => { order.push('rank'); return { symbol: 'QQQ', date: '2026-01-02', written: true, fields: [], latestUpdated: true }; });
    const deps = createDependencies({ metrics: { computeForDate }, rankMetrics: { computeRankForDate } });

    const result = await seedCorpusItem(
      { runId: 'run-1', symbol: 'QQQ', date: '2026-01-02', attempt: 1 },
      deps,
    );

    expect(result.status).toBe('stored');
    expect(order).toEqual(['metrics', 'rank']); // second-order pass runs after
    expect(deps.logger).toHaveBeenCalledWith(
      'seed.rank.written',
      expect.objectContaining({ symbol: 'QQQ', latestUpdated: true }),
    );
  });

  it('runs the rank pass even when the metrics pass threw (independent passes)', async () => {
    const computeForDate = jest.fn().mockRejectedValue(new Error('firestore down'));
    const computeRankForDate = jest.fn().mockResolvedValue({ symbol: 'QQQ', date: '2026-01-02', written: true, fields: [], latestUpdated: false });
    const deps = createDependencies({ metrics: { computeForDate }, rankMetrics: { computeRankForDate } });

    const result = await seedCorpusItem(
      { runId: 'run-1', symbol: 'QQQ', date: '2026-01-02', attempt: 1 },
      deps,
    );

    expect(result.status).toBe('stored');
    expect(computeRankForDate).toHaveBeenCalledWith('QQQ', '2026-01-02');
  });

  it('skips both passes when the symbol was disabled mid-flight', async () => {
    const computeForDate = jest.fn();
    const computeRankForDate = jest.fn();
    // First call = the worker's entry gate (enabled); second = the metrics
    // seam's re-check (now disabled — simulates a mid-flight disable).
    const isOptionsEnabled = jest.fn()
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(false);
    const deps = createDependencies({
      metrics: { computeForDate },
      rankMetrics: { computeRankForDate },
      isOptionsEnabled,
    });

    const result = await seedCorpusItem(
      { runId: 'run-1', symbol: 'QQQ', date: '2026-01-02', attempt: 1 },
      deps,
    );

    expect(result.status).toBe('stored'); // seed itself unaffected
    expect(computeForDate).not.toHaveBeenCalled();
    expect(computeRankForDate).not.toHaveBeenCalled();
    expect(deps.logger).toHaveBeenCalledWith(
      'seed.metrics.skip.disabled',
      expect.objectContaining({ symbol: 'QQQ' }),
    );
  });

  it('warns-not-fails when the rank pass throws; metrics still ran', async () => {
    const computeRankForDate = jest.fn().mockRejectedValue(new Error('latest doc gone'));
    const deps = createDependencies({ rankMetrics: { computeRankForDate } });

    const result = await seedCorpusItem(
      { runId: 'run-1', symbol: 'QQQ', date: '2026-01-02', attempt: 1 },
      deps,
    );

    expect(result.status).toBe('stored');
    expect(deps.logger).toHaveBeenCalledWith(
      'seed.rank.error',
      expect.objectContaining({ symbol: 'QQQ' }),
    );
  });

  it('warns-not-fails when metric computation throws', async () => {
    const computeForDate = jest.fn().mockRejectedValue(new Error('firestore down'));
    const deps = createDependencies({ metrics: { computeForDate } });

    const result = await seedCorpusItem(
      { runId: 'run-1', symbol: 'QQQ', date: '2026-01-02', attempt: 1 },
      deps,
    );

    expect(result.status).toBe('stored'); // seed result unchanged
    expect(deps.logger).toHaveBeenCalledWith(
      'seed.metrics.error',
      expect.objectContaining({ symbol: 'QQQ', date: '2026-01-02' }),
    );
  });

  it('computes metrics + re-fires onSeedSuccess on the already-recorded path (heals a prior failure)', async () => {
    const computeForDate = jest.fn().mockResolvedValue({ symbol: 'QQQ', date: '2026-01-02', written: false, fields: [] });
    const onSeedSuccess = jest.fn().mockResolvedValue(undefined);
    const deps = createDependencies({
      metrics: { computeForDate },
      onSeedSuccess,
      metadata: { getItemDoc: jest.fn().mockResolvedValue({ status: 'success' }) } as any,
    });

    const result = await seedCorpusItem({ runId: 'r', symbol: 'QQQ', date: '2026-01-02', attempt: 1 }, deps);

    expect(result.status).toBe('skipped');
    expect(computeForDate).toHaveBeenCalledWith('QQQ', '2026-01-02');
    expect(onSeedSuccess).toHaveBeenCalledWith('QQQ', '2026-01-02');
  });

  it('skips pre-floor (pre-2019) dates with a terminal skipped status — no AV call', async () => {
    const deps = createDependencies();
    const result = await seedCorpusItem({ runId: 'r', symbol: 'QQQ', date: '2008-09-19', attempt: 1 }, deps);

    expect(result).toEqual({ status: 'skipped', reason: 'pre-floor' });
    expect(deps.retrieval.fetch).not.toHaveBeenCalled();
    expect(deps.gcs.writeItem).not.toHaveBeenCalled();
    expect(deps.metadata.setItemFailure).toHaveBeenCalledWith('r', 'QQQ_2008-09-19', 'pre-floor', 'skipped');
    expect(deps.metadata.incrementCompleted).toHaveBeenCalledWith('r', 0);
  });

  it('does not compute metrics on the options-disabled path', async () => {
    const computeForDate = jest.fn();
    const disabled = createDependencies({ metrics: { computeForDate }, isOptionsEnabled: jest.fn().mockResolvedValue(false) });
    await seedCorpusItem({ runId: 'r', symbol: 'QQQ', date: '2026-01-02', attempt: 1 }, disabled);

    expect(computeForDate).not.toHaveBeenCalled();
  });

  describe('chain sanity flags (Task #227)', () => {
    const callsOnlyPayload = {
      response: {
        endpoint: 'HISTORICAL_OPTIONS',
        message: 'success',
        data: [{ type: AvOptionType.CALL }, { type: AvOptionType.CALL }],
      },
      analysis: responsePayload.analysis,
    };
    const twoSidedPayload = {
      response: {
        endpoint: 'HISTORICAL_OPTIONS',
        message: 'success',
        data: [{ type: AvOptionType.CALL }, { type: AvOptionType.PUT }],
      },
      analysis: responsePayload.analysis,
    };
    const suspectStored = {
      gcsPath: 'historical-options/v1/QQQ/2026-01-02.json.gz',
      bytes: 50, sha256: 'old-sha', generation: '999',
      version: 'v1', schema: 'historical-options', symbol: 'QQQ', date: '2026-01-02',
    };

    it('records put/call/row counts and the chain flag on the run item', async () => {
      const deps = createDependencies({
        retrieval: { fetch: jest.fn().mockResolvedValue(callsOnlyPayload) } as any,
      });

      await seedCorpusItem({ runId: 'run-1', symbol: 'QQQ', date: '2026-01-02', attempt: 1 }, deps);

      expect(deps.metadata.setItemSuccess).toHaveBeenCalledWith(
        'run-1', 'QQQ_2026-01-02',
        expect.objectContaining({
          chain: expect.objectContaining({
            putCount: 0, callCount: 2, rowCount: 2, flag: 'calls_only',
          }),
        }),
      );
      expect(deps.logger).toHaveBeenCalledWith(
        'seed.chain-flag', expect.objectContaining({ flag: 'calls_only', putCount: 0, callCount: 2 }),
      );
    });

    it('records counts without a flag for a healthy two-sided chain', async () => {
      const deps = createDependencies({
        retrieval: { fetch: jest.fn().mockResolvedValue(twoSidedPayload) } as any,
      });

      await seedCorpusItem({ runId: 'run-1', symbol: 'QQQ', date: '2026-01-02', attempt: 1 }, deps);

      const details = (deps.metadata.setItemSuccess as jest.Mock).mock.calls[0][2];
      expect(details.chain).toMatchObject({ putCount: 1, callCount: 1, rowCount: 2 });
      expect(details.chain.flag).toBeUndefined();
      expect(deps.logger).not.toHaveBeenCalledWith('seed.chain-flag', expect.anything());
    });

    it('forceRefetch bypasses the GCS-hit shortcut and replaces the object on a healthy refetch', async () => {
      const deps = createDependencies({
        retrieval: { fetch: jest.fn().mockResolvedValue(twoSidedPayload) } as any,
        gcs: {
          getMetadata: jest.fn().mockResolvedValue(suspectStored),
          deleteItem: jest.fn().mockResolvedValue(true),
          writeItem: jest.fn().mockResolvedValue({
            gcsPath: suspectStored.gcsPath, bytes: 100, sha256: 'new-sha',
            generation: '1000', alreadyExists: false,
          }),
          markChainConfirmed: jest.fn(),
          getObjectPath: jest.fn().mockReturnValue(suspectStored.gcsPath),
        } as any,
      });

      const result = await seedCorpusItem(
        { runId: 'run-2', symbol: 'QQQ', date: '2026-01-02', attempt: 1, forceRefetch: true },
        deps,
      );

      expect(result.status).toBe('stored');
      expect(deps.retrieval.fetch).toHaveBeenCalled();
      expect(deps.gcs.deleteItem).toHaveBeenCalledWith('QQQ', '2026-01-02');
      expect(deps.gcs.writeItem).toHaveBeenCalled();
      expect(deps.gcs.markChainConfirmed).not.toHaveBeenCalled();
      const details = (deps.metadata.setItemSuccess as jest.Mock).mock.calls[0][2];
      expect(details.chain.flag).toBeUndefined();
      expect(details.chainFlagConfirmed).toBeUndefined();
    });

    it('forceRefetch marks the object upstream-confirmed when the refetch is still flagged', async () => {
      const deps = createDependencies({
        retrieval: { fetch: jest.fn().mockResolvedValue(callsOnlyPayload) } as any,
        gcs: {
          getMetadata: jest.fn().mockResolvedValue(suspectStored),
          deleteItem: jest.fn(),
          writeItem: jest.fn(),
          markChainConfirmed: jest.fn().mockResolvedValue(undefined),
          getObjectPath: jest.fn().mockReturnValue(suspectStored.gcsPath),
        } as any,
      });

      const result = await seedCorpusItem(
        { runId: 'run-2', symbol: 'QQQ', date: '2026-01-02', attempt: 1, forceRefetch: true },
        deps,
      );

      expect(result.status).toBe('stored');
      // The original object is kept — still-suspect data doesn't churn storage;
      // the confirmed mark stops the reconcile -> re-seed loop.
      expect(deps.gcs.markChainConfirmed).toHaveBeenCalledWith('QQQ', '2026-01-02', 'calls_only');
      expect(deps.gcs.deleteItem).not.toHaveBeenCalled();
      expect(deps.gcs.writeItem).not.toHaveBeenCalled();
      expect(deps.metadata.setItemSuccess).toHaveBeenCalledWith(
        'run-2', 'QQQ_2026-01-02',
        expect.objectContaining({
          sha256: 'old-sha',
          chain: expect.objectContaining({ flag: 'calls_only' }),
          chainFlagConfirmed: true,
        }),
      );
      expect(deps.logger).toHaveBeenCalledWith(
        'seed.chain-confirmed',
        expect.objectContaining({ flag: 'calls_only' }),
      );
    });

    it('short-circuits a forceRefetch on an upstream-confirmed object — no AV call', async () => {
      const deps = createDependencies({
        retrieval: { fetch: jest.fn() } as any,
        gcs: {
          getMetadata: jest.fn().mockResolvedValue({ ...suspectStored, chainFlagConfirmed: true }),
          getObjectPath: jest.fn().mockReturnValue(suspectStored.gcsPath),
        } as any,
      });

      const result = await seedCorpusItem(
        { runId: 'run-3', symbol: 'QQQ', date: '2026-01-02', attempt: 1, forceRefetch: true },
        deps,
      );

      // A stray/duplicate forceRefetch on a confirmed-thin chain resolves as
      // a cheap gcs-hit — confirmed chains are never refetched.
      expect(result).toEqual({ status: 'skipped', reason: 'gcs-hit' });
      expect(deps.retrieval.fetch).not.toHaveBeenCalled();
    });

    it('propagates forceRefetch on the retry re-enqueue', async () => {
      const deps = createDependencies({
        retrieval: {
          fetch: jest.fn().mockRejectedValue(
            new AlphaVantageUpstreamError(AlphaVantageUpstreamErrorCategory.TIMEOUT),
          ),
        } as any,
      });

      await seedCorpusItem(
        { runId: 'run-1', symbol: 'QQQ', date: '2026-01-02', attempt: 1, forceRefetch: true },
        deps,
      );

      expect(deps.enqueueTask).toHaveBeenCalledWith(
        expect.objectContaining({ attempt: 2, forceRefetch: true }),
      );
    });
  });

  it('preserves kind on the retry re-enqueue (Task #154 — unstamped interims would escape supersede)', async () => {
    const deps = createDependencies({
      retrieval: {
        fetch: jest.fn().mockRejectedValue(
          new AlphaVantageUpstreamError(AlphaVantageUpstreamErrorCategory.RATE_LIMITED),
        ),
      } as any,
    });
    const result = await seedCorpusItem(
      { runId: 'run-1', symbol: 'QQQ', date: '2026-01-02', attempt: 1, kind: 'interim' },
      deps,
    );
    expect(result.status).toBe('retry_enqueued');
    expect(deps.enqueueTask).toHaveBeenCalledWith(
      { runId: 'run-1', symbol: 'QQQ', date: '2026-01-02', attempt: 2, kind: 'interim' },
    );
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
