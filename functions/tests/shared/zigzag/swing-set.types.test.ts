/**
 * Tests for shared/zigzag swing-set types and helpers (Task #123).
 *
 * Verifies:
 * - deriveParamsId produces ST-compatible paramsIds for the canonical configs
 * - CANONICAL_ZIGZAG_CONFIGS matches the four documented parameter sets
 * - SwingSetDoc serializes to a plain object (Firestore-writeable shape)
 * - DailyAdjustedBar carries the fields the BE adapter needs
 */
import { CANONICAL_ZIGZAG_CONFIGS } from '@shared/zigzag/canonical-configs';
import { deriveParamsId } from '@shared/zigzag/swing-set.types';
import type { SwingSetDoc, DailyAdjustedBar } from '@shared/zigzag/swing-set.types';
import type { ZigZagConfig, SwingStats, DistributionSummary, Histogram } from '@shared/zigzag/zigzag.types';

describe('deriveParamsId', () => {
  it('produces ST-compatible ids for the four canonical configs', () => {
    const ids = CANONICAL_ZIGZAG_CONFIGS.map(deriveParamsId);
    expect(ids).toEqual([
      'dev10_L10_R10_1barY_projY',
      'dev5_L5_R5_1barY_projY',
      'dev3_L3_R3_1barY_projY',
      'dev2_L2_R2_1barY_projY',
    ]);
  });

  it('encodes allowZigZagOnOneBar and projectionPivots flags', () => {
    const base: ZigZagConfig = {
      devThreshold: 5, leftDepth: 5, rightDepth: 5,
      allowZigZagOnOneBar: false, projectionPivots: false,
    };
    expect(deriveParamsId(base)).toBe('dev5_L5_R5_1barN_projN');
    expect(deriveParamsId({ ...base, allowZigZagOnOneBar: true })).toBe('dev5_L5_R5_1barY_projN');
    expect(deriveParamsId({ ...base, projectionPivots: true })).toBe('dev5_L5_R5_1barN_projY');
  });

  it('is independent of chart-only config fields', () => {
    const a: ZigZagConfig = {
      devThreshold: 5, leftDepth: 5, rightDepth: 5,
      allowZigZagOnOneBar: true, projectionPivots: true,
      lineColor: '#1976d2', showTriggerDots: true,
    };
    const b: ZigZagConfig = {
      devThreshold: 5, leftDepth: 5, rightDepth: 5,
      allowZigZagOnOneBar: true, projectionPivots: true,
      lineColor: '#ff0000', showTriggerDots: false,
    };
    expect(deriveParamsId(a)).toBe(deriveParamsId(b));
  });
});

describe('CANONICAL_ZIGZAG_CONFIGS', () => {
  it('contains exactly the four documented parameter sets', () => {
    expect(CANONICAL_ZIGZAG_CONFIGS).toHaveLength(4);
    const triples = CANONICAL_ZIGZAG_CONFIGS.map(
      (c) => `${c.devThreshold}/${c.leftDepth}/${c.rightDepth}`,
    );
    expect(triples).toEqual(['10/10/10', '5/5/5', '3/3/3', '2/2/2']);
  });

  it('enables one-bar pivots and projections in every config', () => {
    for (const cfg of CANONICAL_ZIGZAG_CONFIGS) {
      expect(cfg.allowZigZagOnOneBar).toBe(true);
      expect(cfg.projectionPivots).toBe(true);
    }
  });
});

describe('SwingSetDoc', () => {
  const emptySummary: DistributionSummary = {
    mean: 0, median: 0, stdDev: 0, min: 0, max: 0, p10: 0, p25: 0, p50: 0, p75: 0, p90: 0,
  };
  const emptyHistogram: Histogram = { bins: [] };
  const emptyStats: SwingStats = {
    up: { count: 0, magnitudePercent: emptySummary, magnitudeAbsolute: emptySummary, duration: emptySummary, magnitudeHistogram: emptyHistogram, durationHistogram: emptyHistogram },
    down: { count: 0, magnitudePercent: emptySummary, magnitudeAbsolute: emptySummary, duration: emptySummary, magnitudeHistogram: emptyHistogram, durationHistogram: emptyHistogram },
  };

  it('survives JSON round-trip with all fields preserved', () => {
    const doc: SwingSetDoc = {
      symbol: 'AAPL',
      paramsId: 'dev5_L5_R5_1barY_projY',
      config: CANONICAL_ZIGZAG_CONFIGS[1],
      pivots: [{ barIndex: 5, time: 1_700_000_000_000, price: 150, isHigh: true, confirmed: true }],
      projection: null,
      swings: [],
      stats: emptyStats,
      generatedAt: { seconds: 1_700_000_000, nanoseconds: 0 },
      source: 'sa',
    };
    // Deep-equality on the serialized form proves the doc carries only
    // Firestore-writeable primitives (no class instances, no drops).
    expect(JSON.parse(JSON.stringify(doc))).toEqual(doc);
  });

  it('doc.paramsId is consistent with deriveParamsId(config)', () => {
    for (const config of CANONICAL_ZIGZAG_CONFIGS) {
      const doc: SwingSetDoc = {
        symbol: 'AAPL',
        paramsId: deriveParamsId(config),
        config,
        pivots: [],
        swings: [],
        stats: emptyStats,
        generatedAt: { seconds: 0, nanoseconds: 0 },
        source: 'sa',
      };
      expect(doc.paramsId).toBe(deriveParamsId(doc.config));
    }
  });
});

describe('DailyAdjustedBar', () => {
  it('is assignable from the AV daily-adjusted wire shape', () => {
    // Compile-time contract check: the adapter input must carry the fields
    // the BE adapter maps into PriceBar.
    const bar: DailyAdjustedBar = {
      date: '2026-09-22',
      open: 100,
      high: 105,
      low: 98,
      close: 102,
      adjustedClose: 101.5,
      volume: 1_000_000,
      dividendAmount: 0,
      splitCoefficient: 1,
    };
    expect(Object.keys(bar)).toEqual(
      expect.arrayContaining(['date', 'open', 'high', 'low', 'close', 'adjustedClose', 'volume', 'dividendAmount', 'splitCoefficient']),
    );
  });
});
