/**
 * Cleanup script for deleting `sa-time-series` WEEKLY 2026 shards for all (or selected) symbols.
 *
 * Usage examples (PROD):
 *
 * Dry run - log what would be deleted (no writes):
 *   USE_EMULATOR_SCRIPTS=off DRY_RUN=1 node dist/scripts/cleanup-weekly-2026.js
 *
 * Actual delete against live Firestore:
 *   USE_EMULATOR_SCRIPTS=off DRY_RUN=0 node dist/scripts/cleanup-weekly-2026.js
 *
 * Limit to a subset of symbols:
 *   USE_EMULATOR_SCRIPTS=off DRY_RUN=0 node dist/scripts/cleanup-weekly-2026.js --symbols=A,AA,AAPL
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
  console.log('[cleanup-weekly-2026]', ...args);
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

async function getSymbols(): Promise<string[]> {
  const fromArgs = parseSymbolsFromArgs();
  if (fromArgs && fromArgs.length > 0) {
    return fromArgs;
  }

  const snapshot = await db.collection(FirestoreCollection.TRACKED_SYMBOLS).get();
  return snapshot.docs.map((d) => d.id.toUpperCase()).sort();
}

async function deleteWeekly2026ForSymbol(symbol: string, dryRun: boolean): Promise<void> {
  const docPath = `symbol-data/${symbol}/sa-time-series/av-weekly-adjusted/years/2026`;
  const ref = db.doc(docPath);
  const snap = await ref.get();

  if (!snap.exists) {
    log(symbol, 'no weekly 2026 doc found');
    return;
  }

  if (dryRun) {
    log(symbol, 'DRY RUN - would delete', docPath, 'barsCount=', (snap.get('bars') || []).length);
    return;
  }

  await ref.delete();
  log(symbol, 'deleted weekly 2026 doc', docPath);
}

async function main(): Promise<void> {
  const dryRun = isDryRun();
  const symbols = await getSymbols();

  log(`starting cleanup-weekly-2026 for ${symbols.length} symbol(s) :: dryRun=${dryRun}`);

  for (const symbol of symbols) {
    try {
      await deleteWeekly2026ForSymbol(symbol, dryRun);
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error('[cleanup-weekly-2026]', symbol, 'error', err);
    }
  }

  log('completed cleanup-weekly-2026');
}

// eslint-disable-next-line no-floating-promises
main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error('[cleanup-weekly-2026] fatal error', err);
  process.exit(1);
});
