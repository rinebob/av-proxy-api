// Set env vars / emulator BEFORE other imports
import * as dotenv from 'dotenv';
import * as path from 'path';
import * as fs from 'fs';
import { setupEmulator } from '../scripts-util';

setupEmulator();
dotenv.config({ path: path.resolve(__dirname, '..', '.env.alpha-vantage-proxy-api') });

import { db } from '../../src/firebase-admin-init';
import { FirestoreCollection } from '@shared/firestore';
import { AlphaVantageEndpoint } from '@shared/alpha-vantage';
import { ApiProvider } from '@shared/core';
import { getSymbolTimeSeriesDocPath } from '../../src/v2/common/firestore/firestore-paths';
const ENABLE_DEEP_CHECK = process.env.DEEP_SA_CHECK === '1';

interface SymbolIssues {
  symbol: string;
  issues: string[];
}

async function getSymbols(): Promise<string[]> {
  // Use tracked-symbols as the universe of symbols we care about, then
  // independently inspect the corresponding symbol-data documents. This
  // ensures we also check symbols whose symbol-data/{symbol} parent doc is
  // "missing" (only subcollections).
  const snapshot = await db.collection(FirestoreCollection.TRACKED_SYMBOLS).get();
  return snapshot.docs.map((d) => d.id).sort();
}

async function checkSeriesForSymbol(symbol: string): Promise<SymbolIssues | null> {
  const upper = symbol.toUpperCase();
  const issues: string[] = [];

  const symbolDocRef = db.doc(`${FirestoreCollection.SYMBOL_DATA}/${upper}`);
  const symbolSnap = await symbolDocRef.get();

  if (!symbolSnap.exists) {
    // If the symbol-data doc doesn't exist at all, treat that as incomplete.
    issues.push(`${upper}: symbol-data document is missing`);
  } else {
    const data = symbolSnap.data() as Record<string, unknown> | undefined;
    const fieldCount = data ? Object.keys(data).length : 0;
    if (!fieldCount) {
      issues.push(`${upper}: symbol-data document is empty (no fields)`);
    }
  }

  // Optionally perform a deeper completeness check against sa-time-series
  // for the primary adjusted endpoints (daily/weekly/monthly).
  if (ENABLE_DEEP_CHECK) {
    const endpoints: AlphaVantageEndpoint[] = [
      AlphaVantageEndpoint.TIME_SERIES_DAILY_ADJUSTED,
      AlphaVantageEndpoint.TIME_SERIES_WEEKLY_ADJUSTED,
      AlphaVantageEndpoint.TIME_SERIES_MONTHLY_ADJUSTED,
    ];

    for (const endpoint of endpoints) {
      const parentPath = getSymbolTimeSeriesDocPath(
        upper,
        endpoint,
        ApiProvider.ALPHA_VANTAGE,
        true, // isSplitAdjusted -> sa-time-series
      );

      const parentRef = db.doc(parentPath);
      const parentSnap = await parentRef.get();

      if (!parentSnap.exists) {
        issues.push(
          `${upper}: missing sa-time-series parent document for endpoint ${endpoint} at ${parentPath}`,
        );
        continue;
      }

      // Ensure there is at least one shard document under some year
      // subcollection beneath the parent. We intentionally keep this
      // lightweight by only checking for the existence of a single
      // document, not enumerating the full history.
      const subcollections = await parentRef.listCollections();

      if (!subcollections.length) {
        issues.push(
          `${upper}: sa-time-series parent exists for endpoint ${endpoint} but has no year subcollections`,
        );
        continue;
      }

      let hasShard = false;
      for (const sub of subcollections) {
        const shardSnap = await sub.limit(1).get();
        if (!shardSnap.empty) {
          hasShard = true;
          break;
        }
      }

      if (!hasShard) {
        issues.push(
          `${upper}: sa-time-series parent exists for endpoint ${endpoint} but no shard documents were found in any year subcollection`,
        );
      }
    }
  }

  if (!issues.length) {
    return null;
  }

  return { symbol: upper, issues };
}

async function main() {
  const symbols = await getSymbols();
  console.log('--- Database summary (global) ---');
  console.log(`Tracked symbols (tracked-symbols): ${symbols.length}`);

  // Global symbol-data stats for quick visibility into overall DB shape.
  const symbolDataSnap = await db.collection(FirestoreCollection.SYMBOL_DATA).get();
  const symbolDataTotal = symbolDataSnap.size;

  const trackedSet = new Set(symbols.map((s) => s.toUpperCase()));
  let symbolDataForTracked = 0;
  let emptySymbolDataDocs = 0;

  symbolDataSnap.forEach((doc) => {
    const id = doc.id.toUpperCase();
    if (trackedSet.has(id)) {
      symbolDataForTracked += 1;
    }

    const data = doc.data() as Record<string, unknown> | undefined;
    const fieldCount = data ? Object.keys(data).length : 0;
    if (!fieldCount) {
      emptySymbolDataDocs += 1;
    }
  });

  console.log(`symbol-data docs (total): ${symbolDataTotal}`);
  console.log(`symbol-data docs for tracked symbols: ${symbolDataForTracked}`);
  console.log(`symbol-data docs with no fields (empty): ${emptySymbolDataDocs}`);

  console.log('--- Per-symbol inspection ---');
  console.log(`Universe size: ${symbols.length} symbol(s)`);
  console.log(`Deep sa-time-series check: ${ENABLE_DEEP_CHECK ? 'ENABLED' : 'DISABLED'}`);

  const incomplete: SymbolIssues[] = [];

  for (const symbol of symbols) {
    const result = await checkSeriesForSymbol(symbol);
    if (result) {
      console.log(`[INCOMPLETE] ${result.symbol}:`);
      for (const issue of result.issues) {
        console.log(`  - ${issue}`);
      }
      incomplete.push(result);
    } else {
      console.log(`[OK] ${symbol.toUpperCase()}`);
    }
  }

  console.log('--- Incomplete summary ---');
  console.log(`Total incomplete symbols: ${incomplete.length}`);

  const resultPayload = incomplete.map((i) => ({ symbol: i.symbol, issues: i.issues }));
  const json = JSON.stringify(resultPayload, null, 2);

  console.log('INCOMPLETE_SYMBOLS_JSON=' + json);

  // Persist results to a JSON file for later inspection.
  const outputPath = path.resolve(__dirname, 'find-incomplete-sa-timeseries.output.json');
  fs.writeFileSync(outputPath, json, { encoding: 'utf8' });
  console.log(`Wrote incomplete symbol report to ${outputPath}`);
}

main().catch((err) => {
  console.error('find-incomplete-sa-timeseries error', err);
  process.exit(1);
});
