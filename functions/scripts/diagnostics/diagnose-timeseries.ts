// Set env vars / emulator BEFORE other imports
import * as dotenv from 'dotenv';
import * as path from 'path';
import { setupEmulator } from '../scripts-util';

setupEmulator();
dotenv.config({ path: path.resolve(__dirname, '..', '.env.alpha-vantage-proxy-api') });

import { db } from '../../src/firebase-admin-init';
import { FirestoreCollection } from '@shared/firestore';
import { ApiProvider } from '@shared/core';
import { AlphaVantageEndpoint, TimeSeriesInterval } from '@shared/alpha-vantage';
import { getSymbolTimeSeriesDocPath, getSymbolTimeSeriesYearDocPath, getSymbolTimeSeriesAllDocPath } from '../../src/v2/common/firestore/firestore-paths';

interface Issue {
  type: string;
  path: string;
  index?: number;
  details: string;
}

interface SeriesConfig {
  endpoint: AlphaVantageEndpoint;
  interval: TimeSeriesInterval;
}

const SERIES_CONFIGS: SeriesConfig[] = [
  { endpoint: AlphaVantageEndpoint.TIME_SERIES_DAILY_ADJUSTED, interval: TimeSeriesInterval.DAILY },
  { endpoint: AlphaVantageEndpoint.TIME_SERIES_WEEKLY_ADJUSTED, interval: TimeSeriesInterval.WEEKLY },
  { endpoint: AlphaVantageEndpoint.TIME_SERIES_MONTHLY_ADJUSTED, interval: TimeSeriesInterval.MONTHLY },
];

interface CliOptions {
  symbols?: string[];
  interval: 'daily' | 'weekly' | 'monthly' | 'all';
  fromMs?: number | null;
  toMs?: number | null;
}

function computeDowFromDateString(d: string): string {
  const dt = new Date(`${d}T00:00:00.000Z`);
  const day = dt.getUTCDay(); // 0=Sun..6=Sat
  switch (day) {
    case 0: return 'Sun';
    case 1: return 'Mon';
    case 2: return 'Tue';
    case 3: return 'Wed';
    case 4: return 'Thu';
    case 5: return 'Fri';
    case 6: return 'Sat';
    default: return 'Mon';
  }
}

function formatEtDateTime(tsMs: number): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/New_York',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
  }).formatToParts(new Date(tsMs));
  const m = Object.fromEntries(parts.map(p => [p.type, p.value]));
  return `${m.year}-${m.month}-${m.day} ${m.hour}:${m.minute}:${m.second}`;
}

function isPlaceholderBar(b: any): boolean {
  const o = Number(b?.o || 0), h = Number(b?.h || 0), l = Number(b?.l || 0), c = Number(b?.c || 0), v = Number(b?.v || 0);
  return o === 0 && h === 0 && l === 0 && c === 0 && v === 0;
}

