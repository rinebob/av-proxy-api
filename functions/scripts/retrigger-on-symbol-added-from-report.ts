// Prod-only maintenance script.
// Re-triggers onSymbolAdded for symbols listed in
// find-incomplete-sa-timeseries.output.json by deleting and recreating
// their tracked-symbols documents.

import * as dotenv from 'dotenv';
import * as path from 'path';
import * as fs from 'fs';
import { setupEmulator } from './scripts-util';

setupEmulator();
dotenv.config({ path: path.resolve(__dirname, '..', '.env.alpha-vantage-proxy-api') });

import { db } from '../src/firebase-admin-init';
import { FirestoreCollection } from '@shared/firestore';

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

async function retriggerForSymbol(symbol: string): Promise<void> {
  const upper = symbol.toUpperCase();
  const trackedRef = db.doc(`${FirestoreCollection.TRACKED_SYMBOLS}/${upper}`);

  const snap = await trackedRef.get();
  if (!snap.exists) {
    console.warn(`[SKIP] ${upper}: tracked-symbols document does not exist; nothing to retrigger`);
    return;
  }

  const data = snap.data() as Record<string, unknown> | undefined;
  if (!data || Object.keys(data).length === 0) {
    console.warn(`[WARN] ${upper}: tracked-symbols document is empty; recreating as-is will still fire onSymbolAdded`);
  }

  console.log(`[RETRIGGER] ${upper}: deleting tracked-symbols doc to re-fire onSymbolAdded`);
  await trackedRef.delete();

  console.log(`[RETRIGGER] ${upper}: recreating tracked-symbols doc`);
  await trackedRef.set(data ?? {});
}

async function main() {
  const symbols = await loadIncompleteSymbols();
  console.log(`--- retrigger-on-symbol-added-from-report: ${symbols.length} symbol(s) ---`);

  let success = 0;
  let failures = 0;

  for (const symbol of symbols) {
    try {
      await retriggerForSymbol(symbol);
      success++;
    } catch (err) {
      failures++;
      console.error(`[ERROR] Failed to retrigger ${symbol}:`, err);
    }
  }

  console.log(`Retrigger completed. Success=${success}, Failures=${failures}`);
}

main().catch((err) => {
  console.error('retrigger-on-symbol-added-from-report error', err);
  process.exit(1);
});
