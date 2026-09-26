import {
  DEFAULT_PILOT_MAX_TRADING_DATES,
  HistoricalOptionsPilotService,
} from '../../../src/v2/historical-options-corpus/services/pilot.service';

// Task #150 removed DEFAULT_PILOT_SYMBOLS — tests simulate the enabled set.
const DEFAULT_PILOT_SYMBOLS_FOR_TEST = ['QQQ', 'TQQQ'];

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
    listOptionsEnabledSymbols: overrides.listOptionsEnabledSymbols ?? jest.fn().mockResolvedValue([...DEFAULT_PILOT_SYMBOLS_FOR_TEST]),
    metadata: metadata as any,
    gcs: gcs as any,
    calendar: new (require('../../../src/v2/historical-options-corpus/services/trading-calendar.service').TradingCalendarService)(),
    enqueueTask,
    ...(overrides.planPivots ? { planPivots: overrides.planPivots } : {}),
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

    const report = await service.run({ referenceDate: '2019-01-30' });

    expect(report.symbols).toEqual([...DEFAULT_PILOT_SYMBOLS_FOR_TEST]);
    expect(report.totalItems).toBe(DEFAULT_PILOT_MAX_TRADING_DATES * DEFAULT_PILOT_SYMBOLS_FOR_TEST.length);
    expect(report.manifest[0]).toMatchObject({ symbol: 'QQQ', date: '2019-01-02' });
    expect(report.manifest[DEFAULT_PILOT_MAX_TRADING_DATES - 1]).toMatchObject({
      symbol: 'QQQ',
      date: '2019-01-30',
    });
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

  describe('dateSource: pivots (Task #155 backfill)', () => {
    const pivotItems: Record<string, { symbol: string; date: string; kind: 'confirmed' | 'interim' }[]> = {
      QQQ: [
        { symbol: 'QQQ', date: '2026-01-05', kind: 'confirmed' },
        { symbol: 'QQQ', date: '2026-02-03', kind: 'confirmed' },
        { symbol: 'QQQ', date: '2026-04-01', kind: 'interim' },
      ],
      TQQQ: [{ symbol: 'TQQQ', date: '2026-01-07', kind: 'confirmed' }],
    };
    const planPivots = jest.fn(async (s: string) => pivotItems[s] ?? []);

    it('plans per-symbol pivot dates, reports counts, and writes nothing in dryRun', async () => {
      const { service, metadata, enqueueTask } = createPilotService({ planPivots });
      const report = await service.run({ dateSource: 'pivots' });

      expect(report.dateSource).toBe('pivots');
      expect(report.totalItems).toBe(4);
      expect(report.missingItems).toBe(4);
      expect(report.perSymbol).toEqual([
        { symbol: 'QQQ', planned: 3, present: 0, missing: 3, enqueued: 0 },
        { symbol: 'TQQQ', planned: 1, present: 0, missing: 1, enqueued: 0 },
      ]);
      expect(metadata.createRunPlan).not.toHaveBeenCalled();
      expect(enqueueTask).not.toHaveBeenCalled();
    });

    it('execute dispatches seed tasks for missing items with pivot kind', async () => {
      const { service, items, metadata, enqueueTask } = createPilotService({ planPivots });
      items.set('QQQ:2026-01-05', { gcsPath: 'x', bytes: 1, sha256: 's', generation: '1' });

      const report = await service.run({ dateSource: 'pivots', dryRun: false, execute: true });

      expect(report.missingItems).toBe(3);
      expect(report.perSymbol.find((p: any) => p.symbol === 'QQQ')).toMatchObject(
        { planned: 3, present: 1, missing: 2, enqueued: 2 },
      );
      expect(enqueueTask).toHaveBeenCalledTimes(3);
      expect(enqueueTask).toHaveBeenCalledWith(
        expect.objectContaining({ symbol: 'QQQ', date: '2026-02-03', kind: 'confirmed', attempt: 1 }),
      );
      expect(enqueueTask).toHaveBeenCalledWith(
        expect.objectContaining({ symbol: 'QQQ', date: '2026-04-01', kind: 'interim' }),
      );
      expect(enqueueTask).toHaveBeenCalledWith(
        expect.objectContaining({ symbol: 'TQQQ', date: '2026-01-07', kind: 'confirmed' }),
      );
      expect(metadata.createRunPlan).toHaveBeenCalledWith(
        expect.objectContaining({ totalItems: 4, symbols: ['QQQ', 'TQQQ'] }),
      );
      expect(metadata.markRunStatus).toHaveBeenCalledWith(report.runId, 'in_progress');
    });

    it('marks the run completed (not in_progress) when every date is already covered', async () => {
      const { service, items, metadata, enqueueTask } = createPilotService({ planPivots });
      for (const item of [...pivotItems.QQQ, ...pivotItems.TQQQ]) {
        items.set(`${item.symbol}:${item.date}`, { gcsPath: 'x', bytes: 1, sha256: 's', generation: '1' });
      }
      const report = await service.run({ dateSource: 'pivots', dryRun: false, execute: true });
      expect(report.missingItems).toBe(0);
      expect(enqueueTask).not.toHaveBeenCalled();
      expect(metadata.markRunStatus).toHaveBeenCalledWith(report.runId, 'completed');
    });

    it('marks the run in_progress before dispatch so a mid-dispatch failure is not orphaned', async () => {
      const { service, metadata, enqueueTask } = createPilotService({ planPivots });
      enqueueTask.mockRejectedValueOnce(new Error('tasks API down'));
      const callOrder: string[] = [];
      (metadata.markRunStatus as jest.Mock).mockImplementation((id, s) => { callOrder.push(`status:${s}`); return Promise.resolve(); });
      enqueueTask.mockImplementation(() => { callOrder.push('enqueue'); return Promise.reject(new Error('tasks API down')); });

      await expect(
        service.run({ dateSource: 'pivots', dryRun: false, execute: true }),
      ).rejects.toThrow('tasks API down');
      expect(callOrder[0]).toBe('status:in_progress');
      expect(callOrder).toContain('enqueue');
    });

    it('isolates per-symbol planner failures in the report', async () => {
      const failing = jest.fn(async (s: string) => {
        if (s === 'QQQ') throw new Error('firestore down');
        return pivotItems[s] ?? [];
      });
      const { service } = createPilotService({ planPivots: failing });
      const report = await service.run({ dateSource: 'pivots' });

      const qqq = report.perSymbol.find((p: any) => p.symbol === 'QQQ');
      expect(qqq?.error).toBe('firestore down');
      const tqqq = report.perSymbol.find((p: any) => p.symbol === 'TQQQ');
      expect(tqqq?.missing).toBe(1);
      expect(report.totalItems).toBe(1);
    });

    it('rejects pivots mode without a planPivots dependency', async () => {
      const { service } = createPilotService();
      await expect(service.run({ dateSource: 'pivots' })).rejects.toThrow('planPivots');
    });
  });
});
