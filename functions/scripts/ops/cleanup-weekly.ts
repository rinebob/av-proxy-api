/**
 * Cleanup script for fixing `sa-time-series` WEEKLY shards so there is at most
 * one bar per calendar week for a given symbol/year.
 *
 * Usage examples (PROD):
 *
 * Dry run - AA, years 2024 and 2025 only:
 *   USE_EMULATOR_SCRIPTS=off DRY_RUN=1 node dist/scripts/cleanup-weekly.js --symbols=AA --years=2024,2025
 *
 * Actual cleanup against live Firestore for a small set of symbols/years:
 *   USE_EMULATOR_SCRIPTS=off DRY_RUN=0 node dist/scripts/cleanup-weekly.js --symbols=A,AA,AAPL --years=2024,2025,2026
 *
 * Full tracked-symbol universe for specific years (no --symbols arg):
 *   USE_EMULATOR_SCRIPTS=off DRY_RUN=0 node dist/scripts/cleanup-weekly.js --years=2024,2025,2026
 *
 * NOTE: This script depends on the standard functions build pipeline (tsc to dist/).
 */

import * as dotenv from 'dotenv';
import * as path from 'path';
import { setupEmulator } from '../scripts-util';

// For safety, scripts default to emulator unless explicitly disabled.
// Set USE_EMULATOR_SCRIPTS=off to target PROD.
setupEmulator();

dotenv.config({ path: path.resolve(__dirname, '..', '.env.alpha-vantage-proxy-api') });

import { db } from '../../src/firebase-admin-init';
import { FirestoreCollection } from '@shared/firestore';

function log(...args: unknown[]): void {
  // eslint-disable-next-line no-console
  console.log('[cleanup-weekly]', ...args);
}

function isDryRun(): boolean {
  const v = (process.env.DRY_RUN || '').toLowerCase();
  return v === '1' || v === 'true' || v === 'yes';
}

function parseSymbolsFromArgs(): string[] | null {
  const args = process.argv.slice(2);

  let raw: string | null = null;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg.startsWith('--symbols=')) {
      raw = arg.slice('--symbols='.length);
      break;
    }
    if (arg === '--symbols' || arg === '--symbol') {
      const next = args[i + 1];
      if (next && !next.startsWith('--')) {
        raw = next;
        break;
      }
    }
  }

  if (!raw) return null;

  const parts = raw
    .split(',')
    .map((s) => s.trim().toUpperCase())
    .filter(Boolean)
    .sort();

  return parts.length ? parts : null;
}

function parseYearsFromArgs(): number[] | null {
  const args = process.argv.slice(2);

  let raw: string | null = null;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg.startsWith('--years=')) {
      raw = arg.slice('--years='.length);
      break;
    }
    if (arg === '--years') {
      const next = args[i + 1];
      if (next && !next.startsWith('--')) {
        raw = next;
        break;
      }
    }
  }

  if (!raw) return null;

  const parts = raw
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
    .map((s) => Number.parseInt(s, 10))
    .filter((n) => Number.isFinite(n));

  return parts.length ? parts : null;
}

async function getSymbols(): Promise<string[]> {
  const fromArgs = parseSymbolsFromArgs();
  if (fromArgs && fromArgs.length > 0) {
    return fromArgs;
  }

  const snapshot = await db.collection(FirestoreCollection.TRACKED_SYMBOLS).get();
  return snapshot.docs.map((d) => d.id.toUpperCase()).sort();
}

type CompactBar = {
  t: number;
  d?: string | null;
  o?: number | null;
  h?: number | null;
  l?: number | null;
  c?: number | null;
  v?: number | null;
};

function weekStart(dateStr: string): string {
  const d = new Date(`${dateStr}T00:00:00.000Z`);
  const day = d.getUTCDay();
  const diff = day === 0 ? -6 : 1 - day;
  d.setUTCDate(d.getUTCDate() + diff);
  return d.toISOString().slice(0, 10);
}

function getDateStrFromBar(bar: CompactBar): string {
  if (typeof bar.d === 'string' && bar.d.length >= 10) {
    return bar.d.slice(0, 10);
  }
  return new Date(bar.t).toISOString().slice(0, 10);
}

