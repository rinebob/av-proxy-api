/**
 * Task #151: swing-doc pivot planner. Given a symbol, reads its corpus
 * swing-set doc (pivotDates + currentExtremeDate) and emits the deduped
 * corpus work list: all confirmed pivot dates + the current
 * developing-swing extreme (interim).
 */
import {
  planPivotSeeds,
  type PivotWorkItem,
} from '../../../src/v2/historical-options-corpus/services/pivot-work-planner';
import { CORPUS_ZIGZAG_CONFIG, deriveParamsId } from '@shared/zigzag';
import type { SwingSetDoc } from '@shared/zigzag';

const CORPUS_ID = deriveParamsId(CORPUS_ZIGZAG_CONFIG);

function doc(over: Partial<SwingSetDoc> = {}): SwingSetDoc {
  return {
    symbol: 'AAPL',
    paramsId: CORPUS_ID,
    config: CORPUS_ZIGZAG_CONFIG,
    pivotDates: [],
    currentExtremeDate: null,
    currentDirection: null,
    generatedAt: {} as any,
    source: 'sa',
    ...over,
  };
}

const planner = (docs: SwingSetDoc[]) => ({
  listSwingSetDocs: jest.fn().mockResolvedValue(docs),
});

describe('planPivotSeeds', () => {
  it('emits confirmed pivot dates deduped and sorted', async () => {
    const docs = [
      doc({ pivotDates: ['2026-01-05', '2026-02-03', '2026-01-05'], currentExtremeDate: '2026-02-03' }),
    ];
    const items = await planPivotSeeds('AAPL', planner(docs));
    expect(items).toEqual([
      { symbol: 'AAPL', date: '2026-01-05', kind: 'confirmed' },
      { symbol: 'AAPL', date: '2026-02-03', kind: 'confirmed' },
    ] satisfies PivotWorkItem[]);
  });

  it('emits the projected extreme as an interim work item', async () => {
    const docs = [
      doc({
        pivotDates: ['2026-01-05'],
        currentExtremeDate: '2026-04-01',
        currentDirection: 'up',
      }),
    ];
    const items = await planPivotSeeds('AAPL', planner(docs));
    expect(items).toEqual([
      { symbol: 'AAPL', date: '2026-01-05', kind: 'confirmed' },
      { symbol: 'AAPL', date: '2026-04-01', kind: 'interim' },
    ] satisfies PivotWorkItem[]);
  });

  it('no projection → no interim item (current extreme is already a confirmed pivot)', async () => {
    const docs = [doc({ pivotDates: ['2026-01-05'], currentExtremeDate: '2026-01-05' })];
    const items = await planPivotSeeds('AAPL', planner(docs));
    expect(items.every((i) => i.kind === 'confirmed')).toBe(true);
  });

  it('items sort by date regardless of kind', async () => {
    const docs = [
      doc({ pivotDates: ['2026-03-04'], currentExtremeDate: '2026-01-05', currentDirection: 'down' }),
    ];
    const items = await planPivotSeeds('AAPL', planner(docs));
    expect(items).toEqual([
      { symbol: 'AAPL', date: '2026-01-05', kind: 'interim' },
      { symbol: 'AAPL', date: '2026-03-04', kind: 'confirmed' },
    ]);
  });

  it('ignores docs with other paramsIds', async () => {
    const docs = [doc({ paramsId: 'dev5_L5_R5_1barY_projY', pivotDates: ['2026-01-05'] })];
    expect(await planPivotSeeds('AAPL', planner(docs))).toEqual([]);
  });

  it('ignores st-source docs', async () => {
    const docs = [doc({ source: 'st', pivotDates: ['2026-01-05'] })];
    expect(await planPivotSeeds('AAPL', planner(docs))).toEqual([]);
  });

  it('tolerates a missing doc (empty repository result)', async () => {
    expect(await planPivotSeeds('NODOC', planner([]))).toEqual([]);
  });

  it('drops pre-floor (pre-2019) pivot dates — FE never consumes them', async () => {
    const docs = [
      doc({ pivotDates: ['1999-12-01', '2019-01-02', '2008-09-19'], currentExtremeDate: '2001-07-10' }),
    ];
    const items = await planPivotSeeds('AAPL', planner(docs));
    expect(items).toEqual([
      { symbol: 'AAPL', date: '2019-01-02', kind: 'confirmed' },
    ] satisfies PivotWorkItem[]);
  });

  it('uppercases the symbol', async () => {
    const deps = planner([]);
    await planPivotSeeds('aapl', deps);
    expect(deps.listSwingSetDocs).toHaveBeenCalledWith('AAPL');
  });
});
