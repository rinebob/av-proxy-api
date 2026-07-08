/**
 * @deprecated
 * This window-aware, non-destructive AV time-series backfill script is
 * superseded by the v2 time-series job pipeline and the
 * triggerFullBackfillJobs/processFullBackfillRunTask entry points. It remains
 * checked in for historical reference but should not be invoked for new
 * backfills.
 *
 * Window-aware, non-destructive AV time-series backfill.
 *
 * Semantics per symbol/interval:
 * - Define a date window [BACKFILL_FROM, BACKFILL_TO] (TO optional).
 * - Delete any existing bars whose trading date falls inside the window.
 * - Re-fetch bars for that interval from Alpha Vantage and rewrite only the
 *   bars in that window using AV as source of truth.
 * - Preserve all bars strictly outside the window (no destructive delete
 *   outside the window).
 *
 * Supported intervals (via INTERVALS env var): DAILY, WEEKLY, MONTHLY.
 *
 * Environment variables:
 *   BACKFILL_ID=BF_TS_DAILY_2025-01-02_TO_TODAY_ALL_20260109T1700
 *                                  // required; identifies a logical resumable run
 *   BACKFILL_FROM=YYYY-MM-DD       // required lower bound (inclusive)
 *   BACKFILL_TO=YYYY-MM-DD         // optional upper bound (inclusive); when omitted, treated as "today"
 *   SYMBOLS=NVDA,QQQ,AAPL          // optional explicit list; otherwise uses all tracked symbols
 *   INTERVALS=DAILY,WEEKLY,MONTHLY // optional; default DAILY,WEEKLY,MONTHLY
 *   DRY_RUN=1                      // when set, log actions but do not write
 *   DELAY_MS=1000                  // optional delay between symbols
 *   USE_FIRESTORE_EMULATOR=1       // when set, use Firestore emulator
 */

// Optional: configure Firestore emulator when explicitly requested via env.
// When USE_FIRESTORE_EMULATOR is not '1', this script will talk to the
// default Firestore project using ADC (prod or whatever gcloud is pointing to).
if (process.env.USE_FIRESTORE_EMULATOR === '1') {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  require('./scripts-util').setupEmulator();
}

import axios from 'axios';
import { db } from '../../src/firebase-admin-init';

import {
  AlphaVantageEndpoint,
  OutputSize,
} from '@shared/alpha-vantage';
import { ApiProvider } from '@shared/core';
import { FirestoreCollection } from '@shared/firestore';
import {
  getSymbolTimeSeriesYearDocPath,
  getSymbolTimeSeriesAllDocPath,
} from '../../src/v2/common/firestore/firestore-paths';

import type { CompactBar } from '@shared/alpha-vantage';

interface StorageBar {
  date: string;          // YYYY-MM-DD
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  adjustedClose?: number;
  dividendAmount?: number;
  splitCoefficient?: number;
}

type IntervalId = 'DAILY' | 'WEEKLY' | 'MONTHLY';

interface BackfillRunHistoryEntry {
  startedAt: Date;
  endedAt?: Date;
  reason: 'kickoff' | 'restart' | 'manual';
  startingSymbol: string | null;
  exitStatus?: 'ok';
}

interface BackfillRun {
  backfillRunId: string;
  createdAt: Date;
  updatedAt: Date;

  intervals: IntervalId[];
  backfillFrom: string;
  backfillTo: string | null;
  dryRun: boolean;
  delayMs: number;
  scope: 'all' | 'partial';

  allSymbols: string[];
  cursorIndex: number;
  totalSymbols: number;
  processedCount: number;
  lastSymbolProcessed: string | null;

  status: 'PENDING' | 'RUNNING' | 'COMPLETED' | 'FAILED';
  lastError?: string;

  history: BackfillRunHistoryEntry[];
}

function log(...args: any[]): void {
  // eslint-disable-next-line no-console
  console.log('[backfill-timeseries-window]', ...args);
}

function sleep(ms: number): Promise<void> {
  return new Promise((res) => setTimeout(res, ms));
}

