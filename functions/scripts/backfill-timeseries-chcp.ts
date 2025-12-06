// Usage examples:
//   npx ts-node -r tsconfig-paths/register -r module-alias/register functions/scripts/backfill-timeseries-chcp.ts --dry-run
//   npx ts-node -r tsconfig-paths/register -r module-alias/register functions/scripts/backfill-timeseries-chcp.ts --interval daily
//   npx ts-node -r tsconfig-paths/register -r module-alias/register functions/scripts/backfill-timeseries-chcp.ts --symbol AAPL --repair-metadata
//   npx ts-node -r tsconfig-paths/register -r module-alias/register functions/scripts/backfill-timeseries-chcp.ts --emulator=false
//   npx ts-node -r tsconfig-paths/register -r module-alias/register functions/scripts/backfill-timeseries-chcp.ts --inventory
//
// Notes:
// - Ensures AV time-series existence (daily/weekly/monthly) and upgrades stored bars to latest compact schema.
// - Enrichment: adds d (YYYY-MM-DD UTC), ch (change), cp (percent change), with 2-decimal rounding.
// - Baseline: prefer adjusted close (ac) over close (c). If baseline is missing or zero, omit ch/cp.
// - Writes updates only when needed; supports --dry-run.

// IMPORTANT: configure emulators before importing any module that might touch firebase-admin-init.
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { setupEmulator } = require('./scripts-util');
setupEmulator();

import * as dotenv from 'dotenv';
import * as path from 'path';

// Load local .env if present
dotenv.config({ path: path.resolve(__dirname, '..', '.env.alpha-vantage-proxy-api') });

import type { Firestore } from 'firebase-admin/firestore';
import { FirestoreCollection } from '@shared/firestore';
import { ApiProvider } from '@shared/core';
import { AlphaVantageEndpoint, TimeSeriesInterval } from '@shared/alpha-vantage';
import { AlphaVantageHandlerFactory } from '../src/v2/alpha-vantage/alpha-vantage-factory';
import {
  getSymbolTimeSeriesDocPath,
  getSymbolTimeSeriesYearDocPath,
  getSymbolTimeSeriesAllDocPath,
} from '../src/v2/common/firestore/firestore-paths';
import { initializeTimeSeriesIfMissing } from '../src/v2/alpha-vantage/firestore/av-firestore-helper';
import { writeFileSync } from 'node:fs';

interface DateDowBar {
  t: number;
  d?: string;
  dow?: string;
}

interface EnrichableBar extends DateDowBar {
  c?: number;
  ch?: number;
  cp?: number;
}

// ---------- CLI args ----------
const argv = process.argv.slice(2);
const argMap = new Map<string, string | boolean>();
for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  if (a.startsWith('--')) {
    const [k, v] = a.split('=');
    if (typeof v === 'string') argMap.set(k, v);
    else if (argv[i + 1] && !argv[i + 1].startsWith('--')) argMap.set(k, argv[++i]);
    else argMap.set(k, true);
  }
}

// Emulator toggle (default true). Pass --emulator=false to target PROD (no emulators)
const EMULATOR_RAW = argMap.get('--emulator');
const USE_EMULATOR = EMULATOR_RAW === undefined
  ? true
  : !(String(EMULATOR_RAW).toLowerCase() === 'false' || String(EMULATOR_RAW) === '0');

// Configure environment (must occur BEFORE initializing firebase-admin)
if (USE_EMULATOR) {
  if (!process.env['FIRESTORE_EMULATOR_HOST']) {
    setupEmulator();
  }
  console.log('fn scripts setupEmulator - Using Firebase Emulators');
} else {
  delete (process.env as any)['FIREBASE_AUTH_EMULATOR_HOST'];
  delete (process.env as any)['FIRESTORE_EMULATOR_HOST'];
  console.log('fn scripts - Using PROD Firestore (no emulators)');
}

// Initialize firebase-admin after env is set up
let db: Firestore;
{
  // Using require here to avoid early module init before env setup
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const adminInit = require('../src/firebase-admin-init');
  db = adminInit.db as Firestore;
}

const SYMBOL_FILTER = (argMap.get('--symbol') as string | undefined)?.toUpperCase();
const INTERVAL_FILTER = (argMap.get('--interval') as string | undefined)?.toLowerCase() as ('daily'|'weekly'|'monthly'|undefined);
const YEAR_FILTER_RAW = (argMap.get('--year') ?? argMap.get('-y')) as string | undefined;
const YEAR_FILTER = YEAR_FILTER_RAW != null && YEAR_FILTER_RAW.trim() !== '' && !Number.isNaN(Number(YEAR_FILTER_RAW))
  ? Number(YEAR_FILTER_RAW)
  : undefined;
