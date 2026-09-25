/**
 * Task #150: the corpus pipeline must reject work for symbols whose
 * tracked-symbols doc lacks optionsEnabled === true. The gate is injected
 * into every ingestion entry point (seed worker, ts-build, nightly, pilot).
 */
import { createOptionsEnabledChecker } from '../../../src/v2/historical-options-corpus/services/options-enabled-gate';
import { NightlyCorpusService } from '../../../src/v2/historical-options-corpus/services/nightly-corpus.service';
import { HistoricalOptionsPilotService } from '../../../src/v2/historical-options-corpus/services/pilot.service';
import { seedCorpusItem } from '../../../src/v2/historical-options-corpus/services/corpus-seed.worker';
import { CorpusMetadataService } from '../../../src/v2/historical-options-corpus/services/corpus-metadata.service';
import { GcsCorpusAdapter } from '../../../src/v2/historical-options-corpus/services/gcs-corpus-adapter.service';
import { HistoricalOptionsRetrievalService } from '../../../src/v2/historical-options-corpus/services/historical-options-retrieval.service';
import type { SeedWorkerDependencies } from '../../../src/v2/historical-options-corpus/services/corpus-seed.worker';

const docReader = (docs: Record<string, any>) => (symbol: string) =>
  Promise.resolve(docs[symbol.toUpperCase()]);

describe('createOptionsEnabledChecker', () => {
  it('returns true only when optionsEnabled === true', async () => {
    const check = createOptionsEnabledChecker(docReader({ AAPL: { optionsEnabled: true } }));
    expect(await check('AAPL')).toBe(true);
  });

  it('returns false when the doc is missing', async () => {
    const check = createOptionsEnabledChecker(docReader({}));
    expect(await check('GONE')).toBe(false);
  });

  it.each([[{ optionsEnabled: false }], [{}]])(
    'returns false for %j',
    async (doc) => {
      const check = createOptionsEnabledChecker(docReader({ XYZ: doc }));
      expect(await check('XYZ')).toBe(false);
    },
  );

  it('normalizes the symbol to uppercase', async () => {
    const reader = jest.fn().mockResolvedValue({ optionsEnabled: true });
    const check = createOptionsEnabledChecker(reader);
    expect(await check('aapl')).toBe(true);
    expect(reader).toHaveBeenCalledWith('AAPL');
  });
});

describe('seedCorpusItem — optionsEnabled gate', () => {
  const deps = (isOptionsEnabled: (s: string) => Promise<boolean>): SeedWorkerDependencies => ({
    isOptionsEnabled,
    retrieval: { fetch: jest.fn() } as unknown as HistoricalOptionsRetrievalService,
    gcs: { getMetadata: jest.fn() } as unknown as GcsCorpusAdapter,
    metadata: {
      getItemDoc: jest.fn().mockResolvedValue(undefined),
      touchItem: jest.fn().mockResolvedValue(undefined),
      setItemSuccess: jest.fn().mockResolvedValue(undefined),
      setItemFailure: jest.fn().mockResolvedValue(undefined),
      incrementCompleted: jest.fn().mockResolvedValue(undefined),
      incrementFailed: jest.fn().mockResolvedValue(undefined),
    } as unknown as CorpusMetadataService,
    enqueueTask: jest.fn().mockResolvedValue(undefined),
    maxAttempts: 3,
    logger: jest.fn(),
  });

  it('skips a non-enabled symbol before any AV/GCS work', async () => {
    const d = deps(async () => false);
    const result = await seedCorpusItem({ runId: 'r', symbol: 'XYZ', date: '2026-01-02', attempt: 1 }, d);
    expect(result).toEqual({ status: 'skipped', reason: 'options-disabled' });
    expect(d.retrieval.fetch).not.toHaveBeenCalled();
    expect(d.gcs.getMetadata).not.toHaveBeenCalled();
    expect(d.metadata.getItemDoc).not.toHaveBeenCalled();
    // Terminal status so planned runs can't wedge with 'pending' items.
    expect(d.metadata.setItemFailure).toHaveBeenCalledWith('r', 'XYZ_2026-01-02', 'options-disabled', 'skipped');
    expect(d.metadata.incrementCompleted).toHaveBeenCalledWith('r', 0);
  });
});

describe('NightlyCorpusService — optionsEnabled gate', () => {
  it('plans with the live enabled set (no hardcoded symbols)', async () => {
    const planRun = jest.fn().mockResolvedValue({
      runId: 'r1',
      items: [],
      symbols: [],
      startDate: '2026-01-02',
      endDate: '2026-01-02',
      totalItems: 0,
    });
    const svc = new NightlyCorpusService({
      calendar: { isTradingDay: () => true },
      metadata: { markRunStatus: jest.fn() } as any,
      gcs: { getMetadata: jest.fn() } as any,
      planRun,
      enqueueTask: jest.fn(),
      listOptionsEnabledSymbols: async () => ['QQQ', 'AAPL'],
      now: () => new Date('2026-01-03T12:00:00Z'),
    });
    await svc.run();
    expect(planRun).toHaveBeenCalledWith(expect.objectContaining({ symbols: ['QQQ', 'AAPL'] }));
  });
});

describe('HistoricalOptionsPilotService — optionsEnabled gate', () => {
  it('drops non-enabled symbols and reports them', async () => {
    const svc = new HistoricalOptionsPilotService({
      metadata: {
        createRunPlan: jest.fn().mockResolvedValue(undefined),
        getRunDoc: jest.fn().mockResolvedValue(undefined),
        getItemDoc: jest.fn().mockResolvedValue(undefined),
        markRunStatus: jest.fn().mockResolvedValue(undefined),
        listItems: jest.fn().mockResolvedValue([]),
      } as any,
      gcs: { getMetadata: jest.fn().mockResolvedValue(undefined) } as any,
      calendar: { isTradingDay: () => true, getTradingDates: () => ['2026-01-02'] } as any,
      enqueueTask: jest.fn(),
      listOptionsEnabledSymbols: async () => ['QQQ'],
      now: () => new Date('2026-01-03T12:00:00Z'),
    });
    const report = await svc.run({
      symbols: ['QQQ', 'BOGUS'],
      startDate: '2026-01-02',
      endDate: '2026-01-02',
      dryRun: true,
    });
    expect(report.symbols).toEqual(['QQQ']);
    expect(report.skippedSymbols).toEqual(['BOGUS']);
  });
});
