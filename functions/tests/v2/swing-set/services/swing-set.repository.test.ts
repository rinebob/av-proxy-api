/**
 * Unit tests for SwingSetRepository — Firestore read/write layer for
 * options-swing-sets docs (Task #124).
 *
 * Verifies:
 * - upsert writes to options-swing-sets/{symbol}_{paramsId} with merge
 * - get returns the doc or null
 * - listBySymbol queries by symbol field
 * - listConfirmedPivots returns only confirmed pivots
 * - getCurrentSwing derives developing-swing direction + extreme date
 */
import type { SwingSetDoc, Pivot } from '@shared/zigzag';
import { deriveParamsId, CANONICAL_ZIGZAG_CONFIGS } from '@shared/zigzag';
import type { DistributionSummary, Histogram, SwingStats } from '@shared/zigzag';
import { createFakeFirestore } from '../fake-firestore';

const emptySummary: DistributionSummary = {
  mean: 0, median: 0, stdDev: 0, min: 0, max: 0, p10: 0, p25: 0, p50: 0, p75: 0, p90: 0,
};
const emptyStats: SwingStats = {
  up: { count: 0, magnitudePercent: emptySummary, magnitudeAbsolute: emptySummary, duration: emptySummary, magnitudeHistogram: { bins: [] } as Histogram, durationHistogram: { bins: [] } as Histogram },
  down: { count: 0, magnitudePercent: emptySummary, magnitudeAbsolute: emptySummary, duration: emptySummary, magnitudeHistogram: { bins: [] } as Histogram, durationHistogram: { bins: [] } as Histogram },
};

function makePivot(overrides: Partial<Pivot> = {}): Pivot {
  return { barIndex: 0, time: 1_700_000_000_000, price: 100, isHigh: true, confirmed: true, ...overrides };
}

function makeDoc(overrides: Partial<SwingSetDoc> = {}): SwingSetDoc {
  const config = CANONICAL_ZIGZAG_CONFIGS[1];
  return {
    symbol: 'AAPL',
    paramsId: deriveParamsId(config),
    config,
    pivots: [makePivot(), makePivot({ barIndex: 5, price: 90, isHigh: false })],
    swings: [],
    stats: emptyStats,
    generatedAt: { seconds: 1_700_000_000, nanoseconds: 0 },
    source: 'sa',
    ...overrides,
  };
}

