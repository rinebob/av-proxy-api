/**
 * Script: import-etf-holdings.ts
 *
 * Purpose:
 *   Ingest State Street ETF holdings spreadsheets (pasted/saved as text files)
 *   and persist them into Firestore for long-term reference.
 *
 * Firestore schema (per your request):
 *   Root collection: 'etf-holdings'
 *   Doc ID: <ETF_TICKER> (e.g. 'XBI')
 *
 *   Document shape:
 *   {
 *     fundName: string;
 *     ticker: string;        // e.g. 'XBI'
 *     asOfDate: string;      // e.g. '2025-10-17' (best-effort from header)
 *     source: 'STATE_STREET';
 *     rawHeaderLine: string; // the header row starting with 'ETF\tName\tTicker...'
 *     createdAt: FirebaseFirestore.Timestamp;
 *     updatedAt: FirebaseFirestore.Timestamp;
 *     holdings: Holding[];   // one element per row in the spreadsheet
 *   }
 *
 *   where Holding is:
 *   {
 *     etf: string;           // column "ETF" (usually same as ticker)
 *     name: string;          // company name
 *     ticker: string;        // company ticker (normalized to our style)
 *     identifier: string;    // Identifier column
 *     sedol: string;         // SEDOL column
 *     weight: number;        // as a percentage number (e.g. 2.242670)
 *     sector: string | null; // raw Sector column (often '-')
 *     sharesHeld: number;    // numeric Shares Held
 *     currency: string;      // Local Currency column
 *   }
 *
 * Usage (from functions/ directory):
 *
 *   1) Save the pasted holdings text into a UTF-8 file, e.g. scripts/data/XBI.txt
 *   2) Run:
 *
 *      npx ts-node -r tsconfig-paths/register -P scripts/tsconfig.json \
 *        scripts/import-etf-holdings.ts XBI scripts/data/XBI.txt
 *
 *   This will upsert Firestore document: etf-holdings/XBI
 */

import * as fs from 'fs';
import * as path from 'path';
import { Timestamp } from 'firebase-admin/firestore';

import { db } from '../src/firebase-admin-init';

interface Holding {
  etf: string;
  name: string;
  ticker: string;
  identifier: string;
  sedol: string;
  weight: number;
  sector: string | null;
  sharesHeld: number;
  currency: string;
}

interface EtfHoldingsDoc {
  fundName: string;
  ticker: string;
  asOfDate: string;
  source: 'STATE_STREET';
  rawHeaderLine: string;
  createdAt: Timestamp;
  updatedAt: Timestamp;
  holdings: Holding[];
}

function normalizeTicker(raw: string): string {
  // Match our symbol normalization elsewhere: upper-case and convert '.' to '-'.
  return raw.trim().toUpperCase().replace(/\./g, '-');
}

function parseAsOfDate(raw: string): string {
  // Expect patterns like: "Holdings:\tAs of 17-Oct-2025" or similar.
  const match = raw.match(/As of\s+(\d{1,2}-[A-Za-z]{3}-\d{4})/);
  if (!match) {
    return raw.trim();
  }

  const [dayStr, monStr, yearStr] = match[1].split('-');
  const day = Number(dayStr);
  const monthMap: Record<string, number> = {
    Jan: 1,
    Feb: 2,
    Mar: 3,
    Apr: 4,
    May: 5,
    Jun: 6,
    Jul: 7,
    Aug: 8,
    Sep: 9,
    Oct: 10,
    Nov: 11,
    Dec: 12,
  };
  const mon = monthMap[monStr as keyof typeof monthMap];
  const year = Number(yearStr);

  if (!mon || !year || !day) {
    return match[1];
  }

  const mm = String(mon).padStart(2, '0');
  const dd = String(day).padStart(2, '0');
  return `${year}-${mm}-${dd}`;
}

