// Usage examples:
//   npx ts-node -r tsconfig-paths/register -r module-alias/register functions/scripts/backfill-timeseries-chcp.ts --dry-run
//   npx ts-node -r tsconfig-paths/register -r module-alias/register functions/scripts/backfill-timeseries-chcp.ts --interval daily
//   npx ts-node -r tsconfig-paths/register -r module-alias/register functions/scripts/backfill-timeseries-chcp.ts --symbol AAPL --repair-metadata
//
// Notes:
// - Defaults to Firebase Emulator if FIRESTORE_EMULATOR_HOST is not set.
// - Ensures AV time-series existence (daily/weekly/monthly) and upgrades stored bars to latest compact schema.
// - Enrichment: adds d (YYYY-MM-DD UTC), ch (change), cp (percent change), with 2-decimal rounding.
// - First bar baseline: ch=0, cp=0.
// - Writes updates only when needed; supports --dry-run.

import * as dotenv from 'dotenv';
import * as path from 'path';
import { setupEmulator } from './scripts-util';

// Configure environment (emulator by default)
if (!process.env.FIRESTORE_EMULATOR_HOST) {
  setupEmulator();
}
// Load local .env if present
dotenv.config({ path: path.resolve(__dirname, '..', '.env.alpha-vantage-proxy-api') });

import { db } from '../src/firebase-admin-init';
import { FirestoreCollection } from '@shared/firestore';
import { ApiProvider } from '@shared/core';
import { AlphaVantageEndpoint, TimeSeriesInterval } from '@shared/alpha-vantage';
import {
  getSymbolTimeSeriesDocPath,
  getSymbolTimeSeriesYearDocPath,
  getSymbolTimeSeriesAllDocPath,
} from '../src/v2/common/firestore/firestore-paths';
import { initializeTimeSeriesIfMissing } from '../src/v2/alpha-vantage/firestore/av-firestore-helper';

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

const SYMBOL_FILTER = (argMap.get('--symbol') as string | undefined)?.toUpperCase();
const INTERVAL_FILTER = (argMap.get('--interval') as string | undefined)?.toLowerCase() as ('daily'|'weekly'|'monthly'|undefined);
const DRY_RUN = Boolean(argMap.get('--dry-run'));
const REPAIR_METADATA = Boolean(argMap.get('--repair-metadata'));

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

function ensureBarD<T extends { t: number; d?: string }>(bars: T[]): boolean {
  let mutated = false;
  for (const b of bars) {
    const dStr = new Date(b.t).toISOString().slice(0, 10);
    if (b.d !== dStr) { (b as any).d = dStr; mutated = true; }
  }
  return mutated;
}

function enrichBarsAscending<T extends { t: number; c: number; ch?: number; cp?: number }>(bars: T[]): { mutated: boolean; bars: T[] } {
  if (!Array.isArray(bars) || bars.length === 0) return { mutated: false, bars: [] };
  // Ensure ascending
  bars.sort((a, b) => a.t - b.t);
  let mutated = false;
  let prevClose: number | undefined = undefined;
  for (let i = 0; i < bars.length; i++) {
    const curr = bars[i];
    let ch = 0;
    let cp = 0;
    if (i > 0 && Number.isFinite(prevClose) && (prevClose as number) !== 0) {
      const changeRaw = curr.c - (prevClose as number);
      const percentRaw = (changeRaw / (prevClose as number)) * 100;
      ch = round2(changeRaw);
      cp = round2(percentRaw);
    }
    if (curr.ch !== ch || curr.cp !== cp) {
      (curr as any).ch = ch;
      (curr as any).cp = cp;
      mutated = true;
    }
    prevClose = curr.c;
  }
  return { mutated, bars };
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

  // Determine available years: metadata or fallback to listing collection
  let availableYears: number[] = Array.isArray(metaSnap.get('metadata.availableYears')) ? metaSnap.get('metadata.availableYears') : [];
  if (!availableYears.length) {
    const yearsColPath = `${metaPath}/years`;
    const yearsSnap = await db.collection(yearsColPath).get();
    availableYears = yearsSnap.docs.map(d => Number(d.id)).filter(n => Number.isFinite(n)).sort((a, b) => a - b);
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

    // Normalize d
    const barsArr = data.bars as Array<{ t: number; c: number; d?: string; ch?: number; cp?: number }>;
    const dMut = ensureBarD(barsArr);
    const { mutated: chcpMut, bars } = enrichBarsAscending(barsArr);

    // Track series bounds
    firstTs = firstTs ?? bars[0]?.t ?? null;
    if (bars.length) lastTs = bars[bars.length - 1].t;

    if (dMut || chcpMut) {
      if (DRY_RUN) {
        console.log(`[DRY-RUN] Would update ${yPath} (bars: ${bars.length})`);
      } else {
        await yRef.set({ bars }, { merge: true });
        updatedDocs++;
        console.log(`[WRITE] Updated ${yPath} (bars: ${bars.length})`);
      }
    }
  }

  // Optionally repair metadata
  if (REPAIR_METADATA) {
    const payload: any = {};
    if (availableYears.length) payload['metadata.availableYears'] = availableYears;
    if (firstTs != null) payload['metadata.histStartTs'] = firstTs;
    if (lastTs != null) payload['metadata.histEndTs'] = lastTs;
    if (Object.keys(payload).length) {
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
    const barsArr = Array.isArray(data?.bars) ? data.bars as Array<{ t: number; c: number; d?: string; ch?: number; cp?: number }> : [];
    if (!barsArr.length) return { updatedDocs: 0 };

    const dMut = ensureBarD(barsArr);
    const { mutated: chcpMut, bars } = enrichBarsAscending(barsArr);
    if (dMut || chcpMut) {
      if (DRY_RUN) {
        console.log(`[DRY-RUN] Would update ${allPath} (bars: ${bars.length})`);
      } else {
        await ref.set({ bars }, { merge: true });
        console.log(`[WRITE] Updated ${allPath} (bars: ${bars.length})`);
      }
      return { updatedDocs: 1 };
    }
    return { updatedDocs: 0 };
  } catch (e: any) {
    // Some environments may have an inconsistent monthly path shape; log and continue.
    console.warn(`[WARN] Skipping monthly repair for ${symbol}:`, e?.message || e);
    return { updatedDocs: 0 };
  }
}

async function main() {
  const start = Date.now();
  console.log('=== Backfill AV time-series (DAILY/WEEKLY/MONTHLY) ===');
  console.log(`Filters: symbol=${SYMBOL_FILTER ?? '*'}, interval=${INTERVAL_FILTER ?? '*'}, dryRun=${DRY_RUN}, repairMeta=${REPAIR_METADATA}`);

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
