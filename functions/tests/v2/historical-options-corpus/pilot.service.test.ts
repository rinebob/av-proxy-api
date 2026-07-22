import {
  DEFAULT_PILOT_MAX_TRADING_DATES,
  DEFAULT_PILOT_SYMBOLS,
  HistoricalOptionsPilotService,
} from '../../../src/v2/historical-options-corpus/services/pilot.service';

function createPilotService(overrides: any = {}) {
  const items = new Map<string, any>();
  const metadata = {
    createRunPlan: jest.fn().mockResolvedValue(undefined),
    getRunDoc: jest.fn().mockResolvedValue(undefined),
    getItemDoc: jest.fn().mockResolvedValue(undefined),
    markRunStatus: jest.fn().mockResolvedValue(undefined),
    listItems: jest.fn().mockResolvedValue([]),
    ...overrides.metadata,
  };

  const gcs = {
    getMetadata: jest.fn().mockImplementation((symbol: string, date: string) => {
      return Promise.resolve(items.has(`${symbol}:${date}`) ? items.get(`${symbol}:${date}`) : undefined);
    }),
    ...overrides.gcs,
  };

  const enqueueTask = jest.fn();

  const service = new HistoricalOptionsPilotService({
    metadata: metadata as any,
    gcs: gcs as any,
    calendar: new (require('../../../src/v2/historical-options-corpus/services/trading-calendar.service').TradingCalendarService)(),
    enqueueTask,
    ...(overrides.now ? { now: overrides.now } : {}),
  });

  return {
    service,
    metadata,
    gcs,
    enqueueTask,
    items,
  };
}

describe('HistoricalOptionsPilotService', () => {
  it('plans a bounded dry-run pilot and reports missing coverage', async () => {
    const { service, enqueueTask } = createPilotService();

    const report = await service.run();

    expect(report.symbols).toEqual([...DEFAULT_PILOT_SYMBOLS]);
    expect(report.totalItems).toBe(DEFAULT_PILOT_MAX_TRADING_DATES * DEFAULT_PILOT_SYMBOLS.length);
    expect(report.dryRun).toBe(true);
    expect(report.executed).toBe(false);
    expect(report.missingItems).toBe(report.totalItems);
    expect(report.presentItems).toBe(0);
    expect(enqueueTask).not.toHaveBeenCalled();
  });

  it('counts already-present GCS objects in the manifest', async () => {
    const { service, items } = createPilotService();
    items.set('QQQ:2026-01-05', {
      gcsPath: 'historical-options/v1/QQQ/2026-01-05.json.gz',
      bytes: 100,
      sha256: 'sha',
      generation: '1',
      version: 'v1',
      schema: 'historical-options',
      symbol: 'QQQ',
      date: '2026-01-05',
    });

    const report = await service.run({
      symbols: ['QQQ'],
      startDate: '2026-01-01',
      endDate: '2026-01-10',
      maxTradingDatesPerSymbol: 5,
      referenceDate: '2026-01-10',
    });

    expect(report.presentItems).toBeGreaterThanOrEqual(1);
    expect(report.manifest.some((m) => m.present)).toBe(true);
  });

  it('dispatches tasks when execute is true and dryRun is false', async () => {
    const { service, enqueueTask } = createPilotService();

    await service.run({
      symbols: ['QQQ'],
      startDate: '2026-01-01',
      endDate: '2026-01-10',
      maxTradingDatesPerSymbol: 2,
      referenceDate: '2026-01-10',
      dryRun: false,
      execute: true,
    });

    expect(enqueueTask).toHaveBeenCalledTimes(2);
    expect(enqueueTask).toHaveBeenCalledWith(
      expect.objectContaining({ runId: expect.any(String), symbol: 'QQQ', attempt: 1 }),
    );
  });

  it('refuses to execute a dry-run', async () => {
    const { service } = createPilotService();

    await expect(
      service.run({ dryRun: true, execute: true }),
    ).rejects.toThrow('Cannot execute a dry-run pilot');
  });

  it('defaults referenceDate to yesterday in America/New_York', async () => {
    // 2026-01-15T06:00:00Z is 01:00 ET on Jan 15; yesterday is Jan 14.
    const { service } = createPilotService({
      now: () => new Date('2026-01-15T06:00:00.000Z'),
    });

    const report = await service.run({
      symbols: ['QQQ'],
      startDate: '2026-01-01',
      maxTradingDatesPerSymbol: 1,
    });

    expect(report.endDate).toBe('2026-01-14');
  });

  it('runs without a retrieval dependency', async () => {
    const { service } = createPilotService();

    const report = await service.run({
      symbols: ['QQQ'],
      startDate: '2026-01-01',
      referenceDate: '2026-01-10',
      maxTradingDatesPerSymbol: 2,
    });

    expect(report.totalItems).toBe(2);
  });
});
