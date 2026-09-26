/**
 * Task #153: pivot-seed fanout. On the enabling transition (and after each
 * successful swing-set generation), plans the symbol's corpus work items
 * from its swing-set doc, creates a corpus run, and dispatches one Stage-1
 * seed task per pivot date.
 */
import type { SwingSetDoc } from '@shared/zigzag';
import { CORPUS_ZIGZAG_CONFIG, deriveParamsId } from '@shared/zigzag';
import {
  fanoutPivotSeeds,
  type PivotSeedFanoutDeps,
} from '../../../src/v2/historical-options-corpus/services/pivot-seed-fanout';
import type { CorpusSeedPayload } from '../../../src/v2/historical-options-corpus/types';

const CORPUS_ID = deriveParamsId(CORPUS_ZIGZAG_CONFIG);

function swingDoc(pivotDates: string[], currentExtremeDate: string | null = null): SwingSetDoc {
  return {
    symbol: 'AAPL',
    paramsId: CORPUS_ID,
    config: CORPUS_ZIGZAG_CONFIG,
    pivotDates,
    currentExtremeDate,
    currentDirection: null,
    generatedAt: {} as any,
    source: 'sa',
  };
}

function makeDeps(docs: SwingSetDoc[]) {
  const plans: unknown[] = [];
  const statuses: [string, string][] = [];
  const tasks: CorpusSeedPayload[] = [];
  const deps: PivotSeedFanoutDeps = {
    planner: { listSwingSetDocs: jest.fn().mockResolvedValue(docs) },
    createRunPlan: jest.fn(async (p) => { plans.push(p); }),
    markRunStatus: jest.fn(async (id, s) => { statuses.push([id, s]); }),
    enqueueTask: jest.fn(async (p) => { tasks.push(p); }),
    logger: { info: jest.fn(), warn: jest.fn() },
    nowMs: 1000,
  };
  return { deps, plans, statuses, tasks };
}

describe('fanoutPivotSeeds', () => {
  it('creates a run and enqueues one seed task per pivot work item', async () => {
    const { deps, plans, statuses, tasks } = makeDeps([
      swingDoc(['2026-01-05', '2026-02-03'], '2026-04-01'),
    ]);

    const result = await fanoutPivotSeeds('AAPL', deps);

    expect(result.runId).toBe('options_corpus_runs-AAPL-seed-1000');
    expect(result.planned).toBe(3);
    expect(result.enqueued).toBe(3);

    expect(plans).toHaveLength(1);
    expect(plans[0]).toMatchObject({
      runId: 'options_corpus_runs-AAPL-seed-1000',
      symbols: ['AAPL'],
      startDate: '2026-01-05',
      endDate: '2026-04-01',
      totalItems: 3,
      dryRun: false,
      pilot: false,
    });
    expect(tasks.map((t) => `${t.symbol}_${t.date}`)).toEqual([
      'AAPL_2026-01-05',
      'AAPL_2026-02-03',
      'AAPL_2026-04-01',
    ]);
    expect(tasks.every((t) => t.runId === result.runId && t.attempt === 1)).toBe(true);
    expect(statuses).toEqual([[result.runId, 'in_progress']]);
  });

  it('returns a no-op result when the symbol has no corpus doc', async () => {
    const { deps, plans, tasks, statuses } = makeDeps([]);
    const result = await fanoutPivotSeeds('NODOC', deps);
    expect(result).toEqual({ runId: null, planned: 0, enqueued: 0 });
    expect(plans).toHaveLength(0);
    expect(tasks).toHaveLength(0);
    expect(statuses).toHaveLength(0);
  });

  it('normalizes the symbol', async () => {
    const { deps } = makeDeps([]);
    await fanoutPivotSeeds('  aapl ', deps);
    expect(deps.planner.listSwingSetDocs).toHaveBeenCalledWith('AAPL');
  });
});