const DRY_RUN = Boolean(argMap.get('--dry-run'));
const REPAIR_METADATA = Boolean(argMap.get('--repair-metadata'));
const INVENTORY_MODE = Boolean(argMap.get('--inventory') ?? argMap.get('--audit'));
const INVENTORY_VERBOSE = Boolean(argMap.get('--inventory-verbose') ?? argMap.get('--audit-verbose'));
const INVENTORY_OUT = (argMap.get('--inventory-out') as string | undefined);
const INVENTORY_ONLY_ISSUES = Boolean(argMap.get('--inventory-only-issues') ?? argMap.get('--inventory-issues-only'));
const FORCE_REFETCH = Boolean(argMap.get('--force-refetch'));
const RECOMPUTE_PAIRS = Boolean(argMap.get('--recompute-pairs'));
const BASELINE_ARG = (argMap.get('--baseline') as string | undefined) ?? 'ALL';
const DATE_FROM = (argMap.get('--dateFrom') as string | undefined);
const DATE_TO = (argMap.get('--dateTo') as string | undefined);

function endpointsForInterval(interval?: 'daily'|'weekly'|'monthly'): { ep: AlphaVantageEndpoint; iv: TimeSeriesInterval }[] {
  if (!interval) {
    return [
      { ep: AlphaVantageEndpoint.TIME_SERIES_DAILY_ADJUSTED, iv: TimeSeriesInterval.DAILY },
      { ep: AlphaVantageEndpoint.TIME_SERIES_WEEKLY_ADJUSTED, iv: TimeSeriesInterval.WEEKLY },
      { ep: AlphaVantageEndpoint.TIME_SERIES_MONTHLY_ADJUSTED, iv: TimeSeriesInterval.MONTHLY },
    ];
  }
  switch (interval) {
    case 'daily': return [{ ep: AlphaVantageEndpoint.TIME_SERIES_DAILY_ADJUSTED, iv: TimeSeriesInterval.DAILY }];
    case 'weekly': return [{ ep: AlphaVantageEndpoint.TIME_SERIES_WEEKLY_ADJUSTED, iv: TimeSeriesInterval.WEEKLY }];
    case 'monthly': return [{ ep: AlphaVantageEndpoint.TIME_SERIES_MONTHLY_ADJUSTED, iv: TimeSeriesInterval.MONTHLY }];
    default: return [];
  }
}

function round2(n: number): number { return Number(n.toFixed(2)); }

function ensureBarD<T extends DateDowBar>(bars: T[]): { mutated: boolean; addedCount: number } {
  let mutated = false;
  let addedCount = 0;
  for (const b of bars) {
    const dStr = new Date(b.t).toISOString().slice(0, 10);
    if (b.d !== dStr) { (b as any).d = dStr; mutated = true; addedCount++; }
  }
  return { mutated, addedCount };
}

function enrichBarsAscending<T extends EnrichableBar>(bars: T[]): { mutated: boolean; changedCount: number; bars: T[] } {
  if (!Array.isArray(bars) || bars.length === 0) return { mutated: false, changedCount: 0, bars: [] };
  // Ensure ascending
  bars.sort((a, b) => a.t - b.t);
  let mutated = false;
  let prevClose: number | undefined = undefined;
  let changedCount = 0;
  for (let i = 0; i < bars.length; i++) {
    const curr = bars[i];
    const currClose = typeof curr.c === 'number' && Number.isFinite(curr.c) ? curr.c : undefined;
    if (i > 0 && Number.isFinite(prevClose) && (prevClose as number) !== 0 && Number.isFinite(currClose as number)) {
      const changeRaw = (currClose as number) - (prevClose as number);
      const percentRaw = (changeRaw / (prevClose as number)) * 100;
      const ch = round2(changeRaw);
      const cp = round2(percentRaw);
      if (curr.ch !== ch || curr.cp !== cp) {
        (curr as any).ch = ch;
        (curr as any).cp = cp;
        mutated = true;
        changedCount++;
      }
    } else {
      // Do not force ch/cp; first bar legitimately has no baseline
    }
    prevClose = typeof curr.c === 'number' && Number.isFinite(curr.c) ? curr.c : undefined;
  }
  return { mutated, changedCount, bars };
}

function ensureDowAndD<T extends DateDowBar>(bars: T[]): { mutated: boolean; bars: T[] } {
  let mutated = false;
  for (const b of bars) {
    const dStr = new Date(b.t).toISOString().slice(0, 10);
    if (b.d !== dStr) { (b as any).d = dStr; mutated = true; }
    const dow = new Date(`${dStr}T00:00:00.000Z`).getUTCDay();
    const map = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
    if ((b as any).dow !== map[dow]) { (b as any).dow = map[dow]; mutated = true; }
  }
  return { mutated, bars };
}

