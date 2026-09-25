/**
 * Task #151: swing-doc pivot planner. Given a symbol, reads the 4 canonical
 * swing-set docs and emits the deduped corpus work list: all confirmed pivot
 * dates + the current developing-swing extreme (interim).
 */
import {
  planPivotSeeds,
  type PivotWorkItem,
} from '../../../src/v2/historical-options-corpus/services/pivot-work-planner';
import { CANONICAL_ZIGZAG_CONFIGS, deriveParamsId } from '@shared/zigzag';
import type { Pivot, SwingSetDoc } from '@shared/zigzag';

const IDS = CANONICAL_ZIGZAG_CONFIGS.map(deriveParamsId);
const day = (d: string) => new Date(`${d}T00:00:00Z`).getTime();
const pivot = (d: string, isHigh = true, confirmed = true): Pivot => ({
  barIndex: 0,
  time: day(d),
  price: 100,
  isHigh,
  confirmed,
});

function doc(paramsId: string, over: Partial<SwingSetDoc> = {}): SwingSetDoc {
  return {
    symbol: 'AAPL',
    paramsId,
    config: {} as any,
    pivots: [],
    swings: [],
    stats: {} as any,
    generatedAt: {} as any,
    source: 'sa',
    ...over,
  };
}

const planner = (docs: SwingSetDoc[]) => ({
  listSwingSetDocs: jest.fn().mockResolvedValue(docs),
});

describe('planPivotSeeds', () => {
  it('emits confirmed pivot dates deduped across canonical docs', async () => {
    const docs = [
      doc(IDS[0], { pivots: [pivot('2026-01-05'), pivot('2026-02-03', false)] }),
      doc(IDS[1], { pivots: [pivot('2026-01-05'), pivot('2026-03-04')] }),
      doc(IDS[2], { pivots: [pivot('2026-01-20')] }),
      doc(IDS[3]),
    ];
    const items = await planPivotSeeds('AAPL', planner(docs));
    expect(items.map((i) => i.date)).toEqual(['2026-01-05', '2026-01-20', '2026-02-03', '2026-03-04']);
    expect(items.every((i) => i.kind === 'confirmed' && i.symbol === 'AAPL')).toBe(true);
  });

  it('emits the projection as an interim work item', async () => {
    const docs = [
      doc(IDS[0], {
        pivots: [pivot('2026-01-05')],
        projection: pivot('2026-04-01', true, false),
      }),
    ];
    const items = await planPivotSeeds('AAPL', planner(docs));
    expect(items).toEqual([
      { symbol: 'AAPL', date: '2026-01-05', kind: 'confirmed' },
      { symbol: 'AAPL', date: '2026-04-01', kind: 'interim' },
    ] satisfies PivotWorkItem[]);
  });

  it('confirmed kind wins when a projection date coincides with a confirmed pivot elsewhere', async () => {
    const docs = [
      doc(IDS[0], { projection: pivot('2026-01-05', true, false) }),
      doc(IDS[1], { pivots: [pivot('2026-01-05')] }),
    ];
    const items = await planPivotSeeds('AAPL', planner(docs));
    expect(items).toEqual([{ symbol: 'AAPL', date: '2026-01-05', kind: 'confirmed' }]);
  });

  it('no projection → no interim item (current extreme is already a confirmed pivot)', async () => {
    const docs = [doc(IDS[0], { pivots: [pivot('2026-01-05')] })];
    const items = await planPivotSeeds('AAPL', planner(docs));
    expect(items.every((i) => i.kind === 'confirmed')).toBe(true);
  });

  it('unconfirmed entries inside pivots[] are ignored', async () => {
    const docs = [doc(IDS[0], { pivots: [pivot('2026-01-05', true, false)] })];
    expect(await planPivotSeeds('AAPL', planner(docs))).toEqual([]);
  });

  it('ignores non-canonical paramsId docs', async () => {
    const docs = [doc('dev99_L1_R1_1barN_projN', { pivots: [pivot('2026-01-05')] })];
    expect(await planPivotSeeds('AAPL', planner(docs))).toEqual([]);
  });

  it('ignores a malformed confirmed:true projection and st-source docs', async () => {
    const docs = [
      doc(IDS[0], { projection: pivot('2026-04-01', true, true) }),
      doc(IDS[1], { source: 'st', pivots: [pivot('2026-01-05')] }),
    ];
    expect(await planPivotSeeds('AAPL', planner(docs))).toEqual([]);
  });

  it('tolerates missing docs (empty repository result)', async () => {
    expect(await planPivotSeeds('NODOC', planner([]))).toEqual([]);
  });

  it('uppercases the symbol', async () => {
    const deps = planner([]);
    await planPivotSeeds('aapl', deps);
    expect(deps.listSwingSetDocs).toHaveBeenCalledWith('AAPL');
  });
});
