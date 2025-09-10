import { db } from '../../../firebase-admin-init';
import { ApiProvider } from '@shared/core';
import { AlphaVantageEndpoint, TimeSeriesInterval } from '@shared/alpha-vantage';
import {
  getSymbolTimeSeriesDocPath,
  getSymbolTimeSeriesYearDocPath,
  getSymbolTimeSeriesAllDocPath,
} from '../firestore/firestore-paths';
import type { CompactBar } from '@shared/alpha-vantage';

export interface TimeSeriesReadParams {
  symbol: string;
  interval: TimeSeriesInterval;
  range?: 'ytd' | '1y' | '3y' | '5y' | 'max';
  from?: string | number; // ISO date or epoch ms
  to?: string | number;   // ISO date or epoch ms
  limit?: number;         // truncate to last N after filtering
}

export interface PartnerTimeSeriesResponse {
  ok: boolean;
  symbol: string;
  interval: TimeSeriesInterval;
  provider: 'av';
  endpointDocId: string;
  rangeUsed: { from?: number; to?: number; preset?: string };
  availableYears?: number[];
  count: number;
  bars: CompactBar[];
  timestamp: string;
  truncated?: boolean;
  error?: string;
  code?: string;
}

function toEpoch(input?: string | number): number | undefined {
  if (input == null) return undefined;
  if (typeof input === 'number') return input;
  const t = Date.parse(input);
  return Number.isNaN(t) ? undefined : t;
}

function resolveEndpoint(interval: TimeSeriesInterval): { intervalEnum: TimeSeriesInterval; endpoint: AlphaVantageEndpoint } {
  switch (interval) {
    case TimeSeriesInterval.DAILY:
      return { intervalEnum: TimeSeriesInterval.DAILY, endpoint: AlphaVantageEndpoint.TIME_SERIES_DAILY_ADJUSTED };
    case TimeSeriesInterval.WEEKLY:
      return { intervalEnum: TimeSeriesInterval.WEEKLY, endpoint: AlphaVantageEndpoint.TIME_SERIES_WEEKLY_ADJUSTED };
    case TimeSeriesInterval.MONTHLY:
      return { intervalEnum: TimeSeriesInterval.MONTHLY, endpoint: AlphaVantageEndpoint.TIME_SERIES_MONTHLY_ADJUSTED };
    default:
      throw new Error(`Unsupported interval: ${interval}`);
  }
}