function hasInvalidCloses(bars: Array<EnrichableBar>): boolean {
  return bars.some((b, i) => {
    const close = typeof b.c === 'number' && Number.isFinite(b.c) ? b.c : undefined;
    // invalid when missing or zero for non-first bars
    return i > 0 && (!Number.isFinite(close as number) || (close as number) === 0);
  });
}

async function refetchRecentDailyAdjusted(symbol: string): Promise<void> {
  const handler: any = AlphaVantageHandlerFactory.createHandler(AlphaVantageEndpoint.TIME_SERIES_DAILY_ADJUSTED);
  const { from, to } = parseDateRange();
  // Always use full fetch for this script to hydrate beyond the 100-bar compact limit
  await handler.fetch({
    symbol,
    outputsize: 'full',
    __checkWriteToggle: false,
    __phase: 'POST',
    __fromMs: from ?? undefined,
    __toMs: to ?? undefined,
  });
}

function logLatestAndIssues(symbol: string, ep: AlphaVantageEndpoint, shard: string | number, bars: Array<{ t: number; o?: number; h?: number; l?: number; c?: number; v?: number; ac?: number; d?: string; dow?: string; ch?: number; cp?: number }>, latest?: any) {
  const epName = AlphaVantageEndpoint[ep];
  const latestBar = latest ?? (Array.isArray(bars) && bars.length ? bars[bars.length - 1] : null);
  console.log(`[SAMPLE] ${symbol} ${epName} ${shard} latest:`);
  console.log(JSON.stringify(latestBar, null, 2));

  // Issue scan: counts and first few examples
  const issues = { missingFields: { o: 0, h: 0, l: 0, c: 0, v: 0, ac: 0, d: 0, dow: 0 }, invalidClose: 0, missingChCp: 0, nonFiniteOHLCV: 0 } as any;
  const samples: Array<{ t: number; d?: string; fields: string[] }> = [];
  for (const b of bars) {
    const missing: string[] = [];
    if (!Number.isFinite(b.o as number)) missing.push('o');
    if (!Number.isFinite(b.h as number)) missing.push('h');
    if (!Number.isFinite(b.l as number)) missing.push('l');
    if (!Number.isFinite(b.c as number)) missing.push('c');
    if (!Number.isFinite(b.v as number)) missing.push('v');
    if (!Number.isFinite(b.ac as number)) missing.push('ac');
    if (!b.d) missing.push('d');
    if (!b.dow) missing.push('dow');
    if (missing.length) {
      for (const f of missing) issues.missingFields[f]++;
      if (samples.length < 3) samples.push({ t: b.t, d: b.d, fields: missing });
    }
  }
  // invalid raw close (non-first bars) or missing ch/cp when a valid baseline exists
  for (let i = 1; i < bars.length; i++) {
    const curr = bars[i];
    const prev = bars[i - 1];
    const currClose = Number.isFinite(curr.c as number) ? (curr.c as number) : NaN;
    const prevClose = Number.isFinite(prev.c as number) ? (prev.c as number) : NaN;
    if (!(Number.isFinite(currClose) && currClose > 0 && Number.isFinite(prevClose) && prevClose > 0)) {
      issues.invalidClose++;
    } else if (typeof curr.ch !== 'number' || typeof curr.cp !== 'number') {
      issues.missingChCp++;
    }
  }
  const summary = {
    missingFields: issues.missingFields,
    invalidCloseCount: issues.invalidClose,
    missingChCpCount: issues.missingChCp,
    sampleMissing: samples,
  };
  console.log(`[ISSUES] ${symbol} ${epName} ${shard}:`);
  console.log(JSON.stringify(summary, null, 2));
}

async function ensureTimeSeries(symbol: string, ep: AlphaVantageEndpoint, iv: TimeSeriesInterval): Promise<void> {
  const ok = await initializeTimeSeriesIfMissing(symbol, iv, ep);
  if (ok) {
    console.log(`[ENSURE] ${symbol} ${AlphaVantageEndpoint[ep]} present`);
  } else {
    console.log(`[ENSURE] ${symbol} ${AlphaVantageEndpoint[ep]} not initialized (fetch returned no data)`);
  }
}

