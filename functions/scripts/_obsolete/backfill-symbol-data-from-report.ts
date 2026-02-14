// Prod-only maintenance script.
// Creates minimal symbol-data/{symbol} docs for symbols listed in
// find-incomplete-sa-timeseries.output.json.

import * as dotenv from 'dotenv';
import * as path from 'path';
import * as fs from 'fs';
import { setupEmulator } from '../scripts-util';

setupEmulator();
dotenv.config({ path: path.resolve(__dirname, '..', '.env.alpha-vantage-proxy-api') });

import { db } from '../src/firebase-admin-init';
import { FirestoreCollection } from '@shared/firestore';
import { Timestamp } from 'firebase-admin/firestore';

interface IncompleteSymbolEntry {
  symbol: string;
  issues: string[];
}

async function loadIncompleteSymbols(): Promise<string[]> {
  const reportPath = path.resolve(__dirname, 'find-incomplete-sa-timeseries.output.json');
  if (!fs.existsSync(reportPath)) {
    throw new Error(`Report file not found at ${reportPath}. Run find-incomplete-sa-timeseries.ts first.`);
  }

  const raw = fs.readFileSync(reportPath, { encoding: 'utf8' });
  const parsed = JSON.parse(raw) as IncompleteSymbolEntry[];

  return parsed.map((e) => e.symbol.toUpperCase());
}

async function backfillSymbolData(symbol: string): Promise<void> {
  const upper = symbol.toUpperCase();
  const symbolRef = db.doc(`${FirestoreCollection.SYMBOL_DATA}/${upper}`);
  const symbolSnap = await symbolRef.get();

  if (!symbolSnap.exists) {
    console.log(`[BACKFILL] ${upper}: creating minimal symbol-data document`);
    await symbolRef.set({
      createdAt: Timestamp.now(),
      createdBy: 'bulk-import',
    });
  } else {
    console.log(`[BACKFILL] ${upper}: symbol-data doc already exists, leaving fields as-is`);
  }

  // After ensuring the symbol-data doc exists, retrigger onSymbolAdded by
  // deleting and recreating the tracked-symbols document for this symbol.
  const trackedRef = db.doc(`${FirestoreCollection.TRACKED_SYMBOLS}/${upper}`);
  const trackedSnap = await trackedRef.get();

  if (!trackedSnap.exists) {
    console.warn(`[SKIP] ${upper}: tracked-symbols document does not exist; nothing to retrigger`);
    return;
  }

  const trackedData = trackedSnap.data() as Record<string, unknown> | undefined;
  if (!trackedData || Object.keys(trackedData).length === 0) {
    console.warn(
      `[WARN] ${upper}: tracked-symbols document is empty; recreating as-is will still fire onSymbolAdded`,
    );
  }

  console.log(`[RETRIGGER] ${upper}: deleting tracked-symbols doc to re-fire onSymbolAdded`);
  await trackedRef.delete();

  console.log(`[RETRIGGER] ${upper}: recreating tracked-symbols doc`);
  await trackedRef.set(trackedData ?? {});
}

async function main() {
  const symbols = await loadIncompleteSymbols();
  console.log(`--- backfill-symbol-data-from-report: ${symbols.length} symbol(s) ---`);

  let created = 0;
  let skipped = 0;
  let failures = 0;

  for (const symbol of symbols) {
    try {
      await backfillSymbolData(symbol);
      created++;
    } catch (err) {
      failures++;
      console.error(`[ERROR] Failed to backfill symbol-data for ${symbol}:`, err);
    }
  }

  console.log(`Backfill completed. Created=${created}, Skipped=${skipped}, Failures=${failures}`);
}

main().catch((err) => {
  console.error('backfill-symbol-data-from-report error', err);
  process.exit(1);
});
