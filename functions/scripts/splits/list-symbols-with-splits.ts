/**
 * Diagnostic script: List all tracked symbols that have a non-empty splitHistory.
 *
 * Purpose:
 *   After running sync-splits.ts for all symbols, use this to identify which
 *   symbols actually have splits and need a weekly/monthly backfill re-run.
 *
 * Usage (from functions/):
 *   npx ts-node -r tsconfig-paths/register ./scripts/splits/list-symbols-with-splits.ts
 *
 * Output:
 *   Prints a comma-separated list of symbols with splits, suitable for use as
 *   the SYMBOLS env var in backfill-av-daily-adjusted.ts.
 *
 * Env vars:
 *   USE_EMULATOR_SCRIPTS=0   required for prod
 */
const { setupEmulator } = require('../scripts-util');
setupEmulator();

import { db } from '../../src/firebase-admin-init';
import { FirestoreCollection } from '@shared/firestore';

async function main(): Promise<void> {
  console.log('--- List Symbols With Splits ---');

  const trackedSnap = await db.collection(FirestoreCollection.TRACKED_SYMBOLS).get();
  const allSymbols = trackedSnap.docs.map(d => d.id.toUpperCase()).sort();
  console.log(`Total tracked symbols: ${allSymbols.length}`);

  const withSplits: string[] = [];
  const withoutSplits: string[] = [];
  let processed = 0;

  // Batch reads in groups of 100 to avoid hammering Firestore
  const BATCH = 100;
  for (let i = 0; i < allSymbols.length; i += BATCH) {
    const batch = allSymbols.slice(i, i + BATCH);
    await Promise.all(batch.map(async (symbol) => {
      const snap = await db.doc(`${FirestoreCollection.SYMBOL_DATA}/${symbol}`).get();
      const splitHistory = snap.data()?.splitHistory;
      if (Array.isArray(splitHistory) && splitHistory.length > 0) {
        withSplits.push(symbol);
      } else {
        withoutSplits.push(symbol);
      }
    }));
    processed += batch.length;
    console.log(`  checked ${processed}/${allSymbols.length}...`);
  }

  withSplits.sort();

  console.log(`\nSymbols WITH splits (${withSplits.length}):`);
  withSplits.forEach(s => console.log(`  ${s}`));

  console.log(`\nSymbols WITHOUT splits (${withoutSplits.length}): (skipped for brevity)`);

  console.log(`\n--- SYMBOLS env var for backfill ---`);
  console.log(withSplits.join(','));
}

main().catch((e) => {
  console.error('fatal', e?.message || e);
  process.exitCode = 1;
});