describe('SwingSetRepository', () => {
  function makeRepo(seed: Record<string, unknown> = {}) {
    const fake = createFakeFirestore(seed);
    const { SwingSetRepository } = require('../../../../src/v2/swing-set/services/swing-set.repository');
    return { repo: new SwingSetRepository(fake), fake };
  }

  it('upsert writes to options-swing-sets/{symbol}_{paramsId} with merge', async () => {
    const { repo, fake } = makeRepo();
    const doc = makeDoc();
    await repo.upsert(doc);
    const setCall = fake.calls.find((c: { method: string }) => c.method === 'set');
    expect(setCall).toBeDefined();
    expect(setCall!.path).toBe(`options-swing-sets/AAPL_${doc.paramsId}`);
    expect(setCall!.opts).toEqual({ merge: true });
    expect(fake.store.get(setCall!.path)).toMatchObject({ symbol: 'AAPL', source: 'sa' });
  });

  it('get returns the persisted doc', async () => {
    const doc = makeDoc();
    const { repo } = makeRepo({ [`options-swing-sets/AAPL_${doc.paramsId}`]: doc });
    const got = await repo.get('AAPL', doc.paramsId);
    expect(got).not.toBeNull();
    expect(got!.symbol).toBe('AAPL');
    expect(got!.paramsId).toBe(doc.paramsId);
  });

  it('get returns null when the doc does not exist', async () => {
    const { repo } = makeRepo();
    expect(await repo.get('MSFT', 'dev5_L5_R5_1barY_projY')).toBeNull();
  });

  it('listBySymbol returns all docs for the symbol', async () => {
    const docA = makeDoc();
    const docB = makeDoc({ paramsId: deriveParamsId(CANONICAL_ZIGZAG_CONFIGS[0]), config: CANONICAL_ZIGZAG_CONFIGS[0] });
    const other = makeDoc({ symbol: 'MSFT' });
    const { repo } = makeRepo({
      [`options-swing-sets/AAPL_${docA.paramsId}`]: docA,
      [`options-swing-sets/AAPL_${docB.paramsId}`]: docB,
      [`options-swing-sets/MSFT_${other.paramsId}`]: other,
    });
    const docs = await repo.listBySymbol('AAPL');
    expect(docs).toHaveLength(2);
    expect(docs.every((d: SwingSetDoc) => d.symbol === 'AAPL')).toBe(true);
  });

  it('listConfirmedPivots returns only confirmed pivots', async () => {
    const doc = makeDoc({
      pivots: [
        makePivot({ confirmed: true }),
        makePivot({ barIndex: 3, confirmed: true, isHigh: false }),
        makePivot({ barIndex: 7, confirmed: false }),
      ],
    });
    const { repo } = makeRepo({ [`options-swing-sets/AAPL_${doc.paramsId}`]: doc });
    const pivots = await repo.listConfirmedPivots('AAPL', doc.paramsId);
    expect(pivots).toHaveLength(2);
    expect(pivots.every((p: Pivot) => p.confirmed)).toBe(true);
  });

  it('listConfirmedPivots returns empty for missing doc', async () => {
    const { repo } = makeRepo();
    expect(await repo.listConfirmedPivots('MSFT', 'dev5_L5_R5_1barY_projY')).toEqual([]);
  });

  it('getCurrentSwing uses the projection extreme when present', async () => {
    // Last confirmed pivot is a low; projection is a high — developing 'up' swing
    const doc = makeDoc({
      pivots: [makePivot(), makePivot({ barIndex: 5, price: 90, isHigh: false })],
      projection: makePivot({ barIndex: 9, price: 120, isHigh: true, confirmed: false }),
    });
    const { repo } = makeRepo({ [`options-swing-sets/AAPL_${doc.paramsId}`]: doc });
    const cur = await repo.getCurrentSwing('AAPL', doc.paramsId);
    expect(cur).not.toBeNull();
    expect(cur!.direction).toBe('up');
    expect(cur!.extremeDate).toBe(new Date(1_700_000_000_000).toISOString().slice(0, 10));
  });

  it('getCurrentSwing uses the last confirmed pivot when no projection', async () => {
    // Last confirmed pivot is a high — developing 'down' swing from that extreme
    const doc = makeDoc({
      pivots: [makePivot({ isHigh: false }), makePivot({ barIndex: 5, isHigh: true })],
      projection: null,
    });
    const { repo } = makeRepo({ [`options-swing-sets/AAPL_${doc.paramsId}`]: doc });
    const cur = await repo.getCurrentSwing('AAPL', doc.paramsId);
    expect(cur!.direction).toBe('down');
    expect(cur!.extremeDate).toBe(new Date(1_700_000_000_000).toISOString().slice(0, 10));
  });

  it('getCurrentSwing returns null for missing doc or empty pivots', async () => {
    const { repo } = makeRepo();
    expect(await repo.getCurrentSwing('MSFT', 'dev5_L5_R5_1barY_projY')).toBeNull();
    const empty = makeDoc({ pivots: [] });
    const { repo: repo2 } = makeRepo({ [`options-swing-sets/AAPL_${empty.paramsId}`]: empty });
    expect(await repo2.getCurrentSwing('AAPL', empty.paramsId)).toBeNull();
  });

  it('upsert normalizes a lowercase symbol to uppercase', async () => {
    const { repo, fake } = makeRepo();
    const doc = makeDoc({ symbol: 'aapl' });
    await repo.upsert(doc);
    const stored = fake.store.get(`options-swing-sets/AAPL_${doc.paramsId}`) as SwingSetDoc;
    expect(stored.symbol).toBe('AAPL');
  });
});
