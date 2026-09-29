/**
 * Tests for RankBuildService + IvRankLatestRepository (Task #187):
 * second-order rank pass — window read over year shards, day-entry merge
 * write, iv-rank-latest upsert/regress-guard.
 */
import { createFakeFirestore } from '../swing-set/fake-firestore';
import { SymbolMetricsRepository } from '../../../src/v2/symbol-metrics/services/symbol-metrics.repository';
import { IvRankLatestRepository } from '../../../src/v2/symbol-metrics/services/iv-rank-latest.repository';
import { RankBuildService } from '../../../src/v2/symbol-metrics/rank-build.service';

/** Seed a year-shard doc directly into the fake store. */
function seedYear(db: any, symbol: string, year: number, days: Record<string, { iv30?: number }>) {
  db.store.set(`symbol-metrics/${symbol}/years/${year}`, { symbol, year, days, updatedAt: null });
}

function makeSvc(seed: Record<string, unknown> = {}) {
  const db = createFakeFirestore(seed);
  const svc = new RankBuildService({
    repo: new SymbolMetricsRepository(db),
    latest: new IvRankLatestRepository(db),
  });
  return { db, svc };
}

const dayAt = (db: any, sym: string, date: string) =>
  (db.store.get(`symbol-metrics/${sym}/years/${date.slice(0, 4)}`) as any).days[date];
const latestDoc = (db: any, sym: string) => db.store.get(`iv-rank-latest/${sym}`) as any;

describe('RankBuildService.computeRankForDate', () => {
  it('skips when no day entry / no iv30 exists', async () => {
    const { svc } = makeSvc();
    expect(await svc.computeRankForDate('QQQ', '2024-01-05'))
      .toMatchObject({ written: false, latestUpdated: false });
    seedNothingForEntrylessDay();
  });

  it('skips malformed dates', async () => {
    const { svc } = makeSvc();
    expect((await svc.computeRankForDate('QQQ', 'not-a-date')).written).toBe(false);
  });

  it('writes rank fields merged onto the existing entry (iv30 preserved)', async () => {
    const { db, svc } = makeSvc();
    seedYear(db, 'QQQ', 2024, {
      '2024-01-02': { iv30: 0.20 },
      '2024-01-03': { iv30: 0.30 },
      '2024-01-04': { iv30: 0.40 },
    });
    const res = await svc.computeRankForDate('QQQ', '2024-01-04');
    expect(res).toMatchObject({ written: true, latestUpdated: true });

    const day = dayAt(db, 'QQQ', '2024-01-04');
    expect(day.iv30).toBe(0.40);        // merged, not replaced
    expect(day.ivN30).toBe(3);
    expect(day.ivRank30).toBe(100);     // cur = window max
    expect(day.ivPct30).toBe(100);
    expect(day.ivN360).toBe(3);

    const latest = latestDoc(db, 'QQQ');
    expect(latest.asOfDate).toBe('2024-01-04');
    expect(latest.ivRank30).toBe(100);
  });

  it('spans the prior year shard when the window crosses it', async () => {
    const { db, svc } = makeSvc();
    seedYear(db, 'QQQ', 2023, { '2023-02-01': { iv30: 0.10 } });
    seedYear(db, 'QQQ', 2024, { '2024-01-15': { iv30: 0.50 } });
    await svc.computeRankForDate('QQQ', '2024-01-15');
    const day = dayAt(db, 'QQQ', '2024-01-15');
    expect(day.ivN360).toBe(2);         // prior-year row inside 360d window
    expect(day.ivRank360).toBe(100);
  });

  it('latest doc does not regress on an older-date recompute', async () => {
    const { db, svc } = makeSvc();
    seedYear(db, 'QQQ', 2024, {
      '2024-01-02': { iv30: 0.20 },
      '2024-01-10': { iv30: 0.40 },
    });
    await svc.computeRankForDate('QQQ', '2024-01-10'); // newest → writes latest
    const res = await svc.computeRankForDate('QQQ', '2024-01-02'); // older
    expect(res.latestUpdated).toBe(false);
    expect(latestDoc(db, 'QQQ').asOfDate).toBe('2024-01-10');
    // the older day's own rank fields got written — and its window ends at
    // that date (latest-only freshness): future rows are excluded, so n=1
    // and rank is withheld while pct still computes.
    expect(dayAt(db, 'QQQ', '2024-01-02').ivN30).toBe(1);
    expect(dayAt(db, 'QQQ', '2024-01-02').ivPct30).toBe(100);
    expect(dayAt(db, 'QQQ', '2024-01-02').ivRank30).toBeUndefined();
  });

  it('rewrites latest when asOf is equal (same-day recompute heals)', async () => {
    const { db, svc } = makeSvc();
    seedYear(db, 'QQQ', 2024, { '2024-01-04': { iv30: 0.40 } });
    await svc.computeRankForDate('QQQ', '2024-01-04');
    seedYear(db, 'QQQ', 2024, {
      '2024-01-02': { iv30: 0.20 },
      '2024-01-04': dayAt(db, 'QQQ', '2024-01-04'),
    });
    const res = await svc.computeRankForDate('QQQ', '2024-01-04');
    expect(res.latestUpdated).toBe(true);
    expect(latestDoc(db, 'QQQ').ivN30).toBe(2);
  });

  it('idempotent — re-running produces identical day entry', async () => {
    const { db, svc } = makeSvc();
    seedYear(db, 'QQQ', 2024, {
      '2024-01-02': { iv30: 0.20 },
      '2024-01-04': { iv30: 0.40 },
    });
    await svc.computeRankForDate('QQQ', '2024-01-04');
    const first = dayAt(db, 'QQQ', '2024-01-04');
    await svc.computeRankForDate('QQQ', '2024-01-04');
    expect(dayAt(db, 'QQQ', '2024-01-04')).toEqual(first);
  });
});

function seedNothingForEntrylessDay() { /* readability marker — empty seed */ }

describe('IvRankLatestRepository', () => {
  it('delete removes the doc (disable cleanup)', async () => {
    const db = createFakeFirestore({ 'iv-rank-latest/QQQ': { symbol: 'QQQ', asOfDate: '2024-01-04' } });
    const repo = new IvRankLatestRepository(db);
    await repo.delete('qqq');
    expect(db.store.has('iv-rank-latest/QQQ')).toBe(false);
    expect(await repo.read('QQQ')).toBeNull();
  });
});