function pickWeeklyWinners(barsByYear: Map<number, CompactBar[]>): Map<number, CompactBar[]> {
  type BarWithYear = { bar: CompactBar; year: number };

  const allBars: BarWithYear[] = [];
  for (const [year, bars] of barsByYear.entries()) {
    for (const bar of bars) {
      allBars.push({ bar, year });
    }
  }

  const groups = new Map<string, BarWithYear[]>();

  for (const bw of allBars) {
    const dStr = getDateStrFromBar(bw.bar);
    const key = weekStart(dStr);
    const arr = groups.get(key) ?? [];
    arr.push(bw);
    groups.set(key, arr);
  }

  const winners = new Set<CompactBar>();

  for (const [, arr] of groups) {
    if (arr.length === 1) {
      winners.add(arr[0].bar);
      continue;
    }

    const winner = arr.reduce((best, cur) => {
      const bestDate = getDateStrFromBar(best.bar);
      const curDate = getDateStrFromBar(cur.bar);
      return curDate > bestDate ? cur : best;
    });

    winners.add(winner.bar);
  }

  const cleaned = new Map<number, CompactBar[]>();
  for (const [year, bars] of barsByYear.entries()) {
    const kept = bars.filter((b) => winners.has(b));
    kept.sort((a, b) => a.t - b.t);
    cleaned.set(year, kept);
  }

  return cleaned;
}

async function cleanupWeeklyForSymbolYears(symbol: string, years: number[], dryRun: boolean): Promise<void> {
  const barsByYear = new Map<number, CompactBar[]>();

  for (const year of years) {
    const docPath = `symbol-data/${symbol}/sa-time-series/av-weekly-adjusted/years/${year}`;
    const ref = db.doc(docPath);
    const snap = await ref.get();

    if (!snap.exists) {
      log(symbol, year, 'no weekly doc found');
      continue;
    }

    const bars = (snap.get('bars') || []) as CompactBar[];
    barsByYear.set(year, bars);
  }

  if (!barsByYear.size) {
    log(symbol, 'no weekly docs found for any requested year');
    return;
  }

  const cleaned = pickWeeklyWinners(barsByYear);

  for (const [year, bars] of cleaned.entries()) {
    const originalCount = (barsByYear.get(year) || []).length;
    const cleanedCount = bars.length;

    if (dryRun) {
      log(symbol, year, `DRY RUN - would rewrite weekly doc (original=${originalCount}, cleaned=${cleanedCount})`);
      continue;
    }

    const docPath = `symbol-data/${symbol}/sa-time-series/av-weekly-adjusted/years/${year}`;
    const ref = db.doc(docPath);

    if (!bars.length) {
      log(symbol, year, 'no bars remain after cleanup - leaving doc untouched');
      continue;
    }

    const latestNonPlaceholder = [...bars].reverse().find((bar) => {
      const o = Number(bar.o || 0), h = Number(bar.h || 0), l = Number(bar.l || 0), c = Number(bar.c || 0), v = Number(bar.v || 0);
      return o !== 0 || h !== 0 || l !== 0 || c !== 0 || v !== 0;
    }) ?? (bars[bars.length - 1] ?? null);

    const latestUtcIso = latestNonPlaceholder?.t != null ? new Date(latestNonPlaceholder.t).toISOString() : null;

    await ref.set({
      bars,
      count: bars.length,
      firstBarTs: bars[0]?.t ?? null,
      lastBarTs: bars[bars.length - 1]?.t ?? null,
      latest: latestNonPlaceholder,
      latestUtcIso,
      updatedAt: new Date(),
    }, { merge: true });

    log(symbol, year, `rewrote weekly doc (original=${originalCount}, cleaned=${cleanedCount})`);
  }
}

async function main(): Promise<void> {
  const dryRun = isDryRun();
  const symbols = await getSymbols();
  const years = parseYearsFromArgs();

  if (!years || !years.length) {
    throw new Error('Must supply --years=YYYY or --years=YYYY,YYYY,...');
  }

  log(`starting cleanup-weekly for ${symbols.length} symbol(s) and years=[${years.join(',')}] :: dryRun=${dryRun}`);

  for (const symbol of symbols) {
    try {
      await cleanupWeeklyForSymbolYears(symbol, years, dryRun);
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error('[cleanup-weekly]', symbol, 'error', err);
    }
  }

  log('completed cleanup-weekly');
}

// eslint-disable-next-line no-floating-promises
main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error('[cleanup-weekly] fatal error', err);
  process.exit(1);
});