function validateBarsArray(path: string, bars: any[]): Issue[] {
  const issues: Issue[] = [];
  if (!Array.isArray(bars)) {
    issues.push({ type: 'BARS_NOT_ARRAY', path, details: 'bars field is not an array' });
    return issues;
  }
  let lastT = -Infinity;
  for (let i = 0; i < bars.length; i++) {
    const b = bars[i];
    const t = Number(b?.t);
    if (!Number.isFinite(t)) {
      issues.push({ type: 'INVALID_T', path, index: i, details: `bar.t is not finite: ${String(b?.t)}` });
      continue;
    }
    if (t < lastT) {
      issues.push({ type: 'UNSORTED_BARS', path, index: i, details: `bar.t ${t} < previous ${lastT}` });
    }
    lastT = Math.max(lastT, t);

    if (b?.d) {
      const d = String(b.d).slice(0, 10);
      const expectedD = new Date(t).toISOString().slice(0, 10);
      if (d !== expectedD) {
        issues.push({ type: 'D_MISMATCH_T', path, index: i, details: `d=${d} vs t->${expectedD}` });
      }
      const expectedDow = computeDowFromDateString(expectedD);
      if (b.dow && String(b.dow) !== expectedDow) {
        issues.push({ type: 'BAD_DOW', path, index: i, details: `dow=${b.dow} vs expected=${expectedDow}` });
      }
    }

    const o = Number(b?.o), h = Number(b?.h), l = Number(b?.l), c = Number(b?.c), v = Number(b?.v);
    if (![o, h, l, c, v].every(Number.isFinite)) {
      issues.push({ type: 'INVALID_NUMERIC', path, index: i, details: 'one of o/h/l/c/v is not finite' });
    }
    if (b?.ac != null && !Number.isFinite(Number(b.ac))) {
      issues.push({ type: 'INVALID_AC', path, index: i, details: `ac=${String(b.ac)}` });
    }
    if (b?.dv != null && !Number.isFinite(Number(b.dv))) {
      issues.push({ type: 'INVALID_DV', path, index: i, details: `dv=${String(b.dv)}` });
    }
    if (b?.sc != null && (!Number.isFinite(Number(b.sc)) || Number(b.sc) <= 0)) {
      issues.push({ type: 'INVALID_SC', path, index: i, details: `sc=${String(b.sc)}` });
    }
  }
  return issues;
}

function validateShardMetadata(path: string, data: any, bars: any[]): Issue[] {
  const issues: Issue[] = [];
  if (!Array.isArray(bars) || bars.length === 0) {
    return issues;
  }
  const count = data?.count;
  const firstBarTs = data?.firstBarTs;
  const lastBarTs = data?.lastBarTs;
  const latest = data?.latest;
  const latestUtcIso = data?.latestUtcIso;
  const latestEtDateTime = data?.latestEtDateTime;

  if (count !== bars.length) {
    issues.push({ type: 'COUNT_MISMATCH', path, details: `count=${count} vs bars.length=${bars.length}` });
  }
  if (firstBarTs !== bars[0].t) {
    issues.push({ type: 'FIRST_TS_MISMATCH', path, details: `firstBarTs=${firstBarTs} vs bars[0].t=${bars[0].t}` });
  }
  if (lastBarTs !== bars[bars.length - 1].t) {
    issues.push({ type: 'LAST_TS_MISMATCH', path, details: `lastBarTs=${lastBarTs} vs bars[last].t=${bars[bars.length - 1].t}` });
  }

  const latestNonPlaceholder = [...bars].reverse().find(b => !isPlaceholderBar(b)) ?? bars[bars.length - 1];
  if (latest && latestNonPlaceholder && latest.t !== latestNonPlaceholder.t) {
    issues.push({ type: 'LATEST_MISMATCH', path, details: `latest.t=${latest?.t} vs expected=${latestNonPlaceholder.t}` });
  }
  if (latestNonPlaceholder?.t != null) {
    const expectedIso = new Date(latestNonPlaceholder.t).toISOString();
    const expectedEt = formatEtDateTime(latestNonPlaceholder.t);
    if (latestUtcIso && latestUtcIso !== expectedIso) {
      issues.push({ type: 'LATEST_ISO_MISMATCH', path, details: `latestUtcIso=${latestUtcIso} vs expected=${expectedIso}` });
    }
    if (latestEtDateTime && latestEtDateTime !== expectedEt) {
      issues.push({ type: 'LATEST_ET_MISMATCH', path, details: `latestEtDateTime=${latestEtDateTime} vs expected=${expectedEt}` });
    }
  }
  return issues;
}

