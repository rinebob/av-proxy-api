/**
 * Tests for MetricBuildService.computeForDate (Task #170): corpus chain →
 * close bar → registry → repository, with deterministic skips.
 */
import type { AvOptionContract } from '@shared/alpha-vantage';
import { AvOptionType } from '@shared/alpha-vantage';
import type { DailyAdjustedBar } from '@shared/zigzag';
import type { CorpusReadResult } from '../../../src/v2/historical-options-corpus/types';
import { createFakeFirestore } from '../swing-set/fake-firestore';
import { MetricBuildService } from '../../../src/v2/symbol-metrics/build.service';
import { SymbolMetricsRepository } from '../../../src/v2/symbol-metrics/services/symbol-metrics.repository';

const DATE = '2024-01-05';
const SYM = 'QQQ';

function contract(expiration: string, strike: number, iv: number): AvOptionContract {
  return {
    expiration,
    strike: String(strike),
    type: AvOptionType.CALL,
    implied_volatility: String(iv),
  };
}

function found(chain: AvOptionContract[]): CorpusReadResult {
  // Minimal FOUND stub — the service only reads `status` and `response.data`.
  return { status: 'FOUND', response: { data: chain }, analysis: {}, envelope: {}, bytes: 0 } as CorpusReadResult;
}

function buildService(opts: {
  gcs?: { readItem(s: string, d: string): Promise<CorpusReadResult> };
  close?: number | null;
  seed?: Record<string, unknown>;
}) {
  const db = createFakeFirestore(opts.seed);
  const service = new MetricBuildService({
    gcs: opts.gcs ?? { readItem: async () => ({ status: 'NOT_FOUND' }) },
    // The service only reads `bar.close` — a minimal typed bar stub.
    bars: { readDate: async () => (opts.close == null ? null : { close: opts.close } as DailyAdjustedBar) },
    repo: new SymbolMetricsRepository(db),
  });
  return { db, service };
}

describe('MetricBuildService.computeForDate', () => {
  it('happy path: reads corpus + close, computes, writes days.{date}', async () => {
    const { db, service } = buildService({
      gcs: { readItem: async () => found([contract('2024-02-05', 100, 0.30)]) },
      close: 100,
    });
    const r = await service.computeForDate(SYM, DATE);

    expect(r).toMatchObject({ symbol: SYM, date: DATE, written: true });
    expect(r.fields).toContain('iv30');

    const doc = db.store.get('symbol-metrics/QQQ/years/2024') as any;
    expect(doc.days['2024-01-05'].iv30).toBeCloseTo(0.30, 5);
    expect(doc.days['2024-01-05'].iv30Method).toBe('nearest');
  });

  it('corpus object absent → written:false, no write', async () => {
    const { db, service } = buildService({ gcs: { readItem: async () => ({ status: 'NOT_FOUND' }) }, close: 100 });
    const r = await service.computeForDate(SYM, DATE);
    expect(r.written).toBe(false);
    expect(db.calls.filter((c) => c.method === 'set')).toHaveLength(0);
  });

  it('missing close → written:false, no write (deterministic skip)', async () => {
    const { db, service } = buildService({
      gcs: { readItem: async () => found([contract('2024-02-05', 100, 0.30)]) },
      close: null,
    });
    const r = await service.computeForDate(SYM, DATE);
    expect(r.written).toBe(false);
    expect(db.calls.filter((c) => c.method === 'set')).toHaveLength(0);
  });

  it('null compute (empty chain) → written:false, no write', async () => {
    const { db, service } = buildService({
      gcs: { readItem: async () => found([]) },
      close: 100,
    });
    const r = await service.computeForDate(SYM, DATE);
    expect(r.written).toBe(false);
    expect(db.calls.filter((c) => c.method === 'set')).toHaveLength(0);
  });

  it('malformed date → written:false, no write', async () => {
    const { db, service } = buildService({
      gcs: { readItem: async () => found([contract('2024-02-05', 100, 0.30)]) },
      close: 100,
    });
    const r = await service.computeForDate(SYM, '2024-1-5');
    expect(r.written).toBe(false);
    expect(db.calls.filter((c) => c.method === 'set')).toHaveLength(0);
  });

  it('recompute overwrites the same date key idempotently', async () => {
    const { db, service } = buildService({
      gcs: { readItem: async () => found([contract('2024-02-05', 100, 0.30)]) },
      close: 100,
      seed: {
        'symbol-metrics/QQQ/years/2024': {
          symbol: 'QQQ', year: 2024,
          days: { '2024-01-05': { iv30: 0.99 }, '2024-01-04': { iv30: 0.5 } },
        },
      },
    });
    const r = await service.computeForDate(SYM, DATE);
    expect(r.written).toBe(true);

    const doc = db.store.get('symbol-metrics/QQQ/years/2024') as any;
    expect(doc.days['2024-01-05'].iv30).toBeCloseTo(0.30, 5);
    expect(doc.days['2024-01-04'].iv30).toBe(0.5); // sibling preserved
  });
});