async function repairDailyOrWeekly(symbol: string, ep: AlphaVantageEndpoint, iv: TimeSeriesInterval): Promise<{ updatedDocs: number }> {
  const vendor = ApiProvider.ALPHA_VANTAGE;
  const metaPath = getSymbolTimeSeriesDocPath(symbol, ep, vendor);
  const metaRef = db.doc(metaPath);
  const metaSnap = await metaRef.get();
  if (!metaSnap.exists) return { updatedDocs: 0 };

  // Determine available years.
  // In repair-metadata mode, always derive from the years subcollection so we ignore any stale metadata.availableYears.
  // Otherwise, prefer metadata.availableYears and fall back to scanning the years collection when missing.
  let availableYears: number[];
  if (REPAIR_METADATA) {
    const yearsColPath = `${metaPath}/years`;
    const yearsSnap = await db.collection(yearsColPath).get();
    availableYears = yearsSnap.docs.map(d => Number(d.id)).filter(n => Number.isFinite(n)).sort((a, b) => a - b);
  } else {
    availableYears = Array.isArray(metaSnap.get('metadata.availableYears')) ? metaSnap.get('metadata.availableYears') : [];
    if (!availableYears.length) {
      const yearsColPath = `${metaPath}/years`;
      const yearsSnap = await db.collection(yearsColPath).get();
      availableYears = yearsSnap.docs.map(d => Number(d.id)).filter(n => Number.isFinite(n)).sort((a, b) => a - b);
    }
  }

  // Apply year filter if provided
  if (YEAR_FILTER != null) {
    availableYears = availableYears.includes(YEAR_FILTER) ? [YEAR_FILTER] : [];
    if (availableYears.length === 0) {
      console.warn(`[WARN] Year filter ${YEAR_FILTER} not found for ${symbol} ${AlphaVantageEndpoint[ep]}`);
      return { updatedDocs: 0 };
    }
  }

  let updatedDocs = 0;
  let firstTs: number | null = null;
  let lastTs: number | null = null;

  for (const year of availableYears) {
    const yPath = getSymbolTimeSeriesYearDocPath(symbol, ep, vendor, year);
    const yRef = db.doc(yPath);
    const ySnap = await yRef.get();
    if (!ySnap.exists) continue;
    const data = ySnap.data() as any;
    if (!Array.isArray(data?.bars) || data.bars.length === 0) continue;

    const barsArr = data.bars as Array<{ t: number; o?: number; h?: number; l?: number; c?: number; v?: number; ac?: number; d?: string; dow?: string; ch?: number; cp?: number }>;

    // Optional date range guard: skip entire year shards that sit fully outside [from,to].
    // This ensures backfills with --dateFrom only touch data on/after that boundary.
    const { from, to } = parseDateRange();
    if (barsArr.length) {
      const yearFirstTs = barsArr[0].t;
      const yearLastTs = barsArr[barsArr.length - 1].t;
      if (from != null && yearLastTs < from) {
        console.log(`[SKIP] ${yPath} (year ${year} entirely before from=${DATE_FROM})`);
        continue;
      }
      if (to != null && yearFirstTs > to) {
        console.log(`[SKIP] ${yPath} (year ${year} entirely after to=${DATE_TO})`);
        continue;
      }
    }
    const needsRefetch = hasInvalidCloses(barsArr) || barsArr.some(b => !Number.isFinite((b.o as number)) || !Number.isFinite((b.h as number)) || !Number.isFinite((b.l as number)) || !Number.isFinite((b.v as number)));
    const shouldRefetchDaily = !REPAIR_METADATA && iv === TimeSeriesInterval.DAILY && (
      FORCE_REFETCH || needsRefetch || barsArr.some(b => b.ch == null || b.cp == null)
    );
    if (shouldRefetchDaily) {
      if (DRY_RUN) {
        console.log(`[DRY-RUN] Would refetch DAILY full for ${symbol} (forceRefetch=${FORCE_REFETCH}, needsRefetch=${needsRefetch}) in ${yPath}`);
      } else {
        // Always use full fetch to hydrate gaps beyond the 100-bar compact limit
        await refetchRecentDailyAdjusted(symbol);
        // Reload fresh after refetch
        const freshSnap = await yRef.get();
        if (freshSnap.exists) (data as any).bars = freshSnap.get('bars') ?? data.bars;
      }
    }

    const barsPost = (data.bars as typeof barsArr).slice().sort((a,b)=>a.t-b.t);
    ensureBarD(barsPost);
    const { mutated: dwdMut } = ensureDowAndD(barsPost);
    const { mutated: chcpMut, changedCount, bars } = enrichBarsAscending(barsPost);

    // Track series bounds
    firstTs = firstTs ?? bars[0]?.t ?? null;
    if (bars.length) lastTs = bars[bars.length - 1].t;

    const needWrite = dwdMut || chcpMut || needsRefetch;
    if (needWrite) {
      if (DRY_RUN) {
        console.log(`[DRY-RUN] Would update ${yPath} (bars: ${bars.length}; fix ch/cp: ${changedCount}; ensure d/dow; refetch=${needsRefetch})`);
        logLatestAndIssues(symbol, ep, year, bars, data.latest);
      } else {
        // Recompute aggregates so 'latest' reflects enriched data
        const latestBar = bars[bars.length - 1] ?? null;
        const latestUtcIso = latestBar?.t != null ? new Date(latestBar.t).toISOString() : null;
        const latestEtStr = latestBar?.t != null ? etDateTime(latestBar.t) : null;
        await yRef.set({
          bars,
          count: bars.length,
          firstBarTs: bars[0]?.t ?? null,
          lastBarTs: bars[bars.length - 1]?.t ?? null,
          latest: latestBar,
          latestUtcIso,
          latestEtDateTime: latestEtStr,
          updatedAt: (await import('firebase-admin/firestore')).Timestamp.now(),
        }, { merge: true });
        updatedDocs++;
        console.log(`[WRITE] Updated ${yPath} (bars: ${bars.length}; fixed ch/cp: ${changedCount}; ensured d/dow; refetch=${needsRefetch})`);
        logLatestAndIssues(symbol, ep, year, bars, data.latest);
      }
    } else {
      // No changes needed. Print samples in both dry-run and live runs for verification.
      console.log(`[NO-CHANGE] ${yPath} (bars: ${bars.length})`);
      logLatestAndIssues(symbol, ep, year, bars, data.latest);
    }
  }

  // Repair metadata based on the final year set and series bounds.
  // Behavior:
  // - With --repair-metadata: skip refetch (see guard above) and only recompute metadata.
  // - Without --repair-metadata: perform any needed refetches and then also refresh metadata
  //   so histStartTs/histEndTs/availableYears stay in sync with the shards.
  const shouldRepairMetadata = REPAIR_METADATA || !DRY_RUN;
  if (shouldRepairMetadata) {
    const payload: any = {};

    // Start from existing metadata map (if any) and overlay repaired fields.
    const existingMeta = (metaSnap.data() as any)?.metadata ?? {};
    const newMeta: any = { ...existingMeta };

    if (availableYears.length) newMeta.availableYears = availableYears;
    if (firstTs != null) {
      newMeta.histStartTs = firstTs;
      newMeta.histStartDate = new Date(firstTs);
    }
    if (lastTs != null) {
      newMeta.histEndTs = lastTs;
      newMeta.histEndDate = new Date(lastTs);
    }

    if (Object.keys(newMeta).length) {
      // Write nested metadata object only; preserve overall shape
      payload.metadata = newMeta;

      // Clean up any old dotted-root fields such as 'metadata.availableYears'
      const { FieldValue } = await import('firebase-admin/firestore');
      payload['metadata.availableYears'] = FieldValue.delete();
      payload['metadata.histStartTs'] = FieldValue.delete();
      payload['metadata.histEndTs'] = FieldValue.delete();

      if (DRY_RUN) {
        console.log(`[DRY-RUN] Would repair metadata on ${metaPath}`, payload);
      } else {
        await metaRef.set(payload, { merge: true });
        console.log(`[WRITE] Repaired metadata on ${metaPath}`);
      }
    }
  }

  return { updatedDocs };
}