function getRequiredEnv(name: string): string {
  const v = String(process.env[name] || '').trim();
  if (!v) {
    throw new Error(`Missing required env var: ${name}`);
  }
  return v;
}

function parseOptionalDateEnv(name: string): string | null {
  const raw = String(process.env[name] || '').trim();
  if (!raw) return null;
  if (!/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(raw)) {
    throw new Error(`Invalid ${name} format, expected YYYY-MM-DD, got: ${raw}`);
  }
  return raw;
}

function inWindow(date: string, from: string, to: string | null): boolean {
  if (date < from) return false;
  if (to && date > to) return false;
  return true;
}

async function getTrackedSymbols(): Promise<string[]> {
  const snap = await db.collection(FirestoreCollection.TRACKED_SYMBOLS).get();
  return snap.docs.map((d) => d.id.toUpperCase());
}

function getBackfillId(): string {
  const raw = String(process.env.BACKFILL_ID || '').trim();
  if (!raw) {
    throw new Error('Missing required env var: BACKFILL_ID');
  }
  if (!raw.startsWith('BF_TS_')) {
    log('WARNING: BACKFILL_ID does not follow recommended format BF_TS_<...>. Got:', raw);
  }
  return raw;
}

function getAvKey(): string {
  if (process.env.FUNCTIONS_EMULATOR === 'true' && process.env.LOCAL_EMULATOR_ALPHAVANTAGE_API_KEY) {
    return process.env.LOCAL_EMULATOR_ALPHAVANTAGE_API_KEY;
  }
  const key = process.env.ALPHAVANTAGE_API_KEY;
  if (!key) throw new Error('ALPHAVANTAGE_API_KEY not set');
  return key;
}

async function fetchFromAlphaVantage(
  endpoint: AlphaVantageEndpoint,
  symbol: string,
  outputsize: OutputSize,
): Promise<any> {
  const apikey = getAvKey();
  const url = 'https://www.alphavantage.co/query';
  let func: string;
  switch (endpoint) {
    case AlphaVantageEndpoint.TIME_SERIES_DAILY_ADJUSTED:
      func = 'TIME_SERIES_DAILY_ADJUSTED';
      break;
    case AlphaVantageEndpoint.TIME_SERIES_WEEKLY_ADJUSTED:
      func = 'TIME_SERIES_WEEKLY_ADJUSTED';
      break;
    case AlphaVantageEndpoint.TIME_SERIES_MONTHLY_ADJUSTED:
      func = 'TIME_SERIES_MONTHLY_ADJUSTED';
      break;
    default:
      throw new Error(`Unsupported endpoint for window backfill: ${endpoint}`);
  }

  const params: Record<string, string> = {
    function: func,
    symbol,
    apikey,
    outputsize,
    datatype: 'json',
  };

  const resp = await axios.get(url, { params, timeout: 20000 });
  return resp.data;
}

// NOTE: These normalizers intentionally only use the OHLCV + adjusted fields
// we care about for persistence. They are aligned with AV docs.

function normalizeDaily(data: any): StorageBar[] {
  const ts = data['Time Series (Daily)']
    || data['Time Series (Daily - Adjusted)']
    || data['Time Series (Digital Currency Daily)'];
  if (!ts || typeof ts !== 'object') return [];
  const bars: StorageBar[] = [];
  for (const [date, rawAny] of Object.entries<any>(ts)) {
    const raw = rawAny as Record<string, string>;
    const ac = raw['5. adjusted close'];
    const dv = raw['7. dividend amount'];
    const sc = raw['8. split coefficient'];
    bars.push({
      date,
      open: Number(raw['1. open']),
      high: Number(raw['2. high']),
      low: Number(raw['3. low']),
      close: Number(raw['4. close']),
      volume: Number(raw['6. volume'] ?? raw['5. volume']),
      adjustedClose: ac != null ? Number(ac) : undefined,
      dividendAmount: dv != null ? Number(dv) : undefined,
      splitCoefficient: sc != null ? Number(sc) : undefined,
    });
  }
  return bars;
}