export async function getPartnerTimeSeries(params: TimeSeriesReadParams): Promise<PartnerTimeSeriesResponse> {
  const nowMs = Date.now();
  const symbol = params.symbol.toUpperCase();
  const interval = params.interval;
  const { endpoint } = resolveEndpoint(interval);

  // Defaults per interval
  const defaultPreset: TimeSeriesReadParams['range'] = interval === TimeSeriesInterval.DAILY ? '1y' : interval === TimeSeriesInterval.WEEKLY ? '5y' : 'max';

  // Determine from/to
  const fromExplicit = toEpoch(params.from);
  const toExplicit = toEpoch(params.to);
  const presetApplied = params.from || params.to ? undefined : (params.range || defaultPreset);
  const { from: fromPreset, to: toPreset } = rangeToFromTo(nowMs, presetApplied);
  const from = fromExplicit ?? fromPreset;
  const to = toExplicit ?? toPreset ?? nowMs;

  const vendor = ApiProvider.ALPHA_VANTAGE;
  const docPath = getSymbolTimeSeriesDocPath(symbol, endpoint, vendor);

  try {
    // Monthly uses single 'all' doc
    if (interval === TimeSeriesInterval.MONTHLY) {
      const allDocPath = getSymbolTimeSeriesAllDocPath(symbol, endpoint, vendor);
      const snap = await db.doc(allDocPath).get();
      if (!snap.exists) {
        return { ok: false, symbol, interval, provider: 'av', endpointDocId: docPath.split('/').pop()!, rangeUsed: { from, to, preset: presetApplied }, count: 0, bars: [], timestamp: new Date().toISOString(), error: 'NOT_FOUND', code: 'NOT_FOUND' };
      }
      const data = snap.data() as any;
      let bars: CompactBar[] = Array.isArray(data?.bars) ? data.bars : [];
      // Filter and sort ascending
      bars = bars.filter(b => (from == null || b.t >= from) && (to == null || b.t <= to)).sort((a, b) => a.t - b.t);
      // Enrich with ch/cp if missing
      if (bars.length && (bars[0].ch == null || bars[0].cp == null)) {
        bars = enrichWithChange(bars);
      }
      let truncated = false;
      if (typeof params.limit === 'number' && params.limit > 0 && bars.length > params.limit) {
        truncated = true;
        bars = bars.slice(-params.limit);
      }
      return {
        ok: true,
        symbol,
        interval,
        provider: 'av',
        endpointDocId: docPath.split('/').pop()!,
        rangeUsed: { from, to, preset: presetApplied },
        availableYears: undefined,
        count: bars.length,
        bars,
        timestamp: new Date().toISOString(),
        truncated,
      };
    }

    // Daily/Weekly: read years
    const metaSnap = await db.doc(docPath).get();
    if (!metaSnap.exists) {
      return { ok: false, symbol, interval, provider: 'av', endpointDocId: docPath.split('/').pop()!, rangeUsed: { from, to, preset: presetApplied }, count: 0, bars: [], timestamp: new Date().toISOString(), error: 'NOT_FOUND', code: 'NOT_FOUND' };
    }
    const meta = metaSnap.data() as any;
    const availableYears: number[] = Array.isArray(meta?.metadata?.availableYears) ? meta.metadata.availableYears : [];

    // Compute which years to read
    const fromYear = from != null ? new Date(from).getUTCFullYear() : Math.min(...availableYears);
    const toYear = to != null ? new Date(to).getUTCFullYear() : Math.max(...availableYears);
    const yearsToRead = availableYears.filter(y => y >= fromYear && y <= toYear).sort((a, b) => a - b);

    // Fetch all year docs in parallel
    const yearRefs = yearsToRead.map(y => db.doc(getSymbolTimeSeriesYearDocPath(symbol, endpoint, vendor, y)));
    const yearSnaps = await Promise.all(yearRefs.map(r => r.get()));

    let allBars: CompactBar[] = [];
    for (const s of yearSnaps) {
      if (!s.exists) continue;
      const d = s.data() as any;
      const yBars: CompactBar[] = Array.isArray(d?.bars) ? d.bars : [];
      allBars.push(...yBars);
    }

    // Filter and sort ascending
    let bars = allBars.filter(b => (from == null || b.t >= from) && (to == null || b.t <= to)).sort((a, b) => a.t - b.t);

    // Enrich with ch/cp if missing
    if (bars.length && (bars[0].ch == null || bars[0].cp == null)) {
      bars = enrichWithChange(bars);
    }

    // Only truncate when an explicit limit is provided
    let truncated = false;
    if (typeof params.limit === 'number' && params.limit > 0 && bars.length > params.limit) {
      truncated = true;
      bars = bars.slice(-params.limit);
    }

    return {
      ok: true,
      symbol,
      interval,
      provider: 'av',
      endpointDocId: docPath.split('/').pop()!,
      rangeUsed: { from, to, preset: presetApplied },
      availableYears,
      count: bars.length,
      bars,
      timestamp: new Date().toISOString(),
      truncated,
    };
  } catch (e: any) {
    return {
      ok: false,
      symbol,
      interval,
      provider: 'av',
      endpointDocId: docPath.split('/').pop()!,
      rangeUsed: { from, to, preset: presetApplied },
      count: 0,
      bars: [],
      timestamp: new Date().toISOString(),
      error: e?.message || 'UNKNOWN',
      code: 'INTERNAL_ERROR',
    };
  }
}

function rangeToFromTo(nowMs: number, preset?: TimeSeriesReadParams['range']): { from?: number; to?: number } {
  if (!preset) return {};
  const to = nowMs;
  const d = new Date(nowMs);
  switch (preset) {
    case 'ytd': {
      const yStart = Date.UTC(d.getUTCFullYear(), 0, 1);
      return { from: yStart, to };
    }
    case '1y': return { from: nowMs - 365 * 24 * 3600 * 1000, to };
    case '3y': return { from: nowMs - 3 * 365 * 24 * 3600 * 1000, to };
    case '5y': return { from: nowMs - 5 * 365 * 24 * 3600 * 1000, to };
    case 'max': return { };
    default: return {};
  }
}

function enrichWithChange(bars: CompactBar[]): CompactBar[] {
  // bars are expected ascending here
  let prevClose: number | undefined = undefined;
  return bars.map((b, idx) => {
    const ch = idx === 0 || prevClose == null ? 0 : Number((b.c - prevClose).toFixed(2));
    const cp = idx === 0 || prevClose == null || prevClose === 0 ? 0 : Number((((b.c - prevClose) / prevClose) * 100).toFixed(2));
    prevClose = b.c;
    return { ...b, ch, cp } as CompactBar;
  });
}
