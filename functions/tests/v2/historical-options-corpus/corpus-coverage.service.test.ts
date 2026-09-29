/**
 * Task #156: corpus coverage report — read-only, computed-live surface.
 *
 * Diffs each symbol's pivot plan (planPivotSeeds) against stored corpus
 * objects (GcsCorpusAdapter.listItems) and folds in the latest
 * options_corpus_runs item status so an operator can see planned / seeded /
 * missing / failed per date without a persisted mirror doc.
 */
import {
  runCorpusCoverage,
  type CorpusCoverageDeps,
  type CoverageRunItem,
} from '../../../src/v2/historical-options-corpus/services/corpus-coverage.service';
import type { PivotWorkItem } from '../../../src/v2/historical-options-corpus/services/pivot-work-planner';
import type { GcsCorpusObjectRef } from '../../../src/v2/historical-options-corpus/services/gcs-corpus-adapter.service';

const pivot = (symbol: string, date: string, kind: 'confirmed' | 'interim'): PivotWorkItem => ({
  symbol,
  date,
  kind,
});

const obj = (date: string, kind?: 'confirmed' | 'interim'): GcsCorpusObjectRef => ({ date, kind });

const runItem = (
  date: string,
  status: CoverageRunItem['status'],
  touchedAtMs = 1,
  error?: string,
  runState?: CoverageRunItem['runState'],
): CoverageRunItem => ({ date, status, runState, touchedAtMs, error });

function makeDeps(overrides: Partial<CorpusCoverageDeps> = {}): CorpusCoverageDeps {
  return {
    listEnabledSymbols: jest.fn(async () => ['AAPL', 'XOM']),
    planPivots: jest.fn(async () => []),
    listObjects: jest.fn(async () => []),
    listRunItems: jest.fn(async () => []),
    // Fixed clock — fixture touchedAtMs values (< 24h old) stay "live".
    nowMs: () => 1_000,
    ...overrides,
  };
}