function parseCliOptions(): CliOptions {
  const args = process.argv.slice(2);
  const opts: CliOptions = {
    interval: 'all',
    fromMs: null,
    toMs: null,
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--symbols' && args[i + 1]) {
      const raw = args[++i];
      opts.symbols = raw.split(',').map(s => s.trim().toUpperCase()).filter(Boolean);
    } else if (arg === '--interval' && args[i + 1]) {
      const val = args[++i].toLowerCase();
      if (val === 'daily' || val === 'weekly' || val === 'monthly' || val === 'all') {
        opts.interval = val;
      }
    } else if (arg === '--from' && args[i + 1]) {
      const d = args[++i];
      const ts = Date.parse(`${d}T00:00:00.000Z`);
      if (Number.isFinite(ts)) opts.fromMs = ts;
    } else if (arg === '--to' && args[i + 1]) {
      const d = args[++i];
      const ts = Date.parse(`${d}T00:00:00.000Z`);
      if (Number.isFinite(ts)) opts.toMs = ts;
    }
  }

  return opts;
}

async function getSymbols(opts: CliOptions): Promise<string[]> {
  if (opts.symbols && opts.symbols.length) {
    return opts.symbols;
  }
  const snapshot = await db.collection(FirestoreCollection.TRACKED_SYMBOLS).get();
  return snapshot.docs.map(d => d.id).sort();
}