function parseHoldingsFile(etfTicker: string, filePath: string): EtfHoldingsDoc {
  const raw = fs.readFileSync(filePath, 'utf-8');
  const lines = raw.split(/\r?\n/).map((l) => l.trimEnd());

  let fundName = '';
  let asOfDateRaw = '';
  let headerLine = '';

  const holdings: Holding[] = [];

  for (const line of lines) {
    if (!line.trim()) {
      continue;
    }

    // Metadata lines
    if (line.startsWith('Fund Name:')) {
      // Format: "Fund Name:\tSPDR® S&P® Biotech ETF"
      const parts = line.split('\t').map((p) => p.trim()).filter(Boolean);
      // parts[0] = 'Fund Name:'; parts[1] = actual name
      if (parts.length >= 2) {
        fundName = parts.slice(1).join(' ');
      }
      continue;
    }

    if (line.startsWith('Holdings:')) {
      asOfDateRaw = line;
      continue;
    }

    // Header row begins with ETF column name
    if (!headerLine && line.startsWith('ETF')) {
      headerLine = line;
      continue;
    }

    // Skip anything before the header
    if (!headerLine) {
      continue;
    }

    // Data rows: expect tab-delimited columns matching the header order
    const cols = line.split('\t');
    if (cols.length < 8) {
      // Not a data row we understand
      continue;
    }

    const [etfCol, nameCol, tickerCol, identifierCol, sedolCol, weightCol, sectorCol, sharesCol, currencyCol] = cols;

    // Skip non-ETF rows (e.g. cash, SSI US GOV MONEY MARKET, FX) if they have no ticker
    const cleanTicker = tickerCol.trim();
    if (!cleanTicker) {
      continue;
    }

    const weight = Number(weightCol.trim() || '0');
    const sharesHeld = Number(sharesCol.trim() || '0');

    const holding: Holding = {
      etf: etfCol.trim() || etfTicker,
      name: nameCol.trim(),
      ticker: normalizeTicker(cleanTicker),
      identifier: identifierCol.trim(),
      sedol: sedolCol.trim(),
      weight: Number.isFinite(weight) ? weight : 0,
      sector: sectorCol.trim() && sectorCol.trim() !== '-' ? sectorCol.trim() : null,
      sharesHeld: Number.isFinite(sharesHeld) ? sharesHeld : 0,
      currency: (currencyCol ?? '').trim() || 'USD',
    };

    holdings.push(holding);
  }

  if (!fundName) {
    fundName = etfTicker;
  }

  const asOfDate = asOfDateRaw ? parseAsOfDate(asOfDateRaw) : '';
  const now = Timestamp.now();

  const doc: EtfHoldingsDoc = {
    fundName,
    ticker: etfTicker,
    asOfDate,
    source: 'STATE_STREET',
    rawHeaderLine: headerLine,
    createdAt: now,
    updatedAt: now,
    holdings,
  };

  return doc;
}

async function main(): Promise<void> {
  const [, , etfTickerArg, inputPathArg] = process.argv;

  if (!etfTickerArg || !inputPathArg) {
    // eslint-disable-next-line no-console
    console.error('Usage: ts-node scripts/import-etf-holdings.ts <ETF_TICKER> <inputFilePath>');
    process.exitCode = 1;
    return;
  }

  const etfTicker = etfTickerArg.toUpperCase();
  const inputPath = path.resolve(inputPathArg);

  // eslint-disable-next-line no-console
  console.log(`Importing ETF holdings for ${etfTicker} from ${inputPath}...`);

  const doc = parseHoldingsFile(etfTicker, inputPath);

  // Write to Firestore: collection 'etf-holdings' / doc {ticker}
  const ref = db.collection('etf-holdings').doc(etfTicker);
  await ref.set(doc, { merge: true });

  // eslint-disable-next-line no-console
  console.log(`Wrote ${doc.holdings.length} holdings to Firestore at etf-holdings/${etfTicker}.`);
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error('Fatal error in import-etf-holdings:', err);
  process.exitCode = 1;
});
