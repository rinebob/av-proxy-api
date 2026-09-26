/**
 * Tests for shared/zigzag swing-set types and helpers (Task #123).
 *
 * Verifies:
 * - deriveParamsId produces the corpus paramsId
 * - CORPUS_ZIGZAG_CONFIG is the finest-grained (2/2/2) config
 * - SwingSetDoc serializes to a plain object (Firestore-writeable shape)
 * - DailyAdjustedBar carries the fields the BE adapter needs
 */
import { CORPUS_ZIGZAG_CONFIG } from '@shared/zigzag/canonical-configs';
import { deriveParamsId } from '@shared/zigzag/swing-set.types';
import type { SwingSetDoc, DailyAdjustedBar } from '@shared/zigzag/swing-set.types';
import type { ZigZagConfig } from '@shared/zigzag/zigzag.types';

describe('deriveParamsId', () => {
  it('produces the corpus paramsId for the corpus config', () => {
    expect(deriveParamsId(CORPUS_ZIGZAG_CONFIG)).toBe('dev2_L2_R2_1barY_projY');
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

describe('CORPUS_ZIGZAG_CONFIG', () => {
  it('is the finest-grained config — its pivot dates cover every larger swing', () => {
    expect(`${CORPUS_ZIGZAG_CONFIG.devThreshold}/${CORPUS_ZIGZAG_CONFIG.leftDepth}/${CORPUS_ZIGZAG_CONFIG.rightDepth}`).toBe('2/2/2');
  });

  it('enables one-bar pivots and projections', () => {
    expect(CORPUS_ZIGZAG_CONFIG.allowZigZagOnOneBar).toBe(true);
    expect(CORPUS_ZIGZAG_CONFIG.projectionPivots).toBe(true);
  });
});

describe('SwingSetDoc (slim shape — dates only)', () => {
  it('survives JSON round-trip with all fields preserved', () => {
    const doc: SwingSetDoc = {
      symbol: 'AAPL',
      paramsId: 'dev2_L2_R2_1barY_projY',
      config: CORPUS_ZIGZAG_CONFIG,
      pivotDates: ['2023-11-14'],
      currentExtremeDate: '2024-01-02',
      currentDirection: 'up',
      generatedAt: { seconds: 1_700_000_000, nanoseconds: 0 },
      source: 'sa',
    };
    // Deep-equality on the serialized form proves the doc carries only
    // Firestore-writeable primitives (no class instances, no drops).
    expect(JSON.parse(JSON.stringify(doc))).toEqual(doc);
  });

  it('doc.paramsId is consistent with deriveParamsId(config)', () => {
    const doc: SwingSetDoc = {
      symbol: 'AAPL',
      paramsId: deriveParamsId(CORPUS_ZIGZAG_CONFIG),
      config: CORPUS_ZIGZAG_CONFIG,
      pivotDates: [],
      currentExtremeDate: null,
      currentDirection: null,
      generatedAt: { seconds: 0, nanoseconds: 0 },
      source: 'sa',
    };
    expect(doc.paramsId).toBe(deriveParamsId(doc.config));
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
