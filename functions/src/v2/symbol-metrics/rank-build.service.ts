/**
 * RankBuildService — the second-order pass (Topic #158, Thread #163,
 * Task #187): reads the symbol's trailing IV30 rows, runs the rank
 * computers, merge-writes rank fields onto the same day entry, and rewrites
 * `iv-rank-latest` when the date is the newest observation.
 *
 * Deterministic skips — `written: false` when the date is malformed, no day
 * entry exists, or the entry has no iv30. Latest-only freshness: the latest
 * doc only moves forward/backward-compatible — a recompute of an older date
 * refreshes that day's rank fields but never regresses `asOfDate`.
 *
 * Window reach: the widest window is 360 calendar days, so a date's series
 * spans at most two year shards — the current and prior year docs.
 */
import type { SymbolMetricField } from '@shared/options';
import { computeRankFields, type IvRankPoint } from './rank/iv-rank.computer';
import type { SymbolMetricsRepository } from './services/symbol-metrics.repository';
import type { IvRankLatestRepository } from './services/iv-rank-latest.repository';

export interface RankBuildDeps {
  repo: SymbolMetricsRepository;
  latest: IvRankLatestRepository;
}

export interface RankBuildResult {
  symbol: string;
  date: string;
  written: boolean;
  fields: SymbolMetricField[];
  /** True when iv-rank-latest/{SYMBOL} was (re)written this pass. */
  latestUpdated: boolean;
}

const MS_PER_DAY = 86_400_000;

export class RankBuildService {
  constructor(private readonly deps: RankBuildDeps) {}

  async computeRankForDate(symbol: string, date: string): Promise<RankBuildResult> {
    const sym = symbol.toUpperCase();
    const skip = (): RankBuildResult =>
      ({ symbol: sym, date, written: false, fields: [], latestUpdated: false });

    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return skip();

    const entry = await this.deps.repo.readDay(sym, date);
    if (!entry || !Number.isFinite(entry.iv30)) return skip();

    // The 360d window reaches back at most one year boundary.
    const floorYear = new Date(Date.parse(date) - 360 * MS_PER_DAY)
      .toISOString().slice(0, 4);
    const years = floorYear === date.slice(0, 4)
      ? [date.slice(0, 4)]
      : [floorYear, date.slice(0, 4)];
    const docs = await Promise.all(years.map((y) => this.deps.repo.readYear(sym, y)));

    const series: IvRankPoint[] = [];
    for (const doc of docs) {
      for (const [d, e] of Object.entries(doc?.days ?? {})) {
        if (e && Number.isFinite(e.iv30)) series.push({ date: d, iv30: e.iv30! });
      }
    }

    const fields = computeRankFields(series, date, entry.iv30!);
    // Note: fields are merged over the existing entry — a rank field that a
    // recompute now withholds (n regression, e.g. a prior day entry's iv30
    // was later corrected to absent) would linger stale. Unlikely and
    // self-heals the next time n is healthy; flagged, not fixed.
    await this.deps.repo.upsertDay(sym, date, { ...entry, ...fields });

    const prior = await this.deps.latest.read(sym);
    const latestUpdated = !prior || date >= prior.asOfDate;
    if (latestUpdated) {
      await this.deps.latest.upsert(sym, date, fields as Record<string, number | undefined>);
    }

    return { symbol: sym, date, written: true, fields: Object.keys(fields) as SymbolMetricField[], latestUpdated };
  }
}