async function repairMonthly(symbol: string, ep: AlphaVantageEndpoint): Promise<{ updatedDocs: number }> {
  const vendor = ApiProvider.ALPHA_VANTAGE;
  const allPath = getSymbolTimeSeriesAllDocPath(symbol, ep, vendor);
  try {
    const ref = db.doc(allPath);
    const snap = await ref.get();
    if (!snap.exists) return { updatedDocs: 0 };
    const data = snap.data() as any;
    const barsArr = Array.isArray(data?.bars) ? data.bars as Array<{ t: number; o?: number; h?: number; l?: number; c?: number; v?: number; ac?: number; d?: string; dow?: string; ch?: number; cp?: number }> : [];
    if (!barsArr.length) return { updatedDocs: 0 };

    ensureBarD(barsArr);
    const { mutated: dwdMut } = ensureDowAndD(barsArr);
    const { mutated: chcpMut, changedCount, bars } = enrichBarsAscending(barsArr);
    if (dwdMut || chcpMut) {
      if (DRY_RUN) {
        console.log(`[DRY-RUN] Would update ${allPath} (bars: ${bars.length}; ensure d/dow; fix ch/cp: ${changedCount})`);
        logLatestAndIssues(symbol, ep, 'all', bars, data.latest);
      } else {
        const latestBar = bars[bars.length - 1] ?? null;
        const latestUtcIso = latestBar?.t != null ? new Date(latestBar.t).toISOString() : null;
        const latestEtStr = latestBar?.t != null ? etDateTime(latestBar.t) : null;
        await ref.set({
          bars,
          count: bars.length,
          firstBarTs: bars[0]?.t ?? null,
          lastBarTs: bars[bars.length - 1]?.t ?? null,
          latest: latestBar,
          latestUtcIso,
          latestEtDateTime: latestEtStr,
          updatedAt: (await import('firebase-admin/firestore')).Timestamp.now(),
        }, { merge: true });
        console.log(`[WRITE] Updated ${allPath} (bars: ${bars.length}; ensured d/dow; fixed ch/cp: ${changedCount})`);
        logLatestAndIssues(symbol, ep, 'all', bars, data.latest);
      }
      return { updatedDocs: 1 };
    }
    // Monthly: no changes; print samples in both dry-run and live runs for verification
    console.log(`[NO-CHANGE] ${allPath} (bars: ${barsArr.length})`);
    logLatestAndIssues(symbol, ep, 'all', barsArr, data.latest);
    return { updatedDocs: 0 };
  } catch (e: any) {
    // Some environments may have an inconsistent monthly path shape; log and continue.
    console.warn(`[WARN] Skipping monthly repair for ${symbol}:`, e?.message || e);
    return { updatedDocs: 0 };
  }
}