describe('runCorpusCoverage', () => {
  it('defaults to all enabled symbols when the request supplies none', async () => {
    const deps = makeDeps();
    const report = await runCorpusCoverage(undefined, deps);
    expect(report.symbols.map((s) => s.symbol)).toEqual(['AAPL', 'XOM']);
    expect(report.symbols.every((s) => s.optionsEnabled)).toBe(true);
    expect(deps.planPivots).toHaveBeenCalledWith('AAPL');
    expect(deps.planPivots).toHaveBeenCalledWith('XOM');
  });

  it('honors an explicit symbol subset and flags non-enabled symbols', async () => {
    const deps = makeDeps();
    const report = await runCorpusCoverage(['aapl', 'NOPE'], deps);
    expect(report.symbols.map((s) => s.symbol)).toEqual(['AAPL', 'NOPE']);
    expect(report.symbols[0].optionsEnabled).toBe(true);
    expect(report.symbols[1].optionsEnabled).toBe(false);
  });

  it('classifies covered dates as seeded and uncovered-with-no-attempt as missing', async () => {
    const deps = makeDeps({
      planPivots: jest.fn(async (s: string) =>
        s === 'AAPL' ? [pivot('AAPL', '2024-01-02', 'confirmed'), pivot('AAPL', '2024-02-01', 'confirmed')] : [],
      ),
      listObjects: jest.fn(async (s: string) => (s === 'AAPL' ? [obj('2024-01-02', 'confirmed')] : [])),
    });
    const report = await runCorpusCoverage(['AAPL'], deps);
    const row = report.symbols[0];
    expect(row.planned).toBe(2);
    expect(row.seeded).toBe(1);
    expect(row.missing).toBe(1);
    expect(row.failed).toBe(0);
    expect(row.dates).toEqual([
      { date: '2024-01-02', status: 'seeded', plannedKind: 'confirmed', objectKind: 'confirmed' },
      { date: '2024-02-01', status: 'missing', plannedKind: 'confirmed' },
    ]);
  });

  it('folds the latest run-item status: terminal failures surface as failed with the error', async () => {
    const deps = makeDeps({
      planPivots: jest.fn(async (s: string) =>
        s === 'AAPL'
          ? [pivot('AAPL', '2024-01-02', 'confirmed'), pivot('AAPL', '2024-02-01', 'confirmed'), pivot('AAPL', '2024-03-01', 'confirmed')]
          : [],
      ),
      listObjects: jest.fn(async () => []),
      listRunItems: jest.fn(async (s: string) =>
        s === 'AAPL'
          ? [
              runItem('2024-01-02', 'permanent_failure', 200, 'AV returned empty'),
              runItem('2024-02-01', 'failure', 100),
              runItem('2024-02-01', 'in_progress', 300), // newer attempt wins
              runItem('2024-03-01', 'pending', 50),
            ]
          : [],
      ),
    });
    const report = await runCorpusCoverage(['AAPL'], deps);
    const row = report.symbols[0];
    expect(row.planned).toBe(3);
    expect(row.seeded).toBe(0);
    expect(row.failed).toBe(1);
    expect(row.inFlight).toBe(2);
    expect(row.missing).toBe(0);
    expect(row.dates).toEqual([
      { date: '2024-01-02', status: 'failed', plannedKind: 'confirmed', runStatus: 'permanent_failure', error: 'AV returned empty' },
      { date: '2024-02-01', status: 'in_flight', plannedKind: 'confirmed', runStatus: 'in_progress' },
      { date: '2024-03-01', status: 'in_flight', plannedKind: 'confirmed', runStatus: 'pending' },
    ]);
  });

  it('marks stored objects absent from the plan as superseded_interim or unplanned', async () => {
    const deps = makeDeps({
      planPivots: jest.fn(async (s: string) =>
        s === 'AAPL' ? [pivot('AAPL', '2024-01-02', 'confirmed')] : [],
      ),
      listObjects: jest.fn(async (s: string) =>
        s === 'AAPL'
          ? [obj('2024-01-02', 'confirmed'), obj('2024-01-15', 'interim'), obj('2023-12-20')]
          : [],
      ),
    });
    const report = await runCorpusCoverage(['AAPL'], deps);
    const row = report.symbols[0];
    expect(row.seeded).toBe(1);
    expect(row.unplanned).toBe(2);
    expect(row.dates).toEqual([
      { date: '2023-12-20', status: 'unplanned' },
      { date: '2024-01-02', status: 'seeded', plannedKind: 'confirmed', objectKind: 'confirmed' },
      { date: '2024-01-15', status: 'superseded_interim', objectKind: 'interim' },
    ]);
  });

  it('surfaces the plan’s current interim date', async () => {
    const deps = makeDeps({
      planPivots: jest.fn(async (s: string) =>
        s === 'AAPL'
          ? [pivot('AAPL', '2024-01-02', 'confirmed'), pivot('AAPL', '2024-03-15', 'interim')]
          : [],
      ),
      listObjects: jest.fn(async (s: string) => (s === 'AAPL' ? [obj('2024-01-02', 'confirmed')] : [])),
    });
    const report = await runCorpusCoverage(['AAPL'], deps);
    expect(report.symbols[0].currentInterimDate).toBe('2024-03-15');
    expect(report.symbols[0].dates.find((d) => d.date === '2024-03-15')).toMatchObject({
      status: 'missing',
      plannedKind: 'interim',
    });
  });

  it('returns a null interim date when the plan has none', async () => {
    const deps = makeDeps({
      planPivots: jest.fn(async () => [pivot('AAPL', '2024-01-02', 'confirmed')]),
    });
    const report = await runCorpusCoverage(['AAPL'], deps);
    expect(report.symbols[0].currentInterimDate).toBeNull();
  });

  it('reports a stale success whose object was deleted as missing, not in_flight', async () => {
    const deps = makeDeps({
      planPivots: jest.fn(async (s: string) =>
        s === 'AAPL' ? [pivot('AAPL', '2024-01-02', 'confirmed')] : [],
      ),
      listObjects: jest.fn(async () => []), // object swept after the success
      listRunItems: jest.fn(async (s: string) =>
        s === 'AAPL' ? [runItem('2024-01-02', 'success', 500)] : [],
      ),
    });
    const report = await runCorpusCoverage(['AAPL'], deps);
    const row = report.symbols[0];
    expect(row.missing).toBe(1);
    expect(row.inFlight).toBe(0);
    expect(row.dates[0]).toEqual({
      date: '2024-01-02', status: 'missing', plannedKind: 'confirmed', runStatus: 'success',
    });
  });

  it('a pending retry newer than a failure reports in_flight, not failed', async () => {
    const deps = makeDeps({
      planPivots: jest.fn(async (s: string) =>
        s === 'AAPL' ? [pivot('AAPL', '2024-01-02', 'confirmed')] : [],
      ),
      listObjects: jest.fn(async () => []),
      // Older failure (touched=100), newer pending queued by a later run —
      // pending carries the run's createdAt as its ordering key upstream.
      listRunItems: jest.fn(async (s: string) =>
        s === 'AAPL'
          ? [runItem('2024-01-02', 'failure', 100, 'boom'), runItem('2024-01-02', 'pending', 300)]
          : [],
      ),
    });
    const report = await runCorpusCoverage(['AAPL'], deps);
    expect(report.symbols[0].dates[0]).toMatchObject({ status: 'in_flight', runStatus: 'pending' });
    expect(report.symbols[0].failed).toBe(0);
  });

  it('reports a covered date as seeded even when the latest run item is a stale failure', async () => {
    const deps = makeDeps({
      planPivots: jest.fn(async (s: string) =>
        s === 'AAPL' ? [pivot('AAPL', '2024-01-02', 'confirmed')] : [],
      ),
      listObjects: jest.fn(async (s: string) =>
        s === 'AAPL' ? [obj('2024-01-02', 'confirmed')] : [],
      ),
      // Failure recorded in an earlier run, but a later run landed the object.
      listRunItems: jest.fn(async (s: string) =>
        s === 'AAPL' ? [runItem('2024-01-02', 'failure', 100, 'boom')] : [],
      ),
    });
    const report = await runCorpusCoverage(['AAPL'], deps);
    const row = report.symbols[0];
    expect(row.dates[0].status).toBe('seeded');
    expect(row.seeded).toBe(1);
    expect(row.failed).toBe(0);
  });

  it('downgrades a pending item in a dead run to missing — nothing is queued', async () => {
    const deps = makeDeps({
      planPivots: jest.fn(async (s: string) =>
        s === 'AAPL' ? [pivot('AAPL', '2024-01-02', 'confirmed')] : [],
      ),
      listObjects: jest.fn(async () => []),
      // Run doc went terminal; its pending item is a leftover, not live work.
      listRunItems: jest.fn(async (s: string) =>
        s === 'AAPL' ? [runItem('2024-01-02', 'pending', 300, undefined, 'completed')] : [],
      ),
    });
    const report = await runCorpusCoverage(['AAPL'], deps);
    const row = report.symbols[0];
    expect(row.dates[0]).toMatchObject({
      status: 'missing', runStatus: 'pending', runState: 'completed',
    });
    expect(row.inFlight).toBe(0);
    expect(row.missing).toBe(1);
  });

  it('downgrades a stale pending item in a never-finalized run to missing', async () => {
    const deps = makeDeps({
      // Runs are never reconciled to a terminal state — a queue entry
      // untouched for >24h is dead even while the run reads 'in_progress'.
      nowMs: () => 100 * 24 * 60 * 60 * 1000,
      planPivots: jest.fn(async (s: string) =>
        s === 'AAPL' ? [pivot('AAPL', '2024-01-02', 'confirmed')] : [],
      ),
      listObjects: jest.fn(async () => []),
      listRunItems: jest.fn(async (s: string) =>
        s === 'AAPL' ? [runItem('2024-01-02', 'pending', 300, undefined, 'in_progress')] : [],
      ),
    });
    const report = await runCorpusCoverage(['AAPL'], deps);
    expect(report.symbols[0].dates[0]).toMatchObject({
      status: 'missing', runStatus: 'pending', runState: 'in_progress',
    });
    expect(report.symbols[0].inFlight).toBe(0);
  });

  it('reports a skipped curation drop as missing, not failed', async () => {
    const deps = makeDeps({
      planPivots: jest.fn(async (s: string) =>
        s === 'AAPL' ? [pivot('AAPL', '2024-01-02', 'confirmed')] : [],
      ),
      listObjects: jest.fn(async () => []),
      listRunItems: jest.fn(async (s: string) =>
        s === 'AAPL' ? [runItem('2024-01-02', 'skipped', 100)] : [],
      ),
    });
    const report = await runCorpusCoverage(['AAPL'], deps);
    expect(report.symbols[0].dates[0]).toMatchObject({ status: 'missing', runStatus: 'skipped' });
    expect(report.symbols[0].failed).toBe(0);
  });

  it('flags stored objects below the corpus floor as pre_floor', async () => {
    const deps = makeDeps({
      planPivots: jest.fn(async (s: string) =>
        s === 'AAPL' ? [pivot('AAPL', '2024-01-02', 'confirmed')] : [],
      ),
      listObjects: jest.fn(async (s: string) =>
        s === 'AAPL' ? [obj('2018-06-01', 'confirmed'), obj('2015-03-10')] : [],
      ),
    });
    const report = await runCorpusCoverage(['AAPL'], deps);
    const row = report.symbols[0];
    expect(row.dates[0].status).toBe('pre_floor');
    expect(row.dates[1].status).toBe('pre_floor');
    expect(row.unplanned).toBe(2); // pre_floor counts under unplanned objects
  });

  it('isolates per-symbol failures — one bad symbol does not abort the report', async () => {
    const deps = makeDeps({
      planPivots: jest.fn(async (s: string) => {
        if (s === 'AAPL') throw new Error('swing doc read blew up');
        return [pivot(s, '2024-01-02', 'confirmed')];
      }),
      listObjects: jest.fn(async (s: string) => [obj('2024-01-02', 'confirmed')]),
    });
    const report = await runCorpusCoverage(['AAPL', 'XOM'], deps);
    expect(report.symbols[0].error).toBe('swing doc read blew up');
    expect(report.symbols[0].planned).toBe(0);
    expect(report.symbols[1].error).toBeUndefined();
    expect(report.symbols[1].seeded).toBe(1);
  });

  it('reports an empty planned set (no corpus swing doc) without failing', async () => {
    const deps = makeDeps();
    const report = await runCorpusCoverage(['AAPL'], deps);
    const row = report.symbols[0];
    expect(row.planned).toBe(0);
    expect(row.seeded).toBe(0);
    expect(row.dates).toEqual([]);
    expect(row.currentInterimDate).toBeNull();
  });
});