function normalizeWeekly(data: any): StorageBar[] {
  const ts = data['Weekly Adjusted Time Series'] || data['Weekly Time Series'];
  if (!ts || typeof ts !== 'object') return [];
  const bars: StorageBar[] = [];
  for (const [date, rawAny] of Object.entries<any>(ts)) {
    const raw = rawAny as Record<string, string>;
    const ac = raw['5. adjusted close'] ?? raw['5. adjusted close ']; // handle minor schema quirks
    const dv = raw['7. dividend amount'];
    const sc = raw['8. split coefficient'];
    bars.push({
      date,
      open: Number(raw['1. open']),
      high: Number(raw['2. high']),
      low: Number(raw['3. low']),
      close: Number(raw['4. close']),
      volume: Number(raw['6. volume'] ?? raw['5. volume']),
      adjustedClose: ac != null ? Number(ac) : undefined,
      dividendAmount: dv != null ? Number(dv) : undefined,
      splitCoefficient: sc != null ? Number(sc) : undefined,
    });
  }
  return bars;
}

function normalizeMonthly(data: any): StorageBar[] {
  const ts = data['Monthly Adjusted Time Series'] || data['Monthly Time Series'];
  if (!ts || typeof ts !== 'object') return [];
  const bars: StorageBar[] = [];
  for (const [date, rawAny] of Object.entries<any>(ts)) {
    const raw = rawAny as Record<string, string>;
    const ac = raw['5. adjusted close'];
    const dv = raw['7. dividend amount'];
    const sc = raw['8. split coefficient'];
    bars.push({
      date,
      open: Number(raw['1. open']),
      high: Number(raw['2. high']),
      low: Number(raw['3. low']),
      close: Number(raw['4. close']),
      volume: Number(raw['6. volume'] ?? raw['5. volume']),
      adjustedClose: ac != null ? Number(ac) : undefined,
      dividendAmount: dv != null ? Number(dv) : undefined,
      splitCoefficient: sc != null ? Number(sc) : undefined,
    });
  }
  return bars;
}

function pickOutputSize(interval: IntervalId, from: string, to: string | null): OutputSize {
  const fromDate = new Date(`${from}T00:00:00.000Z`);
  const toDate = new Date(`${(to || new Date().toISOString().slice(0, 10))}T00:00:00.000Z`);
  const ms = toDate.getTime() - fromDate.getTime();
  const days = ms / (1000 * 60 * 60 * 24);
  switch (interval) {
    case 'DAILY':
      return days <= 100 ? OutputSize.COMPACT : OutputSize.FULL;
    case 'WEEKLY': {
      const weeks = days / 7;
      return weeks <= 100 ? OutputSize.COMPACT : OutputSize.FULL;
    }
    case 'MONTHLY': {
      const months = days / 30;
      return months <= 100 ? OutputSize.COMPACT : OutputSize.FULL;
    }
    default:
      return OutputSize.FULL;
  }
}

// ---- DAILY window writer ----
// We rely on the fact that daily has at most one bar per date; overwriting
// via upsert semantics is equivalent to delete+insert for that date.

async function applyDailyWindow(
  symbol: string,
  from: string,
  to: string | null,
  bars: StorageBar[],
  dryRun: boolean,
): Promise<void> {
  const inRange = bars
    .filter((b) => inWindow(b.date, from, to))
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));

  if (inRange.length === 0) {
    log(`DAILY window empty for ${symbol} [${from}, ${to || '...'}], skipping`);
    return;
  }

  if (dryRun) {
    log(`DRY_RUN DAILY window for ${symbol}: ${inRange[0].date} ... ${inRange[inRange.length - 1].date} count=${inRange.length}`);
    return;
  }

  for (const b of inRange) {
    const t = new Date(`${b.date}T00:00:00.000Z`).getTime();
    if (!Number.isFinite(t)) continue;
    // Per-date overwrite semantics == delete+insert for that bar.
    await (await import('../../src/v2/alpha-vantage/firestore/av-daily-bar.writer')).upsertAvDailyBar({
      symbol,
      date: b.date,
      patch: {
        o: b.open,
        h: b.high,
        l: b.low,
        c: b.close,
        v: b.volume,
        ac: b.adjustedClose,
        dv: b.dividendAmount,
        sc: b.splitCoefficient,
      } as Partial<CompactBar>,
    });
  }

  log(`DAILY window applied for ${symbol}: ${inRange[0].date} ... ${inRange[inRange.length - 1].date} count=${inRange.length}`);
}

