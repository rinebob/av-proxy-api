/**
 * Unit tests for SwingSetRepository — Firestore read/write layer for
 * options-swing-sets docs (Task #124; slim shape post-#152).
 *
 * Verifies:
 * - upsert writes a full (non-merge) doc at options-swing-sets/{symbol}_{paramsId}
 * - get returns the doc or null
 * - listBySymbol queries by symbol field
 * - listConfirmedPivotDates returns the stored pivot-date array
 * - getCurrentSwing reads the stamped direction + extreme date
 */
import type { SwingSetDoc } from '@shared/zigzag';
import { deriveParamsId, CORPUS_ZIGZAG_CONFIG } from '@shared/zigzag';
import { createFakeFirestore } from '../fake-firestore';

function makeDoc(overrides: Partial<SwingSetDoc> = {}): SwingSetDoc {
  const config = CORPUS_ZIGZAG_CONFIG;
  return {
    symbol: 'AAPL',
    paramsId: deriveParamsId(config),
    config,
    pivotDates: ['2026-01-05', '2026-02-03'],
    currentExtremeDate: '2026-02-03',
    currentDirection: 'down',
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

  it('upsert writes the full doc (no merge) to options-swing-sets/{symbol}_{paramsId}', async () => {
    const { repo, fake } = makeRepo();
    const doc = makeDoc();
    await repo.upsert(doc);
    const setCall = fake.calls.find((c: { method: string }) => c.method === 'set');
    expect(setCall).toBeDefined();
    expect(setCall!.path).toBe(`options-swing-sets/AAPL_${doc.paramsId}`);
    // Non-merge set so regeneration wipes fields dropped by the slim shape.
    expect(setCall!.opts).toBeUndefined();
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
    const docB = makeDoc({ paramsId: 'other_params', config: { ...CORPUS_ZIGZAG_CONFIG, devThreshold: 5 } });
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

  it('listConfirmedPivotDates returns the stored pivot dates', async () => {
    const doc = makeDoc({ pivotDates: ['2026-01-05', '2026-02-03', '2026-03-04'] });
    const { repo } = makeRepo({ [`options-swing-sets/AAPL_${doc.paramsId}`]: doc });
    const dates = await repo.listConfirmedPivotDates('AAPL', doc.paramsId);
    expect(dates).toEqual(['2026-01-05', '2026-02-03', '2026-03-04']);
  });

  it('listConfirmedPivotDates returns empty for missing doc', async () => {
    const { repo } = makeRepo();
    expect(await repo.listConfirmedPivotDates('MSFT', 'dev5_L5_R5_1barY_projY')).toEqual([]);
  });

  it('getCurrentSwing returns the stamped direction and extreme date', async () => {
    const doc = makeDoc({ currentExtremeDate: '2026-04-01', currentDirection: 'up' });
    const { repo } = makeRepo({ [`options-swing-sets/AAPL_${doc.paramsId}`]: doc });
    const cur = await repo.getCurrentSwing('AAPL', doc.paramsId);
    expect(cur).toEqual({ direction: 'up', extremeDate: '2026-04-01' });
  });

  it('getCurrentSwing returns null for missing doc or null extremes', async () => {
    const { repo } = makeRepo();
    expect(await repo.getCurrentSwing('MSFT', 'dev5_L5_R5_1barY_projY')).toBeNull();
    const empty = makeDoc({ currentExtremeDate: null, currentDirection: null, pivotDates: [] });
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