type YearIssues = {
  year: number;
  barCount: number;
  missingFields: { o: number; h: number; l: number; c: number; v: number; ac: number; d: number; dow: number };
  invalidCloseCount: number;
  missingChCpCount: number;
  sampleMissing: Array<{ t: number; d?: string; fields: string[] }>;
};

type SymbolIssues = {
  symbol: string;
  endpoint: string;
  years: YearIssues[];
};

async function auditDailyForSymbol(symbol: string): Promise<SymbolIssues> {
  const endpoint = AlphaVantageEndpoint.TIME_SERIES_DAILY_ADJUSTED;
  const vendorPath = getSymbolTimeSeriesDocPath(symbol, endpoint, ApiProvider.ALPHA_VANTAGE);
  const yearsRef = db.doc(vendorPath).collection('years');
  const yearsSnap = await yearsRef.get();
  const results: YearIssues[] = [];
  for (const yDoc of yearsSnap.docs) {
    const yNum = Number(yDoc.id);
    const bars = (yDoc.get('bars') ?? []) as Array<{ t: number; o?: number; h?: number; l?: number; c?: number; v?: number; ac?: number; d?: string; dow?: string; ch?: number; cp?: number }>;
    const issues = { missingFields: { o: 0, h: 0, l: 0, c: 0, v: 0, ac: 0, d: 0, dow: 0 }, invalidClose: 0, missingChCp: 0 } as any;
    const samples: Array<{ t: number; d?: string; fields: string[] }> = [];
    for (const b of bars) {
      const missing: string[] = [];
      if (!Number.isFinite(b.o as number)) missing.push('o');
      if (!Number.isFinite(b.h as number)) missing.push('h');
      if (!Number.isFinite(b.l as number)) missing.push('l');
      if (!Number.isFinite(b.c as number)) missing.push('c');
      if (!Number.isFinite(b.v as number)) missing.push('v');
      if (!Number.isFinite(b.ac as number)) missing.push('ac');
      if (!b.d) missing.push('d');
      if (!b.dow) missing.push('dow');
      if (missing.length) {
        for (const f of missing) (issues.missingFields as any)[f]++;
        if (samples.length < 5) samples.push({ t: b.t, d: b.d, fields: missing });
      }
      const closeRaw = Number.isFinite(b.c as number) ? (b.c as number) : NaN;
      if (!Number.isFinite(closeRaw) || closeRaw <= 0) issues.invalidClose++;
      if (!Number.isFinite(b.ch as number) || !Number.isFinite(b.cp as number)) issues.missingChCp++;
    }
    results.push({
      year: yNum,
      barCount: bars.length,
      missingFields: issues.missingFields,
      invalidCloseCount: issues.invalidClose,
      missingChCpCount: issues.missingChCp,
      sampleMissing: samples,
    });
  }
  // Sort years ascending for consistent output
  results.sort((a, b) => a.year - b.year);
  return { symbol, endpoint: AlphaVantageEndpoint[endpoint], years: results };
}