// ---- WEEKLY window writer ----
// Custom logic: delete existing weekly bars with d in [from,to], then insert
// AV bars for that window, preserving everything else (before and after).

async function applyWeeklyWindow(
  symbol: string,
  from: string,
  to: string | null,
  bars: StorageBar[],
  dryRun: boolean,
): Promise<void> {
  const vendor = ApiProvider.ALPHA_VANTAGE;
  const windowBars = bars
    .filter((b) => inWindow(b.date, from, to))
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));

  if (windowBars.length === 0) {
    log(`WEEKLY window empty for ${symbol} [${from}, ${to || '...'}], skipping`);
    return;
  }

  if (dryRun) {
    log(`DRY_RUN WEEKLY window for ${symbol}: ${windowBars[0].date} ... ${windowBars[windowBars.length - 1].date} count=${windowBars.length}`);
    return;
  }

  // Collect affected years
  const years = new Set<number>();
  for (const b of windowBars) {
    const ts = new Date(`${b.date}T00:00:00.000Z`).getTime();
    if (!Number.isFinite(ts)) continue;
    years.add(new Date(ts).getUTCFullYear());
  }

  for (const isSplitAdjusted of [false, true]) {
    for (const year of years) {
      const yearDocPath = getSymbolTimeSeriesYearDocPath(
        symbol,
        AlphaVantageEndpoint.TIME_SERIES_WEEKLY_ADJUSTED,
        vendor,
        year,
        isSplitAdjusted,
      );
      const ref = db.doc(yearDocPath);
      const snap = await ref.get();
      const existing: CompactBar[] = snap.exists ? ((snap.get('bars') ?? []) as CompactBar[]) : [];

      // Filter out bars in window
      const kept: CompactBar[] = existing.filter((bar) => {
        const dStr = typeof bar.d === 'string' && bar.d.length >= 10
          ? bar.d.slice(0, 10)
          : (typeof bar.t === 'number' ? new Date(bar.t).toISOString().slice(0, 10) : '');
        if (!dStr) return false;
        return !inWindow(dStr, from, to);
      });

      // Add AV bars for this year
      const yearBars = windowBars.filter((b) => {
        const ts = new Date(`${b.date}T00:00:00.000Z`).getTime();
        if (!Number.isFinite(ts)) return false;
        return new Date(ts).getUTCFullYear() === year;
      });

      for (const b of yearBars) {
        const t = new Date(`${b.date}T00:00:00.000Z`).getTime();
        if (!Number.isFinite(t)) continue;
        const dStr = new Date(t).toISOString().slice(0, 10);
        const idx = kept.findIndex((k) => (typeof k.d === 'string' && k.d.slice(0, 10) === dStr) || k.t === t);
        const base = idx >= 0 ? kept[idx] : ({} as CompactBar);
        const merged: CompactBar = {
          ...(base as CompactBar),
          t,
          d: dStr,
          o: b.open,
          h: b.high,
          l: b.low,
          c: b.close,
          v: b.volume,
          ac: b.adjustedClose != null ? b.adjustedClose : base.ac,
          dv: b.dividendAmount != null ? b.dividendAmount : base.dv,
          sc: b.splitCoefficient != null ? b.splitCoefficient : base.sc,
        };
        if (idx >= 0) kept[idx] = merged;
        else kept.push(merged);
      }

      if (kept.length === 0) {
        await ref.delete().catch(() => undefined);
        continue;
      }

      kept.sort((a, b) => a.t - b.t);
      const latest = kept[kept.length - 1];
      await ref.set({
        bars: kept,
        count: kept.length,
        firstBarTs: kept[0].t,
        lastBarTs: latest.t,
        latest,
        updatedAt: new Date(),
      }, { merge: true });
    }
  }

  log(`WEEKLY window applied for ${symbol}: ${windowBars[0].date} ... ${windowBars[windowBars.length - 1].date} count=${windowBars.length}`);
}

