/**
 * Tasks #153/#154: pivot-seed fanout + corpus reconcile. Plans the symbol's
 * corpus work items from its swing-set doc, seeds only missing dates
 * (GCS-coverage-aware), and deletes superseded interim snapshots when the
 * swing doc's current extreme moves on.
 */
import type { SwingSetDoc } from '@shared/zigzag';
import { CORPUS_ZIGZAG_CONFIG, deriveParamsId } from '@shared/zigzag';
import {
  fanoutPivotSeeds,
  type PivotSeedFanoutDeps,
} from '../../../src/v2/historical-options-corpus/services/pivot-seed-fanout';
import type { CorpusSeedPayload } from '../../../src/v2/historical-options-corpus/types';
import type { GcsCorpusObjectRef } from '../../../src/v2/historical-options-corpus/services/gcs-corpus-adapter.service';

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

function makeDeps(docs: SwingSetDoc[], objects: GcsCorpusObjectRef[] = []) {
  const plans: any[] = [];
  const statuses: [string, string][] = [];
  const tasks: CorpusSeedPayload[] = [];
  const deleted: string[] = [];
  const deps: PivotSeedFanoutDeps = {
    planner: { listSwingSetDocs: jest.fn().mockResolvedValue(docs) },
    listObjects: jest.fn(async () => objects),
    deleteObject: jest.fn(async (_s: string, d: string) => { deleted.push(d); }),
    createRunPlan: jest.fn(async (p) => { plans.push(p); }),
    markRunStatus: jest.fn(async (id, s) => { statuses.push([id, s]); }),
    enqueueTask: jest.fn(async (p) => { tasks.push(p); }),
    logger: { info: jest.fn(), warn: jest.fn() },
    nowMs: 1000,
  };
  return { deps, plans, statuses, tasks, deleted };
}

describe('fanoutPivotSeeds', () => {
  it('creates a run and enqueues one seed task per missing work item, with kind', async () => {
    const { deps, plans, statuses, tasks } = makeDeps([
      swingDoc(['2026-01-05', '2026-02-03'], '2026-04-01'),
    ]);

    const result = await fanoutPivotSeeds('AAPL', deps);

    expect(result.runId).toBe('options_corpus_runs-AAPL-seed-1000');
    expect(result.planned).toBe(3);
    expect(result.enqueued).toBe(3);
    expect(result.deleted).toBe(0);

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
    expect(tasks.map((t) => `${t.symbol}_${t.date}:${t.kind}`)).toEqual([
      'AAPL_2026-01-05:confirmed',
      'AAPL_2026-02-03:confirmed',
      'AAPL_2026-04-01:interim',
    ]);
    expect(tasks.every((t) => t.runId === result.runId && t.attempt === 1)).toBe(true);
    expect(statuses).toEqual([[result.runId, 'in_progress']]);
  });

  it('returns a no-op result when the symbol has no corpus doc', async () => {
    const { deps, plans, tasks, statuses } = makeDeps([]);
    const result = await fanoutPivotSeeds('NODOC', deps);
    expect(result).toMatchObject({ runId: null, planned: 0, enqueued: 0 });
    expect(plans).toHaveLength(0);
    expect(tasks).toHaveLength(0);
    expect(statuses).toHaveLength(0);
  });

  it('skips dates already covered in GCS (only missing items enqueued)', async () => {
    const { deps, tasks, plans } = makeDeps(
      [swingDoc(['2026-01-05', '2026-02-03'], '2026-04-01')],
      [
        { date: '2026-01-05', kind: 'confirmed' },
        { date: '2026-04-01', kind: 'interim' },
      ],
    );
    const result = await fanoutPivotSeeds('AAPL', deps);
    expect(result.enqueued).toBe(1);
    expect(tasks.map((t) => t.date)).toEqual(['2026-02-03']);
    expect(plans[0].totalItems).toBe(1);
  });

  it('no run is created when every planned date is already covered', async () => {
    const { deps, plans, tasks } = makeDeps(
      [swingDoc(['2026-01-05'])],
      [{ date: '2026-01-05', kind: 'confirmed' }],
    );
    const result = await fanoutPivotSeeds('AAPL', deps);
    expect(result).toMatchObject({ runId: null, planned: 1, enqueued: 0 });
    expect(plans).toHaveLength(0);
    expect(tasks).toHaveLength(0);
  });

  it('deletes superseded interim snapshots (kind=interim and date no longer planned)', async () => {
    const { deps, deleted } = makeDeps(
      // extreme advanced from 03-20 → 04-01; 03-20 is gone from the doc
      [swingDoc(['2026-01-05'], '2026-04-01')],
      [
        { date: '2026-01-05', kind: 'confirmed' },
        { date: '2026-03-20', kind: 'interim' }, // superseded
        { date: '2026-04-01', kind: 'interim' }, // still current extreme
      ],
    );
    const result = await fanoutPivotSeeds('AAPL', deps);
    expect(result.deleted).toBe(1);
    expect(deleted).toEqual(['2026-03-20']);
  });

  it('keeps superseded-date objects that are NOT interim-provenance (nightly/calendar items)', async () => {
    const { deps, deleted } = makeDeps(
      [swingDoc(['2026-01-05'])],
      [{ date: '2019-06-14', kind: undefined }, { date: '2026-01-05', kind: 'confirmed' }],
    );
    await fanoutPivotSeeds('AAPL', deps);
    expect(deleted).toEqual([]);
  });

  it('keeps an interim object whose date was promoted into pivotDates (swing completed)', async () => {
    const { deps, deleted } = makeDeps(
      [swingDoc(['2026-03-20'], '2026-04-10')], // 03-20 confirmed
      [{ date: '2026-03-20', kind: 'interim' }],
    );
    await fanoutPivotSeeds('AAPL', deps);
    expect(deleted).toEqual([]);
  });

  it('warns-but-continues when an interim delete fails', async () => {
    const { deps, tasks } = makeDeps(
      [swingDoc(['2026-01-05'], '2026-04-01')],
      [{ date: '2026-03-20', kind: 'interim' }],
    );
    deps.deleteObject = jest.fn(async () => { throw new Error('gcs denied'); });
    const result = await fanoutPivotSeeds('AAPL', deps);
    expect(result.deleted).toBe(0);
    expect(result.enqueued).toBe(2); // 01-05 + 04-01 both missing; failed delete didn't block dispatch
    expect(tasks.map((t) => t.date)).toEqual(['2026-01-05', '2026-04-01']);
    expect(deps.logger.warn).toHaveBeenCalledWith(expect.stringContaining('interim delete failed'));
  });

  it('normalizes the symbol', async () => {
    const { deps } = makeDeps([swingDoc(['2026-01-05'])]);
    await fanoutPivotSeeds('  aapl ', deps);
    expect(deps.planner.listSwingSetDocs).toHaveBeenCalledWith('AAPL');
    expect(deps.listObjects).toHaveBeenCalledWith('AAPL');
  });
});
