// Unit tests for runCorpusReconcile (Task #220 — standing coverage
// reconciler). All deps are injected stubs: the diff logic is exercised
// against in-memory coverage listings, run-item lists, and expected-date
// lists — weekend/holiday edges arrive via the stubbed expected set.

import {
  runCorpusReconcile,
  type CorpusReconcileDeps,
} from '../../../src/v2/historical-options-corpus/services/corpus-reconcile.core';
import type { CoverageRunItem } from '../../../src/v2/historical-options-corpus/services/corpus-coverage.service';
import type { CorpusRunPlan } from '../../../src/v2/historical-options-corpus/services/corpus-metadata.service';
import type { PlanCorpusRunOptions } from '../../../src/v2/historical-options-corpus/services/corpus-planner.service';
import type { CorpusSeedPayload } from '../../../src/v2/historical-options-corpus/types';

const NOW_MS = Date.parse('2026-10-31T05:00:00Z');
const DAY_MS = 24 * 60 * 60 * 1000;

const WINDOW = { startDate: '2026-01-01', endDate: '2026-01-07' };
const TRADING_DATES = ['2026-01-02', '2026-01-05', '2026-01-06', '2026-01-07'];

interface DepOverrides {
  symbols?: string[];
  expected?: string[];
  objects?: Record<string, Array<string | { date: string; kind?: 'confirmed' | 'interim'; chainFlag?: 'empty' | 'calls_only' | 'puts_only'; chainFlagConfirmed?: boolean }>>;
  runItems?: Record<string, CoverageRunItem[]>;
  objectError?: Record<string, Error>;
}

function makeDeps(overrides: DepOverrides = {}) {
  const plans: CorpusRunPlan[] = [];
  const statuses: string[] = [];
  const summaries: Array<{ runId: string; perSymbol: unknown }> = [];
  const enqueued: CorpusSeedPayload[] = [];
  const logger = { info: jest.fn(), warn: jest.fn() };

  const deps: CorpusReconcileDeps = {
    listEnabledSymbols: jest.fn().mockResolvedValue(overrides.symbols ?? ['QQQ']),
    listExpectedDates: jest
      .fn()
      .mockImplementation(async () => overrides.expected ?? TRADING_DATES),
    listObjects: jest.fn().mockImplementation(async (symbol: string) => {
      const err = overrides.objectError?.[symbol];
      if (err) throw err;
      return (overrides.objects?.[symbol] ?? []).map((o) =>
        typeof o === 'string' ? { date: o } : o,
      );
    }),
    listRunItems: jest
      .fn()
      .mockImplementation(async (symbol: string) => overrides.runItems?.[symbol] ?? []),
    planRun: jest.fn().mockImplementation(async (opts: PlanCorpusRunOptions) => {
      const plan: CorpusRunPlan = {
        runId: opts.runId ?? 'run-x',
        symbols: opts.symbols,
        startDate: opts.startDate,
        endDate: opts.endDate,
        totalItems: opts.items?.length ?? 0,
        items: opts.items ?? [],
        dryRun: false,
        pilot: false,
      };
      plans.push(plan);
      return plan;
    }),
    markRunStatus: jest.fn().mockImplementation(async (_runId: string, status: string) => {
      statuses.push(status);
    }),
    updateRunSummary: jest.fn().mockImplementation(async (runId: string, perSymbol: unknown) => {
      summaries.push({ runId, perSymbol });
    }),
    enqueueSeed: jest.fn().mockImplementation(async (payload: CorpusSeedPayload) => {
      enqueued.push(payload);
    }),
    nowMs: () => NOW_MS,
    logger,
  };

  return { deps, plans, statuses, summaries, enqueued, logger };
}

const runItem = (
  date: string,
  status: CoverageRunItem['status'],
  touchedAtMs: number,
  runState?: CoverageRunItem['runState'],
): CoverageRunItem => ({ date, status, touchedAtMs, ...(runState ? { runState } : {}) });

