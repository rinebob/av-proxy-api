import { HISTORICAL_OPTIONS_NIGHTLY_SCHEDULE } from '../../../src/v2/common/function-schedules';
import { NightlyCorpusService } from '../../../src/v2/historical-options-corpus/services/nightly-corpus.service';

function createService(overrides: any = {}) {
  const metadata = {
    getItemDoc: jest.fn().mockResolvedValue(undefined),
    setItemSuccess: jest.fn().mockResolvedValue(undefined),
    incrementCompleted: jest.fn().mockResolvedValue(undefined),
    markRunStatus: jest.fn().mockResolvedValue(undefined),
    ...overrides.metadata,
  };
  const gcs = {
    getMetadata: jest.fn().mockResolvedValue(undefined),
    ...overrides.gcs,
  };
  const planRun = jest.fn().mockResolvedValue({
    runId: 'nightly-run',
    symbols: ['QQQ', 'TQQQ'],
    startDate: '2026-07-21',
    endDate: '2026-07-21',
    totalItems: 2,
    items: [
      { symbol: 'QQQ', date: '2026-07-21' },
      { symbol: 'TQQQ', date: '2026-07-21' },
    ],
    dryRun: false,
    pilot: false,
  });
  const enqueueTask = jest.fn().mockResolvedValue(undefined);
  const calendar = {
    isTradingDay: jest.fn().mockReturnValue(true),
    ...overrides.calendar,
  };

  return {
    service: new NightlyCorpusService({
      calendar: calendar as any,
      metadata: metadata as any,
      gcs: gcs as any,
      planRun,
      enqueueTask,
      now: () => new Date('2026-07-22T02:00:00.000Z'),
    }),
    calendar,
    metadata,
    gcs,
    planRun,
    enqueueTask,
  };
}

describe('NightlyCorpusService', () => {
  it('uses the approved 7:00 PM Pacific weekday schedule', () => {
    expect(HISTORICAL_OPTIONS_NIGHTLY_SCHEDULE).toBe('0 19 * * 1-5');
  });

  it('enqueues both symbols for a trading day', async () => {
    const { service, planRun, enqueueTask, metadata } = createService();

    const report = await service.run();

    expect(planRun).toHaveBeenCalledWith(expect.objectContaining({
      symbols: ['QQQ', 'TQQQ'],
      startDate: '2026-07-21',
      endDate: '2026-07-21',
      pilot: false,
    }));
    expect(enqueueTask).toHaveBeenCalledTimes(2);
    expect(metadata.markRunStatus).toHaveBeenCalledWith('nightly-run', 'in_progress');
    expect(report).toMatchObject({
      targetDate: '2026-07-21',
      queuedItems: 2,
      skippedExistingItems: 0,
      skippedMarketClosed: false,
    });
  });

  it('skips closed-market dates without creating a run', async () => {
    const { service, calendar, planRun, enqueueTask } = createService({
      calendar: { isTradingDay: jest.fn().mockReturnValue(false) },
    });

    const report = await service.run();

    expect(calendar.isTradingDay).toHaveBeenCalledWith('2026-07-21');
    expect(planRun).not.toHaveBeenCalled();
    expect(enqueueTask).not.toHaveBeenCalled();
    expect(report).toEqual({
      targetDate: '2026-07-21',
      skippedMarketClosed: true,
      queuedItems: 0,
      skippedExistingItems: 0,
    });
  });

  it('does not enqueue an already-successful item', async () => {
    const { service, metadata, gcs, enqueueTask } = createService({
      metadata: {
        getItemDoc: jest.fn()
          .mockResolvedValueOnce({ status: 'success' })
          .mockResolvedValueOnce(undefined),
      },
      gcs: {
        getMetadata: jest.fn().mockResolvedValue({
          gcsPath: 'historical-options/v1/TQQQ/2026-07-21.json.gz',
          bytes: 100,
          sha256: 'sha',
          generation: '1',
          version: 'v1',
          schema: 'historical-options',
          symbol: 'TQQQ',
          date: '2026-07-21',
        }),
      },
    });

    const report = await service.run();

    expect(enqueueTask).not.toHaveBeenCalled();
    expect(gcs.getMetadata).toHaveBeenCalledTimes(1);
    expect(metadata.setItemSuccess).toHaveBeenCalledTimes(1);
    expect(metadata.incrementCompleted).toHaveBeenCalledWith('nightly-run', 0);
    expect(metadata.markRunStatus).toHaveBeenCalledWith('nightly-run', 'completed');
    expect(report).toMatchObject({ queuedItems: 0, skippedExistingItems: 2 });
  });
});
