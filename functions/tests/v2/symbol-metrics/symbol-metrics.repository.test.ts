/**
 * Tests for SymbolMetricsRepository (Task #170): year-sharded day-entry
 * persistence at symbol-metrics/{SYMBOL}/years/{YYYY} with merge writes that
 * preserve sibling dates.
 */
import type { SymbolMetricDayEntry } from '@shared/options';
import { createFakeFirestore } from '../swing-set/fake-firestore';
import { SymbolMetricsRepository } from '../../../src/v2/symbol-metrics/services/symbol-metrics.repository';

const ENTRY: SymbolMetricDayEntry = { iv30: 0.21, iv30Method: 'interpolated', iv30Contracts: 120 };

function repoWith(seed: Record<string, unknown> = {}) {
  const db = createFakeFirestore(seed);
  return { db, repo: new SymbolMetricsRepository(db) };
}

describe('SymbolMetricsRepository.upsertDay', () => {
  it('writes a year doc with symbol/year/days.{date}', async () => {
    const { db, repo } = repoWith();
    await repo.upsertDay('qqq', '2024-01-05', ENTRY);

    const doc = db.store.get('symbol-metrics/QQQ/years/2024') as any;
    expect(doc.symbol).toBe('QQQ');
    expect(doc.year).toBe(2024);
    expect(doc.days['2024-01-05']).toEqual(ENTRY);
    expect(doc.updatedAt).toBeDefined(); // serverTimestamp transform
  });

  it('normalizes the symbol to uppercase', async () => {
    const { db } = repoWith();
    const repo = new SymbolMetricsRepository(db);
    await repo.upsertDay('aapl', '2024-01-05', ENTRY);
    expect(db.store.has('symbol-metrics/AAPL/years/2024')).toBe(true);
  });

  it('merges: a second upsert preserves other dates in the shard', async () => {
    const { db, repo } = repoWith();
    await repo.upsertDay('QQQ', '2024-01-05', ENTRY);
    await repo.upsertDay('QQQ', '2024-01-08', { iv30: 0.25, iv30Method: 'nearest', iv30Contracts: 80 });

    const doc = db.store.get('symbol-metrics/QQQ/years/2024') as any;
    expect(doc.days['2024-01-05']).toEqual(ENTRY);
    expect(doc.days['2024-01-08'].iv30).toBe(0.25);
  });

  it('recompute is idempotent — overwriting a date replaces that entry only', async () => {
    const { db, repo } = repoWith();
    await repo.upsertDay('QQQ', '2024-01-05', ENTRY);
    await repo.upsertDay('QQQ', '2024-01-05', { ...ENTRY, iv30: 0.30 });

    const doc = db.store.get('symbol-metrics/QQQ/years/2024') as any;
    expect(doc.days['2024-01-05'].iv30).toBe(0.30);
    expect(Object.keys(doc.days)).toEqual(['2024-01-05']);
  });

  it('a recompute that drops a field replaces the entry wholesale (no stale fields)', async () => {
    const { db, repo } = repoWith();
    await repo.upsertDay('QQQ', '2024-01-05', ENTRY);
    // A future metric declines → entry no longer carries iv30Contracts.
    await repo.upsertDay('QQQ', '2024-01-05', { iv30: 0.30, iv30Method: 'nearest' });

    const doc = db.store.get('symbol-metrics/QQQ/years/2024') as any;
    expect(doc.days['2024-01-05']).toEqual({ iv30: 0.30, iv30Method: 'nearest' });
  });

  it('rejects malformed dates (would corrupt the days field path)', async () => {
    const { repo } = repoWith();
    await expect(repo.upsertDay('QQQ', 'a.b', ENTRY)).rejects.toThrow(/malformed date/);
    await expect(repo.upsertDay('QQQ', '2024-1-5', ENTRY)).rejects.toThrow(/malformed date/);
  });

  it('writes via mergeFields field-paths (not a full doc replace)', async () => {
    const { db, repo } = repoWith();
    await repo.upsertDay('QQQ', '2024-01-05', ENTRY);
    const call = db.calls.find((c) => c.path === 'symbol-metrics/QQQ/years/2024');
    const fields = (call?.opts as { mergeFields?: string[] })?.mergeFields;
    expect(fields).toContain('days.2024-01-05');
  });
});

describe('SymbolMetricsRepository reads', () => {
  it('readDay returns the entry when present', async () => {
    const { repo } = repoWith({
      'symbol-metrics/QQQ/years/2024': { symbol: 'QQQ', year: 2024, days: { '2024-01-05': ENTRY } },
    });
    expect(await repo.readDay('QQQ', '2024-01-05')).toEqual(ENTRY);
  });

  it('readDay returns null for missing date/doc', async () => {
    const { repo } = repoWith({
      'symbol-metrics/QQQ/years/2024': { symbol: 'QQQ', year: 2024, days: {} },
    });
    expect(await repo.readDay('QQQ', '2024-01-06')).toBeNull();
    expect(await repo.readDay('QQQ', '2025-01-06')).toBeNull(); // no year doc
  });

  it('readYear returns the whole shard or null', async () => {
    const { repo } = repoWith({
      'symbol-metrics/QQQ/years/2024': { symbol: 'QQQ', year: 2024, days: { '2024-01-05': ENTRY } },
    });
    const doc = await repo.readYear('QQQ', '2024');
    expect(doc?.days['2024-01-05'].iv30).toBe(0.21);
    expect(await repo.readYear('QQQ', '2025')).toBeNull();
  });
});
