import {
  computeRankFields,
  rankWindow,
  windowRows,
  type IvRankPoint,
} from '../../../src/v2/symbol-metrics/rank/iv-rank.computer';

const p = (date: string, iv30: number): IvRankPoint => ({ date, iv30 });

/** Offset an ISO date by calendar days (UTC). */
const shift = (iso: string, days: number) =>
  new Date(Date.parse(iso) + days * 86_400_000).toISOString().slice(0, 10);

describe('windowRows', () => {
  const asOf = '2024-06-15';
  const series = [
    p('2023-06-25', 0.30),   // 356d back — outside W30/60/180, inside 360
    p('2023-06-20', 0.31),   // 361d back — outside even 360
    p('2024-05-16', 0.25),   // 30d back — inside W30 (boundary)
    p('2024-05-15', 0.20),   // 31d back — outside W30, inside W60+
    p('2024-06-15', 0.40),   // asOf — always inside
  ];

  it('filters to trailing calendar days, inclusive of asOf and the floor', () => {
    expect(windowRows(series, asOf, 30).map((r) => r.date)).toEqual(['2024-05-16', '2024-06-15']);
    expect(windowRows(series, asOf, 60)).toHaveLength(3);
    expect(windowRows(series, asOf, 360)).toHaveLength(4);
  });

  it('drops malformed dates instead of throwing', () => {
    expect(windowRows([p('bogus', 1), ...series], asOf, 30)).toHaveLength(2);
  });
});

describe('rankWindow', () => {
  const rows = [p('2024-06-01', 0.20), p('2024-06-05', 0.30), p('2024-06-15', 0.40)];

  it('rank = (cur - min) / (max - min) * 100', () => {
    expect(rankWindow(rows, 0.40)).toEqual({ ivN: 3, ivPct: 100, ivRank: 100 });
    expect(rankWindow(rows, 0.20)).toEqual({ ivN: 3, ivPct: 33.33333333333333, ivRank: 0 });
    expect(rankWindow(rows, 0.30).ivRank).toBeCloseTo(50);
  });

  it('percentile counts iv <= cur (ties count toward cur)', () => {
    const tied = [p('2024-06-01', 0.30), p('2024-06-05', 0.30), p('2024-06-15', 0.30)];
    expect(rankWindow(tied, 0.30).ivPct).toBe(100);
  });

  it('constant series → ivRank 0 (defined-but-degenerate)', () => {
    expect(rankWindow(tiedRows(), 0.30).ivRank).toBe(0);
  });

  it('single sample → ivPct emitted, ivRank withheld', () => {
    const r = rankWindow([p('2024-06-15', 0.40)], 0.40);
    expect(r).toEqual({ ivN: 1, ivPct: 100 });
    expect(r.ivRank).toBeUndefined();
  });

  it('empty window → ivN 0, nothing else', () => {
    expect(rankWindow([], 0.40)).toEqual({ ivN: 0 });
  });
});

function tiedRows() {
  return [p('2024-06-01', 0.30), p('2024-06-05', 0.30), p('2024-06-15', 0.30)];
}

describe('computeRankFields', () => {
  const asOf = '2024-06-15';
  const series = [
    p(shift(asOf, -200), 0.20),
    p(shift(asOf, -50), 0.25),
    p(shift(asOf, -20), 0.30),
    p(asOf, 0.40),
  ];

  it('emits ivN for every window; rank/pct only where mature', () => {
    const out = computeRankFields(series, asOf, 0.40);
    expect(out.ivN30).toBe(2);   // 20d + asOf
    expect(out.ivN60).toBe(3);
    expect(out.ivN180).toBe(3);  // 200d back excluded
    expect(out.ivN360).toBe(4);
    expect(out.ivRank30).toBe(100);
    expect(out.ivPct30).toBe(100);
    expect(out.ivRank360).toBe(100); // cur = max in every window
  });

  it('n=1 window emits ivN + ivPct but no ivRank', () => {
    const only = computeRankFields([p(asOf, 0.40)], asOf, 0.40);
    expect(only.ivN30).toBe(1);
    expect(only.ivPct30).toBe(100);
    expect(only.ivRank30).toBeUndefined();
  });

  it('sparse series: n exposes immaturity honestly', () => {
    const sparse = computeRankFields([p(asOf, 0.40)], asOf, 0.40);
    expect(sparse.ivN360).toBe(1); // 360-day window with 1 sample
    expect(sparse.ivRank360).toBeUndefined();
  });
});