describe('runCorpusReconcile', () => {
  it('enqueues uncovered expected dates and creates one run doc for the sweep', async () => {
    const { deps, plans, enqueued, statuses } = makeDeps({
      objects: { QQQ: ['2026-01-02', '2026-01-06'] },
    });

    const result = await runCorpusReconcile(deps, WINDOW);

    expect(deps.listEnabledSymbols).toHaveBeenCalledTimes(1);
    expect(plans).toHaveLength(1);
    expect(enqueued.map((e) => e.date)).toEqual(['2026-01-05', '2026-01-07']);
    expect(enqueued.every((e) => e.symbol === 'QQQ' && e.attempt === 1 && e.runId === result.runId)).toBe(true);
    expect(statuses).toContain('in_progress');
    expect(result.enqueued).toBe(2);
    expect(result.perSymbol.QQQ).toMatchObject({ planned: 4, present: 2, missing: 2, enqueued: 2 });
  });

  it('counts coverage only inside the expected window — stray objects are ignored', async () => {
    const { deps, enqueued } = makeDeps({
      // Saturday 2026-01-03 is a real stored object but never expected.
      objects: { QQQ: ['2026-01-02', '2026-01-03', '2026-01-05', '2026-01-06', '2026-01-07'] },
    });

    const result = await runCorpusReconcile(deps, WINDOW);

    expect(enqueued).toHaveLength(0);
    expect(result.perSymbol.QQQ).toMatchObject({ planned: 4, present: 4, missing: 0, enqueued: 0 });
  });

  it('suppresses gaps that already have a live queue entry', async () => {
    const { deps, plans, enqueued } = makeDeps({
      runItems: {
        QQQ: [runItem('2026-01-02', 'pending', NOW_MS - 60_000, 'in_progress')],
      },
    });

    const result = await runCorpusReconcile(deps, WINDOW);

    expect(enqueued.map((e) => e.date)).toEqual(['2026-01-05', '2026-01-06', '2026-01-07']);
    expect(result.suppressed).toBe(1);
    expect(result.perSymbol.QQQ.enqueued).toBe(3);
    // Suppressed dates are excluded from the plan items — no dead pending docs.
    const planKeys = plans[0].items.map((i) => `${i.symbol}_${i.date}`);
    expect(planKeys).not.toContain('QQQ_2026-01-02');
  });

  it('re-enqueues gaps whose queue entry is stale (>24h untouched)', async () => {
    const { deps, enqueued } = makeDeps({
      runItems: {
        QQQ: [runItem('2026-01-02', 'pending', NOW_MS - DAY_MS - 60_000, 'in_progress')],
      },
    });

    await runCorpusReconcile(deps, WINDOW);

    expect(enqueued.map((e) => e.date)).toContain('2026-01-02');
  });

  it('re-enqueues terminal failures and pending items from dead runs', async () => {
    const { deps, enqueued } = makeDeps({
      runItems: {
        QQQ: [
          runItem('2026-01-02', 'permanent_failure', NOW_MS - 60_000, 'completed'),
          runItem('2026-01-05', 'pending', NOW_MS - 60_000, 'completed'),
        ],
      },
    });

    await runCorpusReconcile(deps, WINDOW);

    expect(enqueued.map((e) => e.date)).toEqual(
      expect.arrayContaining(['2026-01-02', '2026-01-05']),
    );
  });

  it('uses latest-wins ordering when a date has items in multiple runs', async () => {
    const { deps, enqueued } = makeDeps({
      runItems: {
        QQQ: [
          runItem('2026-01-02', 'permanent_failure', NOW_MS - DAY_MS, 'completed'),
          runItem('2026-01-02', 'pending', NOW_MS - 60_000, 'in_progress'),
        ],
      },
    });

    const result = await runCorpusReconcile(deps, WINDOW);

    // Newest item is a live pending entry → suppressed, not re-enqueued.
    expect(enqueued.map((e) => e.date)).not.toContain('2026-01-02');
    expect(result.suppressed).toBe(1);
  });

  it('isolates per-symbol failures — one bad listing never aborts the sweep', async () => {
    const { deps, enqueued, logger } = makeDeps({
      symbols: ['QQQ', 'SNDK', 'AAPL'],
      objects: { QQQ: TRADING_DATES, AAPL: TRADING_DATES },
      objectError: { SNDK: new Error('gcs list failed') },
    });

    const result = await runCorpusReconcile(deps, WINDOW);

    expect(result.failed).toEqual(['SNDK']);
    expect(result.perSymbol.SNDK.error).toContain('gcs list failed');
    expect(enqueued).toHaveLength(0);
    expect(deps.enqueueSeed).not.toHaveBeenCalled();
    expect(logger.warn).toHaveBeenCalled();
  });

  it('writes a completed run doc with per-symbol counts even when nothing is missing', async () => {
    const { deps, plans, statuses, summaries, enqueued } = makeDeps({
      objects: { QQQ: TRADING_DATES },
    });

    const result = await runCorpusReconcile(deps, WINDOW);

    expect(plans).toHaveLength(1);
    expect(plans[0].items).toHaveLength(0);
    expect(statuses).toContain('completed');
    expect(enqueued).toHaveLength(0);
    // Covered symbols never trigger the per-symbol run-item scan.
    expect(deps.listRunItems).not.toHaveBeenCalled();
    expect(summaries[0].perSymbol).toMatchObject({
      QQQ: { planned: 4, present: 4, missing: 0, enqueued: 0 },
    });
    expect(result.enqueued).toBe(0);
  });

  it('marks the run in_progress when gaps are dispatched', async () => {
    const { deps, statuses } = makeDeps({});

    await runCorpusReconcile(deps, WINDOW);

    expect(statuses).toEqual(['in_progress']);
  });

  it('is idempotent across sweeps — a second run suppresses its own dispatched items', async () => {
    // First sweep enqueues everything; the run items it created read back as
    // pending+live on the second sweep.
    const first = makeDeps({});
    await runCorpusReconcile(first.deps, WINDOW);
    expect(first.enqueued).toHaveLength(4);

    const second = makeDeps({
      runItems: {
        QQQ: first.enqueued.map((e) =>
          runItem(e.date, 'pending', NOW_MS - 60_000, 'in_progress'),
        ),
      },
    });
    const result = await runCorpusReconcile(second.deps, WINDOW);

    expect(second.enqueued).toHaveLength(0);
    expect(result.suppressed).toBe(4);
  });

  describe('chain sanity flags (Task #227)', () => {
    it('re-seeds a flagged unconfirmed covered date with forceRefetch', async () => {
      const { deps, enqueued } = makeDeps({
        objects: {
          QQQ: TRADING_DATES.map((d) =>
            d === '2026-01-06' ? { date: d, chainFlag: 'calls_only' as const } : { date: d },
          ),
        },
      });

      const result = await runCorpusReconcile(deps, WINDOW);

      expect(enqueued).toHaveLength(1);
      expect(enqueued[0]).toMatchObject({
        symbol: 'QQQ', date: '2026-01-06', attempt: 1, forceRefetch: true,
      });
      expect(result.perSymbol.QQQ).toMatchObject({
        planned: 4, present: 4, missing: 0, enqueued: 1, flagged: 1,
      });
      expect(result.flagged).toBe(1);
    });

    it('does not count the suspect date as missing — it is gap-eligible, not absent', async () => {
      const { deps, enqueued } = makeDeps({
        objects: {
          QQQ: [
            '2026-01-02',
            '2026-01-05',
            { date: '2026-01-06', chainFlag: 'calls_only' as const },
            { date: '2026-01-07', chainFlag: 'calls_only' as const },
          ],
        },
      });

      const result = await runCorpusReconcile(deps, WINDOW);

      expect(enqueued.map((e) => e.date)).toEqual(['2026-01-06', '2026-01-07']);
      expect(result.totalGaps).toBe(0);
      expect(result.perSymbol.QQQ).toMatchObject({ present: 4, missing: 0, flagged: 2 });
    });

    it('suppresses a flagged date that already has a live queue entry', async () => {
      const { deps, enqueued } = makeDeps({
        objects: { QQQ: [{ date: '2026-01-02', chainFlag: 'puts_only' as const }, ...TRADING_DATES.slice(1)] },
        runItems: {
          QQQ: [runItem('2026-01-02', 'pending', NOW_MS - 60_000, 'in_progress')],
        },
      });

      const result = await runCorpusReconcile(deps, WINDOW);

      expect(enqueued).toHaveLength(0);
      expect(result.suppressed).toBe(1);
    });

    it('logs an upstream-confirmed thin chain instead of re-seeding it forever', async () => {
      const { deps, enqueued, logger } = makeDeps({
        objects: {
          QQQ: TRADING_DATES.map((d) =>
            d === '2026-01-05'
              ? { date: d, chainFlag: 'empty' as const, chainFlagConfirmed: true }
              : { date: d },
          ),
        },
      });

      const result = await runCorpusReconcile(deps, WINDOW);

      expect(enqueued).toHaveLength(0);
      expect(result.perSymbol.QQQ).toMatchObject({ present: 4, missing: 0, enqueued: 0, thinChains: 1 });
      expect(result.thinChains).toBe(1);
      expect(logger.info).toHaveBeenCalledWith(
        expect.stringContaining('thin-chain 2026-01-05 empty'),
      );
    });

    it('preserves the flagged object kind on the forceRefetch dispatch', async () => {
      const { deps, enqueued } = makeDeps({
        objects: {
          QQQ: TRADING_DATES.map((d) =>
            d === '2026-01-06'
              ? { date: d, kind: 'interim' as const, chainFlag: 'empty' as const }
              : { date: d },
          ),
        },
      });

      await runCorpusReconcile(deps, WINDOW);

      // The healed rewrite would otherwise stamp a kind-less object —
      // losing the interim stamp the pivot supersede sweep keys on.
      expect(enqueued[0]).toMatchObject({
        symbol: 'QQQ', date: '2026-01-06', forceRefetch: true, kind: 'interim',
      });
    });

    it('ignores flagged objects outside the expected window', async () => {
      const { deps, enqueued } = makeDeps({
        objects: {
          QQQ: [...TRADING_DATES, { date: '2026-01-03', chainFlag: 'calls_only' as const }],
        },
      });

      const result = await runCorpusReconcile(deps, WINDOW);

      expect(enqueued).toHaveLength(0);
      expect(result.flagged).toBe(0);
      expect(result.perSymbol.QQQ).toMatchObject({ present: 4, missing: 0 });
    });
  });

  it('still writes the run doc when the enabled set is empty', async () => {
    const { deps, plans, statuses } = makeDeps({ symbols: [] });

    const result = await runCorpusReconcile(deps, WINDOW);

    expect(plans).toHaveLength(1);
    expect(plans[0].items).toHaveLength(0);
    expect(statuses).toContain('completed');
    expect(result.enqueued).toBe(0);
  });
});
