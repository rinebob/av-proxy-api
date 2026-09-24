/**
 * Unit tests for SwingSetGenerationService (Task #125).
 *
 * Seam per the TEST doc: mocked DailyAdjustedReader + real
 * SwingSetRepository over an in-memory Firestore fake. The real zigzag
 * engine runs on the fixture bars, so the persisted SwingSetDocs carry
 * engine-computed pivots/swings/stats — not canned data.
 */
import type { DailyAdjustedBar, SwingSetDoc, ZigZagConfig } from '@shared/zigzag';
import { CANONICAL_ZIGZAG_CONFIGS, deriveParamsId } from '@shared/zigzag';
import { createFakeFirestore } from '../fake-firestore';

/** Synthetic daily bars — four ~30% legs so even the 10/10/10 config produces confirmed pivots. */
function makeBars(): DailyAdjustedBar[] {
  const prices: number[] = [];
  let p = 100;
  // 15 bars per leg: up +30%, down -30%, up +30%, down -30%
  for (const dir of [1, -1, 1, -1]) {
    for (let i = 0; i < 15; i++) {
      p *= 1 + dir * 0.02;
      prices.push(p);
    }
  }
  // Real sequential dates — pivot times must stay finite (engine stamps x.getTime())
  const start = Date.UTC(2026, 0, 1);
  return prices.map((px, i) => ({
    date: new Date(start + i * 86_400_000).toISOString().slice(0, 10),
    open: px - 1,
    high: px + 2,
    low: px - 2,
    close: px,
    adjustedClose: px,
    volume: 1000,
    dividendAmount: 0,
    splitCoefficient: 1,
  }));
}

/** Reader stub returning a fixed bar fixture (or empty). */
function makeReader(bars: DailyAdjustedBar[]) {
  return { read: jest.fn(async (_symbol: string) => bars) };
}

function makeService(bars: DailyAdjustedBar[] | null = makeBars()) {
  const { SwingSetGenerationService } = require('../../../../src/v2/swing-set/services/swing-set-generation.service');
  const { SwingSetRepository } = require('../../../../src/v2/swing-set/services/swing-set.repository');
  const fake = createFakeFirestore();
  const repo = new SwingSetRepository(fake);
  const reader = makeReader(bars ?? []);
  const logs: { level: string; msg: string }[] = [];
  const logger = {
    info: (m: string) => logs.push({ level: 'info', msg: m }),
    warn: (m: string) => logs.push({ level: 'warn', msg: m }),
    error: (m: string) => logs.push({ level: 'error', msg: m }),
  };
  const service = new SwingSetGenerationService(reader, repo, logger);
  return { service, repo, reader, logs, fake };
}

describe('SwingSetGenerationService', () => {
  it('generateForSymbol writes all four canonical docs keyed {symbol}_{paramsId}', async () => {
    const { service, fake } = makeService();
    const result = await service.generateForSymbol('AAPL');

    expect(result.skipped).toBe(false);
    expect(result.generated).toEqual(CANONICAL_ZIGZAG_CONFIGS.map(deriveParamsId));

    for (const config of CANONICAL_ZIGZAG_CONFIGS) {
      const paramsId = deriveParamsId(config);
      const doc = fake.store.get(`options-swing-sets/AAPL_${paramsId}`) as SwingSetDoc;
      expect(doc).toBeDefined();
      expect(doc.symbol).toBe('AAPL');
      expect(doc.paramsId).toBe(paramsId);
      expect(doc.source).toBe('sa');
      expect(doc.config.devThreshold).toBe(config.devThreshold);
      // Engine actually ran — the 4-leg fixture produces exactly 3 confirmed
      // pivots (at the internal leg turns: bar indices 14, 29, 44) plus one
      // projection at the final extreme — for EVERY canonical config, since
      // the legs are monotonic and ≥26% in magnitude.
      expect(doc.pivots).toHaveLength(3);
      expect(doc.pivots.map((p) => p.barIndex)).toEqual([14, 29, 44]);
      expect(doc.pivots.every((p) => Number.isFinite(p.time))).toBe(true);
      expect(doc.projection).not.toBeNull();
      expect(doc.stats.up.count + doc.stats.down.count).toBeGreaterThan(0);
      expect(typeof doc.generatedAt.seconds).toBe('number');
    }
  });

  it('generateForConfig writes exactly one doc and returns it', async () => {
    const { service, fake } = makeService();
    const config: ZigZagConfig = CANONICAL_ZIGZAG_CONFIGS[1];
    const doc = await service.generateForConfig('AAPL', config);

    expect(doc).not.toBeNull();
    expect(doc!.paramsId).toBe('dev5_L5_R5_1barY_projY');
    const keys = [...fake.store.keys()];
    expect(keys).toEqual(['options-swing-sets/AAPL_dev5_L5_R5_1barY_projY']);
  });

  it('is idempotent — repeated generation overwrites the same docs', async () => {
    const { service, repo } = makeService();
    await service.generateForSymbol('AAPL');
    const first = await repo.get('AAPL', 'dev5_L5_R5_1barY_projY');
    await service.generateForSymbol('AAPL');
    const second = await repo.get('AAPL', 'dev5_L5_R5_1barY_projY');

    // Same pivots/swings/stats — only generatedAt may differ
    const { generatedAt: _a, ...restA } = first!;
    const { generatedAt: _b, ...restB } = second!;
    expect(restB).toEqual(restA);
  });

  it('skips gracefully when the symbol has no daily-adjusted data', async () => {
    const { service, fake, logs } = makeService(null);
    const result = await service.generateForSymbol('MSFT');

    expect(result.skipped).toBe(true);
    expect(result.generated).toEqual([]);
    expect(fake.store.size).toBe(0);
    expect(logs.some((l) => l.level === 'warn' && l.msg.includes('MSFT'))).toBe(true);
  });

  it('generateForConfig returns null when there is no data', async () => {
    const { service } = makeService(null);
    const doc = await service.generateForConfig('MSFT', CANONICAL_ZIGZAG_CONFIGS[0]);
    expect(doc).toBeNull();
  });

  it('reads bars once per symbol (not once per config)', async () => {
    const { service, reader } = makeService();
    await service.generateForSymbol('AAPL');
    expect(reader.read).toHaveBeenCalledTimes(1);
    expect(reader.read).toHaveBeenCalledWith('AAPL');
  });
});
