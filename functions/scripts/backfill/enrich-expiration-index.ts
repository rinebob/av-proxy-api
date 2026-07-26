/**
 * Backfill script: enriches Firestore ts-expirations docs with firstObserved
 * and observationCount from a timeseries-coverage CSV.
 *
 * Reads the CSV, groups rows by expiration date, computes:
 *   - firstObserved = min(firstObserved) across all contracts for that expiration
 *   - observationCount = sum(observationCount) across all contracts for that expiration
 * Then patches each ts-expirations doc in Firestore.
 *
 * Usage (from functions/):
 *   SYMBOL=QQQ \
 *   CSV_FILE=./scripts/diagnostics/output/timeseries-coverage-QQQ-2026-07-25T16-20-54.csv \
 *   npx ts-node -r tsconfig-paths/register ./scripts/backfill/enrich-expiration-index.ts
 *
 * For dry-run (no writes), add DRY_RUN=1.
 */

/**
 * Minimal RFC-4180-aware CSV line parser.
 * Handles quoted fields, embedded commas, and doubled quotes ("").
 * Returns an array of field values for a single logical line.
 */
function parseCsvLine(line: string): string[] {
  const fields: string[] = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const ch = line[i];

    if (inQuotes) {
      if (ch === '"') {
        if (line[i + 1] === '"') {
          current += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        current += ch;
      }
    } else {
      if (ch === '"') {
        inQuotes = true;
      } else if (ch === ',') {
        fields.push(current);
        current = '';
      } else {
        current += ch;
      }
    }
  }

  fields.push(current);
  return fields;
}

// Ensure Firebase Emulator env is set BEFORE loading any firebase-admin modules.
// eslint-disable-next-line @typescript-eslint/no-var-requires
require('../scripts-util').setupEmulator();

import { readFileSync } from 'fs';
import { db } from '../../src/firebase-admin-init';
import {
  OPTIONS_FILE_INDEX_COLLECTION,
  TS_EXPIRATIONS_SUBCOLLECTION,
} from '@shared/options';

interface CsvRow {
  contractId: string;
  expiration: string;
  strike: string;
  type: string;
  firstObserved: string;
  lastObserved: string;
  observationCount: string;
  coverageDays: string;
  dataSpanDays: string;
}

interface ExpirationAggregate {
  firstObserved: string;
  /** Sum of per-contract observation counts from the CSV. */
  observationCount: number;
}

function parseCsv(filePath: string): CsvRow[] {
  const content = readFileSync(filePath, 'utf-8');
  // Normalise CRLF to LF so split('\n') yields clean logical lines.
  const lines = content.replace(/\r\n/g, '\n').trim().split('\n');
  if (lines.length < 2) return [];

  const headers = parseCsvLine(lines[0]);
  const rows: CsvRow[] = [];

  for (let i = 1; i < lines.length; i++) {
    const cols = parseCsvLine(lines[i]);
    if (cols.length < headers.length) continue;
    rows.push({
      contractId: cols[0],
      expiration: cols[1],
      strike: cols[2],
      type: cols[3],
      firstObserved: cols[4],
      lastObserved: cols[5],
      observationCount: cols[6],
      coverageDays: cols[7],
      dataSpanDays: cols[8],
    });
  }

  return rows;
}

function aggregateByExpiration(rows: CsvRow[]): Map<string, ExpirationAggregate> {
  const map = new Map<string, ExpirationAggregate>();

  for (const row of rows) {
    const exp = row.expiration;
    if (!exp) continue;

    const obsCount = parseInt(row.observationCount, 10) || 0;
    const firstObs = row.firstObserved;
    const existing = map.get(exp);

    if (!existing) {
      map.set(exp, { firstObserved: firstObs, observationCount: obsCount });
    } else {
      if (firstObs < existing.firstObserved) {
        existing.firstObserved = firstObs;
      }
      existing.observationCount += obsCount;
    }
  }

  return map;
}

async function main() {
  const symbol = (process.env.SYMBOL || '').trim().toUpperCase();
  const csvFile = (process.env.CSV_FILE || '').trim();
  const dryRun = (process.env.DRY_RUN || '').trim() === '1';

  if (!symbol || !csvFile) {
    console.error('Usage: SYMBOL=QQQ CSV_FILE=./path/to/coverage.csv [DRY_RUN=1] npx ts-node ...');
    process.exit(1);
  }

  console.log(`[enrich-expiration-index] Symbol: ${symbol}`);
  console.log(`[enrich-expiration-index] CSV: ${csvFile}`);
  console.log(`[enrich-expiration-index] Dry run: ${dryRun}`);

  const rows = parseCsv(csvFile);
  console.log(`[enrich-expiration-index] Parsed ${rows.length} CSV rows`);

  const aggregates = aggregateByExpiration(rows);
  console.log(`[enrich-expiration-index] Aggregated ${aggregates.size} expirations`);

  const symbolDocRef = db.collection(OPTIONS_FILE_INDEX_COLLECTION).doc(symbol);
  const expCol = symbolDocRef.collection(TS_EXPIRATIONS_SUBCOLLECTION);

  let written = 0;
  let skipped = 0;

  for (const [expiration, agg] of aggregates) {
    const expDocRef = expCol.doc(expiration);

    if (dryRun) {
      console.log(`  [DRY] ${expiration}: firstObserved=${agg.firstObserved}, observationCount=${agg.observationCount}`);
      continue;
    }

    const snap = await expDocRef.get();
    if (!snap.exists) {
      console.warn(`  [SKIP] ${expiration}: doc does not exist in Firestore`);
      skipped++;
      continue;
    }

    await expDocRef.set(
      {
        firstObserved: agg.firstObserved,
        observationCount: agg.observationCount,
      },
      { merge: true },
    );
    written++;
    console.log(`  [OK] ${expiration}: firstObserved=${agg.firstObserved}, observationCount=${agg.observationCount}`);
  }

  console.log(`[enrich-expiration-index] Done. Written: ${written}, Skipped: ${skipped}`);
  process.exit(0);
}

main().catch((err) => {
  console.error('[enrich-expiration-index] Fatal error:', err);
  process.exit(1);
});