async function runInventory(): Promise<void> {
  console.log('=== Inventory: AV DAILY_ADJUSTED data quality (all symbols, all years) ===');
  // Enumerate symbols from symbol-data collection
  const symSnap = await db.collection(FirestoreCollection.SYMBOL_DATA).get();
  const symbols = symSnap.docs.map(d => d.id).sort();
  const out: SymbolIssues[] = [];
  for (const s of symbols) {
    try {
      const res = await auditDailyForSymbol(s);
      out.push(res);
      if (!INVENTORY_ONLY_ISSUES || res.years.some(y => y.missingFields.o + y.missingFields.h + y.missingFields.l + y.missingFields.c + y.missingFields.v + y.missingFields.ac + y.missingFields.d + y.missingFields.dow + y.invalidCloseCount + y.missingChCpCount > 0)) {
        console.log(`[INV] ${s}: years=${res.years.length} issueYears=${res.years.filter(y => y.missingFields.o + y.missingFields.h + y.missingFields.l + y.missingFields.c + y.missingFields.v + y.missingFields.ac + y.missingFields.d + y.missingFields.dow + y.invalidCloseCount + y.missingChCpCount > 0).length} missingDow=${res.years.reduce((acc, y) => acc + y.missingFields.dow, 0)} invalidClose=${res.years.reduce((acc, y) => acc + y.invalidCloseCount, 0)} missingChCp=${res.years.reduce((acc, y) => acc + y.missingChCpCount, 0)} topYears=${res.years.filter(y => y.missingFields.o + y.missingFields.h + y.missingFields.l + y.missingFields.c + y.missingFields.v + y.missingFields.ac + y.missingFields.d + y.missingFields.dow + y.invalidCloseCount + y.missingChCpCount > 0).slice(0, 3).map(y => y.year).join(',')}`);
      }
    } catch (e) {
      console.warn(`[INV] ${s} audit failed: ${String((e as any)?.message || e)}`);
    }
  }
  // Summary JSON
  const summary = {
    generatedAt: new Date().toISOString(),
    symbolCount: out.length,
    totals: out.reduce((acc, s) => {
      for (const y of s.years) {
        acc.missing.o += y.missingFields.o;
        acc.missing.h += y.missingFields.h;
        acc.missing.l += y.missingFields.l;
        acc.missing.c += y.missingFields.c;
        acc.missing.v += y.missingFields.v;
        acc.missing.ac += y.missingFields.ac;
        acc.missing.d += y.missingFields.d;
        acc.missing.dow += y.missingFields.dow;
        acc.invalidClose += y.invalidCloseCount;
        acc.missingChCp += y.missingChCpCount;
        acc.bars += y.barCount;
      }
      return acc;
    }, { missing: { o: 0, h: 0, l: 0, c: 0, v: 0, ac: 0, d: 0, dow: 0 }, invalidClose: 0, missingChCp: 0, bars: 0 }),
    items: out,
  };
  // Final concise totals line
  console.log(`[INV] TOTAL symbols=${summary.symbolCount} bars=${summary.totals.bars} missingDow=${summary.totals.missing.dow} invalidClose=${summary.totals.invalidClose} missingChCp=${summary.totals.missingChCp}`);
  // Optionally write full JSON or print when verbose
  if (INVENTORY_OUT) {
    try {
      writeFileSync(INVENTORY_OUT, JSON.stringify(summary, null, 2), 'utf-8');
      console.log(`[INV] wrote full JSON to ${INVENTORY_OUT}`);
    } catch (e) {
      console.warn(`[INV] failed to write ${INVENTORY_OUT}: ${String((e as any)?.message || e)}`);
    }
  }
  if (INVENTORY_VERBOSE && !INVENTORY_OUT) {
    console.log(JSON.stringify(summary, null, 2));
  }
}

async function recomputePairs(): Promise<void> {
  const { from, to } = parseDateRange();
  // Enumerate all symbols once
  const symSnap = await db.collection(FirestoreCollection.SYMBOL_DATA).get();
  const allSymbols = symSnap.docs.map(d => d.id).sort();
  // Determine baselines
  const baselines = (BASELINE_ARG.toUpperCase() === 'ALL')
    ? allSymbols
    : BASELINE_ARG.split(',').map(s => s.trim().toUpperCase()).filter(Boolean);

  console.log(`=== Recompute Pairs (baselines=${baselines.join(',')}) ===`);

  let grandPlanned = 0, grandSkipped = 0, grandMissing = 0;
  for (const baseline of baselines) {
    const baselineMap = await loadAllBarsByDate(baseline);
    const targets = allSymbols.filter(s => s !== baseline);
    let planned = 0; let skipped = 0; let missing = 0;
    for (const s of targets) {
      const targetMap = await loadAllBarsByDate(s);
      let wrote = 0; let miss = 0; let skip = 0;
      for (const [t, bBase] of baselineMap.entries()) {
        if ((from != null && t < from) || (to != null && t > to)) continue;
        const bTgt = targetMap.get(t);
        if (!bTgt) { miss++; continue; }
        const value = computePairValue(bBase, bTgt);
        if (!Number.isFinite(value as number)) { skip++; continue; }
        const date = isoDateFromMillis(t);
        // TODO: Write to your derived pairs collection/path here.
        console.log(`[PAIR PLAN] ${baseline}-${s} ${date} value=${value}`);
        wrote++;
      }
      planned += wrote; skipped += skip; missing += miss;
    }
    grandPlanned += planned; grandSkipped += skipped; grandMissing += missing;
    console.log(`[PAIR BASELINE] ${baseline}: planned=${planned} skipped=${skipped} missing=${missing}`);
  }
  console.log(`[PAIR TOTAL] planned=${grandPlanned} skipped=${grandSkipped} missing=${grandMissing}`);
}

