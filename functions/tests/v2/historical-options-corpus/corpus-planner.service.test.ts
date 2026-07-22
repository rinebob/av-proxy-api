import { planCorpusRun } from '../../../src/v2/historical-options-corpus/services/corpus-planner.service';
import { TradingCalendarService } from '../../../src/v2/historical-options-corpus/services/trading-calendar.service';

describe('planCorpusRun', () => {
  const calendar = new TradingCalendarService();

  it('plans the most recent N trading dates per symbol', async () => {
    const plan = await planCorpusRun({
      symbols: ['QQQ', 'TQQQ'],
      startDate: '2026-01-01',
      endDate: '2026-01-31',
      maxTradingDatesPerSymbol: 3,
      calendar,
    });

    expect(plan.symbols).toEqual(['QQQ', 'TQQQ']);
    expect(plan.totalItems).toBe(6);
    expect(plan.items.filter((i) => i.symbol === 'QQQ')).toHaveLength(3);
    expect(plan.items.filter((i) => i.symbol === 'TQQQ')).toHaveLength(3);
  });

  it('skips dates already present in the provided existing set', async () => {
    const plan = await planCorpusRun({
      symbols: ['QQQ'],
      startDate: '2026-01-01',
      endDate: '2026-01-10',
      existingItemKeys: new Set(['QQQ_2026-01-02']),
      calendar,
    });

    expect(plan.items.some((i) => i.date === '2026-01-02')).toBe(false);
  });

  it('returns an existing plan idempotently when metadata has the run', async () => {
    const metadata = {
      getRunDoc: jest.fn().mockResolvedValue({
        runId: 'existing-run',
        symbols: ['QQQ'],
        startDate: '2026-01-01',
        endDate: '2026-01-10',
        totalItems: 1,
        dryRun: false,
        pilot: false,
      }),
      listItems: jest.fn().mockResolvedValue([
        { id: 'QQQ_2026-01-02', data: { symbol: 'QQQ', date: '2026-01-02' } },
      ]),
    } as any;

    const plan = await planCorpusRun({
      symbols: ['QQQ', 'TQQQ'],
      startDate: '2026-01-01',
      endDate: '2026-01-10',
      runId: 'existing-run',
      metadata,
      calendar,
    });

    expect(plan.runId).toBe('existing-run');
    expect(plan.items).toEqual([{ symbol: 'QQQ', date: '2026-01-02' }]);
  });

  it('generates a runId that includes maxTradingDatesPerSymbol and dryRun', async () => {
    const plan = await planCorpusRun({
      symbols: ['QQQ'],
      startDate: '2026-01-01',
      endDate: '2026-01-10',
      maxTradingDatesPerSymbol: 3,
      dryRun: true,
      calendar,
    });

    expect(plan.runId).toContain('md3');
    expect(plan.runId).toContain('dry');
  });

  it('adds the pilot suffix to generated runIds', async () => {
    const plan = await planCorpusRun({
      symbols: ['QQQ'],
      startDate: '2026-01-01',
      endDate: '2026-01-10',
      pilot: true,
      calendar,
    });

    expect(plan.runId).toMatch(/-pilot$/);
  });
});