async function validateSeriesForSymbol(symbol: string, opts: CliOptions): Promise<Issue[]> {
  const issues: Issue[] = [];
  const seriesToCheck = SERIES_CONFIGS.filter((cfg) => {
    if (opts.interval === 'all') return true;
    if (opts.interval === 'daily') return cfg.interval === TimeSeriesInterval.DAILY;
    if (opts.interval === 'weekly') return cfg.interval === TimeSeriesInterval.WEEKLY;
    if (opts.interval === 'monthly') return cfg.interval === TimeSeriesInterval.MONTHLY;
    return true;
  });

  const fromMs = opts.fromMs ?? null;
  const toMs = opts.toMs ?? null;

  for (const cfg of seriesToCheck) {
    for (const isSplitAdjusted of [false, true]) {
      const metaPath = getSymbolTimeSeriesDocPath(symbol, cfg.endpoint, ApiProvider.ALPHA_VANTAGE, isSplitAdjusted);
      const metaSnap = await db.doc(metaPath).get();
      if (!metaSnap.exists) {
        continue;
      }
      const metaData = metaSnap.data() as any;

      if (cfg.interval === TimeSeriesInterval.MONTHLY) {
        const allPath = getSymbolTimeSeriesAllDocPath(symbol, cfg.endpoint, ApiProvider.ALPHA_VANTAGE, isSplitAdjusted);
        const allSnap = await db.doc(allPath).get();
        if (!allSnap.exists) {
          issues.push({ type: 'MISSING_MONTHLY_ALL', path: allPath, details: 'monthly all doc missing' });
        } else {
          const allData = allSnap.data() as any;
          const bars = Array.isArray(allData?.bars) ? allData.bars as any[] : [];
          issues.push(...validateBarsArray(allPath, bars));
          issues.push(...validateShardMetadata(allPath, allData, bars));
          const yearsFromBars = new Set<number>();
          const allTs: number[] = [];
          for (const b of bars) {
            const t = Number(b?.t);
            if (!Number.isFinite(t)) continue;
            if (fromMs != null && t < fromMs) continue;
            if (toMs != null && t > toMs) continue;
            allTs.push(t);
            const y = new Date(t).getUTCFullYear();
            if (Number.isFinite(y)) yearsFromBars.add(y);
          }

          const actualYears = Array.from(yearsFromBars).sort((a, b) => a - b);
          const metaYears: number[] = Array.isArray(metaData?.metadata?.availableYears) ? metaData.metadata.availableYears : [];
          const metaSorted = [...metaYears].sort((a, b) => a - b);
          if (metaSorted.length && JSON.stringify(actualYears) !== JSON.stringify(metaSorted)) {
            issues.push({ type: 'META_AVAILABLE_YEARS_MISMATCH', path: metaPath, details: `meta=${JSON.stringify(metaSorted)} actual=${JSON.stringify(actualYears)}` });
          }

          if (allTs.length) {
            const minTs = Math.min(...allTs);
            const maxTs = Math.max(...allTs);
            const histStartTs = metaData?.metadata?.histStartTs;
            const histEndTs = metaData?.metadata?.histEndTs;
            if (histStartTs != null && histStartTs !== minTs) {
              issues.push({ type: 'META_HIST_START_MISMATCH', path: metaPath, details: `histStartTs=${histStartTs} vs minTs=${minTs}` });
            }
            if (histEndTs != null && histEndTs !== maxTs) {
              issues.push({ type: 'META_HIST_END_MISMATCH', path: metaPath, details: `histEndTs=${histEndTs} vs maxTs=${maxTs}` });
            }
          }
        }
      } else {
        const yearsColPath = `${metaPath}/years`;
        const yearsSnap = await db.collection(yearsColPath).get();
        const actualYears = yearsSnap.docs.map(d => Number(d.id)).filter(n => Number.isFinite(n)).sort((a, b) => a - b);
        const metaYears: number[] = Array.isArray(metaData?.metadata?.availableYears) ? metaData.metadata.availableYears : [];
        const metaSorted = [...metaYears].sort((a, b) => a - b);
        if (JSON.stringify(actualYears) !== JSON.stringify(metaSorted)) {
          issues.push({ type: 'META_AVAILABLE_YEARS_MISMATCH', path: metaPath, details: `meta=${JSON.stringify(metaSorted)} actual=${JSON.stringify(actualYears)}` });
        }

        const allTs: number[] = [];
        for (const year of actualYears) {
          const yPath = getSymbolTimeSeriesYearDocPath(symbol, cfg.endpoint, ApiProvider.ALPHA_VANTAGE, year, isSplitAdjusted);
          const ySnap = await db.doc(yPath).get();
          if (!ySnap.exists) continue;
          const yData = ySnap.data() as any;
          const bars = Array.isArray(yData?.bars) ? yData.bars as any[] : [];
          issues.push(...validateBarsArray(yPath, bars));
          issues.push(...validateShardMetadata(yPath, yData, bars));
          for (const b of bars) {
            if (Number.isFinite(Number(b.t))) allTs.push(Number(b.t));
          }
        }

        if (allTs.length) {
          const minTs = Math.min(...allTs);
          const maxTs = Math.max(...allTs);
          const histStartTs = metaData?.metadata?.histStartTs;
          const histEndTs = metaData?.metadata?.histEndTs;
          if (histStartTs != null && histStartTs !== minTs) {
            issues.push({ type: 'META_HIST_START_MISMATCH', path: metaPath, details: `histStartTs=${histStartTs} vs minTs=${minTs}` });
          }
          if (histEndTs != null && histEndTs !== maxTs) {
            issues.push({ type: 'META_HIST_END_MISMATCH', path: metaPath, details: `histEndTs=${histEndTs} vs maxTs=${maxTs}` });
          }
        }
      }
    }
  }
  return issues;
}

async function main() {
  const opts = parseCliOptions();
  const symbols = await getSymbols(opts);
  console.log(`--- diagnose-timeseries: ${symbols.length} symbol(s) ---`);
  let totalIssues = 0;

  for (const symbol of symbols) {
    console.log(`\n[${symbol}]`);
    const issues = await validateSeriesForSymbol(symbol, opts);
    if (!issues.length) {
      console.log('  OK: no issues found');
      continue;
    }
    totalIssues += issues.length;
    for (const issue of issues) {
      console.log(JSON.stringify({ symbol, ...issue }));
    }
  }

  console.log(`\nTotal issues: ${totalIssues}`);
  if (totalIssues > 0) {
    process.exit(1);
  }
}

main().catch((err) => {
  console.error('diagnose-timeseries error', err);
  process.exit(1);
});