function etDateTime(tsMs: number): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
  }).formatToParts(new Date(tsMs));
  const m = Object.fromEntries(parts.map(p => [p.type, p.value])) as any;
  return `${m.year}-${m.month}-${m.day} ${m.hour}:${m.minute}:${m.second}`;
}

// ---------------- Helpers for pair recompute ----------------
function isoDateFromMillis(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

function parseDateRange(): { from: number | null; to: number | null } {
  const from = DATE_FROM ? new Date(`${DATE_FROM}T00:00:00.000Z`).getTime() : null;
  const to = DATE_TO ? new Date(`${DATE_TO}T00:00:00.000Z`).getTime() : null;
  return {
    from: Number.isFinite(from as number) ? (from as number) : null,
    to: Number.isFinite(to as number) ? (to as number) : null,
  };
}

async function loadAllBarsByDate(symbol: string): Promise<Map<number, any>> {
  const baseDocPath = getSymbolTimeSeriesDocPath(symbol, AlphaVantageEndpoint.TIME_SERIES_DAILY_ADJUSTED, ApiProvider.ALPHA_VANTAGE);
  const yearsSnap = await db.doc(baseDocPath).collection('years').get();
  const map = new Map<number, any>();
  for (const ydoc of yearsSnap.docs) {
    const bars = (ydoc.get('bars') ?? []) as any[];
    for (const b of bars) { if (Number.isFinite(b.t)) map.set(b.t, b); }
  }
  return map;
}

function computePairValue(baseline: any, target: any): number | undefined {
  // TODO: Replace with exact heatmap formula; placeholder uses target cp
  if (!Number.isFinite(target?.cp as number)) return undefined;
  return Number(target.cp);
}

async function main() {
  const start = Date.now();
  console.log('=== Backfill AV time-series (DAILY/WEEKLY/MONTHLY) ===');
  console.log(`Filters: symbol=${SYMBOL_FILTER ?? 'ALL'}, interval=${INTERVAL_FILTER ?? 'ALL'}, year=${YEAR_FILTER ?? 'ALL'}, dryRun=${DRY_RUN}, repairMeta=${REPAIR_METADATA}, forceRefetch=${FORCE_REFETCH}, emulator=${USE_EMULATOR}, dateFrom=${DATE_FROM ?? 'NONE'}, dateTo=${DATE_TO ?? 'NONE'}`);

  if (INVENTORY_MODE) {
    await runInventory();
    console.log('=== Inventory complete ===');
    return;
  }

  // Recompute pairs mode
  if (RECOMPUTE_PAIRS) {
    await recomputePairs();
    console.log('=== Recompute pairs complete ===');
    return;
  }

  // Gather symbols exclusively from symbol-data
  let symbols: string[];
  if (SYMBOL_FILTER) {
    symbols = [SYMBOL_FILTER];
  } else {
    const symbolDataSnap = await db.collection(FirestoreCollection.SYMBOL_DATA).get();
    symbols = symbolDataSnap.docs.map(d => d.id).sort();
  }
  if (!symbols.length) {
    console.log('No symbols to process.');
    process.exit(0);
  }

  const targets = endpointsForInterval(INTERVAL_FILTER);
  let totalUpdated = 0;

  for (const symbol of symbols) {
    for (const { ep, iv } of targets) {
      try {
        // 1) Ensure existence per latest handlers
        await ensureTimeSeries(symbol, ep, iv);

        // 2) Repair/upgrade data in place
        if (iv === TimeSeriesInterval.MONTHLY) {
          const { updatedDocs } = await repairMonthly(symbol, ep);
          totalUpdated += updatedDocs;
        } else {
          const { updatedDocs } = await repairDailyOrWeekly(symbol, ep, iv);
          totalUpdated += updatedDocs;
        }
      } catch (e: any) {
        console.error(`[ERROR] ${symbol}/${AlphaVantageEndpoint[ep]}:`, e?.message || e);
      }
    }
  }

  console.log(`=== Done. Updated docs: ${totalUpdated}. Elapsed: ${Date.now() - start} ms ===`);
  process.exit(0);
}

main().catch(err => {
  console.error('Fatal error running backfill:', err);
  process.exit(1);
});