// ---- MONTHLY window writer ----
// Similar semantics: delete months in [from,to], then insert AV bars for that window.

async function applyMonthlyWindow(
  symbol: string,
  from: string,
  to: string | null,
  bars: StorageBar[],
  dryRun: boolean,
): Promise<void> {
  const vendor = ApiProvider.ALPHA_VANTAGE;
  const windowBars = bars
    .filter((b) => inWindow(b.date, from, to))
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));

  if (windowBars.length === 0) {
    log(`MONTHLY window empty for ${symbol} [${from}, ${to || '...'}], skipping`);
    return;
  }

  if (dryRun) {
    log(`DRY_RUN MONTHLY window for ${symbol}: ${windowBars[0].date} ... ${windowBars[windowBars.length - 1].date} count=${windowBars.length}`);
    return;
  }

  for (const isSplitAdjusted of [false, true]) {
    const allDocPath = getSymbolTimeSeriesAllDocPath(
      symbol,
      AlphaVantageEndpoint.TIME_SERIES_MONTHLY_ADJUSTED,
      vendor,
      isSplitAdjusted,
    );
    const ref = db.doc(allDocPath);
    const snap = await ref.get();
    const existing: CompactBar[] = snap.exists ? ((snap.get('bars') ?? []) as CompactBar[]) : [];

    const kept: CompactBar[] = existing.filter((bar) => {
      const dStr = typeof bar.d === 'string' && bar.d.length >= 10
        ? bar.d.slice(0, 10)
        : (typeof bar.t === 'number' ? new Date(bar.t).toISOString().slice(0, 10) : '');
      if (!dStr) return false;
      return !inWindow(dStr, from, to);
    });

    for (const b of windowBars) {
      const t = new Date(`${b.date}T00:00:00.000Z`).getTime();
      if (!Number.isFinite(t)) continue;
      const dStr = new Date(t).toISOString().slice(0, 10);
      const idx = kept.findIndex((k) => (typeof k.d === 'string' && k.d.slice(0, 10) === dStr) || k.t === t);
      const base = idx >= 0 ? kept[idx] : ({} as CompactBar);
      const merged: CompactBar = {
        ...(base as CompactBar),
        t,
        d: dStr,
        o: b.open,
        h: b.high,
        l: b.low,
        c: b.close,
        v: b.volume,
        ac: b.adjustedClose != null ? b.adjustedClose : base.ac,
        dv: b.dividendAmount != null ? b.dividendAmount : base.dv,
        sc: b.splitCoefficient != null ? b.splitCoefficient : base.sc,
      };
      if (idx >= 0) kept[idx] = merged;
      else kept.push(merged);
    }

    if (kept.length === 0) {
      await ref.delete().catch(() => undefined);
      continue;
    }

    kept.sort((a, b) => a.t - b.t);
    const latest = kept[kept.length - 1];
    await ref.set({
      bars: kept,
      count: kept.length,
      firstBarTs: kept[0].t,
      lastBarTs: latest.t,
      latest,
      updatedAt: new Date(),
    }, { merge: true });
  }

  log(`MONTHLY window applied for ${symbol}: ${windowBars[0].date} ... ${windowBars[windowBars.length - 1].date} count=${windowBars.length}`);
}

// ---- MAIN ORCHESTRATION ----

