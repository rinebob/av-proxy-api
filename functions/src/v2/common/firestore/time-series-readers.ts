import { db } from '../../../firebase-admin-init';
import { createLogger } from '../../utils/utils';
import { ApiProvider } from '@shared/core';
import { AlphaVantageEndpoint, TimeSeriesInterval } from '@shared/alpha-vantage';
import {
  getSymbolTimeSeriesDocPath,
  getSymbolTimeSeriesYearDocPath,
  getSymbolTimeSeriesAllDocPath,
} from '../firestore/firestore-paths';
import type { CompactBar } from '@shared/alpha-vantage';

const logger = createLogger('[time-series-readers]');

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
  logger.debug('reader.start', { symbol, interval, endpoint, docPath, params });

  try {
    // Monthly uses single 'all' doc
    if (interval === TimeSeriesInterval.MONTHLY) {
      const allDocPath = getSymbolTimeSeriesAllDocPath(symbol, endpoint, vendor);
      logger.debug('reader.monthly.doc', { allDocPath });
      const snap = await db.doc(allDocPath).get();
      logger.debug('reader.monthly.doc.exists', { allDocPath, exists: snap.exists });
      if (!snap.exists) {
        return { ok: false, symbol, interval, provider: 'av', endpointDocId: docPath.split('/').pop()!, rangeUsed: { from, to, preset: presetApplied }, count: 0, bars: [], timestamp: new Date().toISOString(), error: 'NOT_FOUND', code: 'NOT_FOUND' };
      }
      const data = snap.data() as any;
      let bars: CompactBar[] = Array.isArray(data?.bars) ? data.bars : [];
      logger.debug('reader.monthly.loaded', { allDocPath, count: bars.length });
      // Filter and sort ascending
      bars = bars.filter(b => (from == null || b.t >= from) && (to == null || b.t <= to)).sort((a, b) => a.t - b.t);
      logger.debug('reader.monthly.filtered', { from, to, count: bars.length });
      // Enrich with ch/cp if missing
      if (bars.length && (bars[0].ch == null || bars[0].cp == null)) {
        bars = enrichWithChange(bars);
      }
      let truncated = false;
      if (typeof params.limit === 'number' && params.limit > 0 && bars.length > params.limit) {
        truncated = true;
        bars = bars.slice(-params.limit);
      }
      logger.debug('reader.monthly.done', { truncated, finalCount: bars.length });
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
    logger.debug('reader.metaDoc', { docPath, exists: metaSnap.exists });
    if (!metaSnap.exists) {
      return { ok: false, symbol, interval, provider: 'av', endpointDocId: docPath.split('/').pop()!, rangeUsed: { from, to, preset: presetApplied }, count: 0, bars: [], timestamp: new Date().toISOString(), error: 'NOT_FOUND', code: 'NOT_FOUND' };
    }
    const meta = metaSnap.data() as any;
    logger.debug('reader.meta', {
      hasMeta: !!meta,
      histStartTs: meta?.metadata?.histStartTs ?? meta?.histStartTs,
      latestBarTimestamp: meta?.metadata?.latestBarTimestamp ?? meta?.latestBarTimestamp,
    });

    // Determine bounds from metadata (preferred) and clamp requested range
    const lowerBoundMs: number | undefined = Number(meta?.metadata?.histStartTs ?? meta?.histStartTs ?? undefined);
    // Use numeric histEndTs from metadata; latestBarTimestamp is a Firestore Timestamp object
    const upperBoundMs: number | undefined = Number(meta?.metadata?.histEndTs ?? meta?.histEndTs ?? undefined);

    // Start with requested years (from/to already resolved above)
    let fromYear = from != null ? new Date(from).getUTCFullYear() : undefined;
    let toYear = to != null ? new Date(to).getUTCFullYear() : undefined;

    // If bounds exist, use them as defaults and clamps
    if (fromYear == null && lowerBoundMs != null) fromYear = new Date(lowerBoundMs).getUTCFullYear();
    if (toYear == null && upperBoundMs != null) toYear = new Date(upperBoundMs).getUTCFullYear();
    if (lowerBoundMs != null && fromYear != null) {
      const lbYear = new Date(lowerBoundMs).getUTCFullYear();
      if (fromYear < lbYear) fromYear = lbYear;
    }
    if (upperBoundMs != null && toYear != null) {
      const ubYear = new Date(upperBoundMs).getUTCFullYear();
      if (toYear > ubYear) toYear = ubYear;
    }

    // If still undefined (no bounds and no explicit range), derive from preset defaults
    if (fromYear == null || toYear == null) {
      const nowYear = new Date(nowMs).getUTCFullYear();
      // Conservative default windows mirror presets: DAILY=1y, WEEKLY=5y, MONTHLY=all (handled earlier)
      const defaultSpanYears = interval === TimeSeriesInterval.WEEKLY ? 5 : 1;
      toYear = toYear ?? nowYear;
      fromYear = fromYear ?? (toYear - defaultSpanYears);
    }

    // Correct any inverted window after clamping (defensive)
    if (fromYear != null && toYear != null && fromYear > toYear) {
      logger.warn('reader.yearOrder.corrected', { fromYear, toYear, reason: 'inverted_after_clamp' });
      const tmp = fromYear; fromYear = toYear; toYear = tmp;
    }

    // Generate inclusive list of years to read
    const yearsToRead: number[] = [];
    if (fromYear != null && toYear != null && fromYear <= toYear) {
      for (let y = fromYear; y <= toYear; y++) yearsToRead.push(y);
    }
    logger.debug('reader.yearsToRead', { fromYear, toYear, yearsToRead });

    // Fetch all year docs in parallel
    const yearRefs = yearsToRead.map(y => db.doc(getSymbolTimeSeriesYearDocPath(symbol, endpoint, vendor, y)));
    logger.debug('reader.yearDocs', { yearRefs });
    const yearSnaps = await Promise.all(yearRefs.map(r => r.get()));

    let allBars: CompactBar[] = [];
    const existingYears: number[] = [];
    for (const s of yearSnaps) {
      const yearId = Number(s.ref.id);
      logger.debug('reader.yearDoc', { path: s.ref.path, yearId, exists: s.exists });
      if (!s.exists) {
        logger.debug('reader.year.missing', { path: s.ref.path, yearId });
        continue;
      }
      const d = s.data() as any;
      const yBars: CompactBar[] = Array.isArray(d?.bars) ? d.bars : [];
      logger.debug('reader.year.loaded', { path: s.ref.path, yearId, count: yBars.length, firstBarTs: d?.firstBarTs, lastBarTs: d?.lastBarTs });
      allBars.push(...yBars);
      if (!Number.isNaN(yearId)) existingYears.push(yearId);
    }
    logger.debug('reader.yearsLoaded', { existingYears, preFilterCount: allBars.length });

    // Filter and sort ascending
    let bars = allBars.filter(b => (from == null || b.t >= from) && (to == null || b.t <= to)).sort((a, b) => a.t - b.t);
    logger.debug('reader.postFilter', { from, to, count: bars.length });

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
    logger.debug('reader.done', { truncated, finalCount: bars.length });

    return {
      ok: true,
      symbol,
      interval,
      provider: 'av',
      endpointDocId: docPath.split('/').pop()!,
      rangeUsed: { from, to, preset: presetApplied },
      availableYears: existingYears.length ? existingYears : undefined,
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
    const curr = (typeof b.ac === 'number' ? b.ac : b.c);
    const ch = (idx === 0 || prevClose == null || curr == null) ? 0 : Number((curr - prevClose).toFixed(2));
    const cp = (idx === 0 || prevClose == null || prevClose === 0 || curr == null) ? 0 : Number((((curr - prevClose) / prevClose) * 100).toFixed(2));
    prevClose = curr ?? prevClose;
    return { ...b, ch, cp } as CompactBar;
  });
}