async function main(): Promise<void> {
  const backfillRunId = getBackfillId();

  const from = getRequiredEnv('BACKFILL_FROM');
  if (!/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(from)) {
    throw new Error(`Invalid BACKFILL_FROM format: ${from}`);
  }
  const to = parseOptionalDateEnv('BACKFILL_TO');
  const dryRun = String(process.env.DRY_RUN || '').trim() === '1';
  const delayMs = Number(process.env.DELAY_MS || 2500);

  const intervalsEnv = String(process.env.INTERVALS || '').trim();
  const intervals: IntervalId[] = (intervalsEnv || 'DAILY,WEEKLY,MONTHLY')
    .split(',')
    .map((s) => s.trim().toUpperCase())
    .filter((s) => !!s) as IntervalId[];

  const symbolsEnv = String(process.env.SYMBOLS || '').trim();
  const explicitSymbols = symbolsEnv
    ? symbolsEnv.split(',').map((s) => s.trim().toUpperCase()).filter(Boolean)
    : null;
  const scope: 'all' | 'partial' = explicitSymbols ? 'partial' : 'all';

  // Determine universe snapshot for this logical run.
  const universeSymbols = explicitSymbols || await getTrackedSymbols();
  const allSymbols = [...universeSymbols].sort();

  const runRef = db
    .collection(FirestoreCollection.SYSTEM)
    .doc(FirestoreCollection.BACKFILL_RUNS)
    .collection(FirestoreCollection.RUNS)
    .doc(backfillRunId);

  const now = new Date();

  const existingSnap = await runRef.get();
  let run: BackfillRun;

  if (!existingSnap.exists) {
    // First-ever kickoff for this BACKFILL_ID.
    const startingSymbol = allSymbols.length > 0 ? allSymbols[0] : null;
    const history: BackfillRunHistoryEntry[] = [{
      startedAt: now,
      reason: 'kickoff',
      startingSymbol,
    }];

    run = {
      backfillRunId,
      createdAt: now,
      updatedAt: now,
      intervals,
      backfillFrom: from,
      backfillTo: to,
      dryRun,
      delayMs,
      scope,
      allSymbols,
      cursorIndex: -1,
      totalSymbols: allSymbols.length,
      processedCount: 0,
      lastSymbolProcessed: null,
      status: 'RUNNING',
      history,
    };

    await runRef.set(run);
  } else {
    // Resume or manual re-run for an existing BACKFILL_ID.
    const data = existingSnap.data() as BackfillRun;

    // Basic parameter sanity check: prevent accidental reuse with different core params.
    if (data.backfillFrom !== from || (data.backfillTo || null) !== (to || null)) {
      throw new Error(`BACKFILL_ID ${backfillRunId} exists with different window [${data.backfillFrom}, ${data.backfillTo}]`);
    }

    // Prefer persisted universe snapshot; fall back to newly computed allSymbols if missing for any reason.
    const persistedSymbols = Array.isArray(data.allSymbols) && data.allSymbols.length > 0
      ? data.allSymbols
      : allSymbols;

    const startingIndex = typeof data.cursorIndex === 'number' ? data.cursorIndex + 1 : 0;
    const startingSymbol = startingIndex < persistedSymbols.length ? persistedSymbols[startingIndex] : null;

    const history: BackfillRunHistoryEntry[] = Array.isArray(data.history) ? [...data.history] : [];
    history.push({
      startedAt: now,
      reason: 'restart',
      startingSymbol,
    });

    run = {
      ...data,
      intervals,
      backfillFrom: from,
      backfillTo: to,
      dryRun,
      delayMs,
      scope,
      allSymbols: persistedSymbols,
      status: 'RUNNING',
      updatedAt: now,
      history,
    };

    await runRef.set({
      intervals: run.intervals,
      backfillFrom: run.backfillFrom,
      backfillTo: run.backfillTo,
      dryRun: run.dryRun,
      delayMs: run.delayMs,
      scope: run.scope,
      allSymbols: run.allSymbols,
      cursorIndex: run.cursorIndex ?? -1,
      totalSymbols: run.totalSymbols,
      processedCount: run.processedCount ?? 0,
      lastSymbolProcessed: run.lastSymbolProcessed ?? null,
      status: run.status,
      updatedAt: run.updatedAt,
      history: run.history,
    }, { merge: true });
  }

  const symbols = run.allSymbols;
  const initialCursorIndex = typeof run.cursorIndex === 'number' ? run.cursorIndex : -1;
  let cursorIndex = initialCursorIndex;
  let processedCount = typeof run.processedCount === 'number' ? run.processedCount : 0;
  let lastSymbolProcessed = run.lastSymbolProcessed ?? null;

  let hadErrors = false;

  const intervalsUsed = new Set<IntervalId>();

  const writeEvery = 5;

  log('preflight', {
    backfillRunId,
    from,
    to: to || null,
    intervals,
    symbolsScope: scope === 'partial' ? `subset[${symbols.length}]` : `ALL tracked (${symbols.length})`,
    dryRun,
    delayMs,
    totalSymbols: symbols.length,
  });

  for (let i = cursorIndex + 1; i < symbols.length; i++) {
    const symbol = symbols[i];
    log(`\n[${i + 1}/${symbols.length}] SYMBOL ${symbol}`);

    try {
      // DAILY
      if (intervals.includes('DAILY')) {
        const os = pickOutputSize('DAILY', from, to);
        const raw = await fetchFromAlphaVantage(
          AlphaVantageEndpoint.TIME_SERIES_DAILY_ADJUSTED,
          symbol,
          os,
        );
        const bars = normalizeDaily(raw);
        if (bars.length > 0) {
          intervalsUsed.add('DAILY');
        }
        await applyDailyWindow(symbol, from, to, bars, dryRun);
      }

      // WEEKLY
      if (intervals.includes('WEEKLY')) {
        const os = pickOutputSize('WEEKLY', from, to);
        const raw = await fetchFromAlphaVantage(
          AlphaVantageEndpoint.TIME_SERIES_WEEKLY_ADJUSTED,
          symbol,
          os,
        );
        const bars = normalizeWeekly(raw);
        if (bars.length > 0) {
          intervalsUsed.add('WEEKLY');
        }
        await applyWeeklyWindow(symbol, from, to, bars, dryRun);
      }

      // MONTHLY
      if (intervals.includes('MONTHLY')) {
        const os = pickOutputSize('MONTHLY', from, to);
        const raw = await fetchFromAlphaVantage(
          AlphaVantageEndpoint.TIME_SERIES_MONTHLY_ADJUSTED,
          symbol,
          os,
        );
        const bars = normalizeMonthly(raw);
        if (bars.length > 0) {
          intervalsUsed.add('MONTHLY');
        }
        await applyMonthlyWindow(symbol, from, to, bars, dryRun);
      }
    } catch (e: any) {
      log(`ERROR for ${symbol}:`, e?.message || e);
      hadErrors = true;
    }

    // Update in-memory progress.
    cursorIndex = i;
    processedCount += 1;
    lastSymbolProcessed = symbol;

    // Periodic durable progress flush to Firestore.
    if (processedCount % writeEvery === 0) {
      await runRef.set({
        cursorIndex,
        processedCount,
        lastSymbolProcessed,
        updatedAt: new Date(),
      }, { merge: true });
    }

    if (delayMs > 0 && i < symbols.length - 1) {
      await sleep(delayMs);
    }
  }

  // Clean completion: mark run as COMPLETED and close out latest history entry.
  const finalSnap = await runRef.get();
  const finalData = finalSnap.data() as BackfillRun | undefined;
  let finalHistory: BackfillRunHistoryEntry[] = (finalData && Array.isArray(finalData.history)) ? [...finalData.history] : [];
  if (finalHistory.length > 0) {
    const lastIdx = finalHistory.length - 1;
    finalHistory[lastIdx] = {
      ...finalHistory[lastIdx],
      endedAt: new Date(),
      exitStatus: 'ok',
    };
  }

  await runRef.set({
    cursorIndex,
    processedCount,
    lastSymbolProcessed,
    status: 'COMPLETED',
    updatedAt: new Date(),
    history: finalHistory,
  }, { merge: true });

  // Update aggregate container doc for this tool under system/backfill-runs.
  const containerRef = db
    .collection(FirestoreCollection.SYSTEM)
    .doc(FirestoreCollection.BACKFILL_RUNS);

  await containerRef.set({
    mostRecent: backfillRunId,
    status: hadErrors ? 'COMPLETED_WITH_ERRORS' : 'COMPLETED',
    runFinished: new Date().toISOString(),
    totalSymbols: symbols.length,
    intervals: Array.from(intervalsUsed),
  }, { merge: true });

  log('window backfill complete');
}

main().catch((e) => {
  // eslint-disable-next-line no-console
  console.error('[backfill-timeseries-window] fatal', e?.message || e);
  process.exitCode = 1;
});