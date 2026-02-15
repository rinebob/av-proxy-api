/**
 * Script: enrich-bulk-import-with-etfs.ts
 *
 * Purpose:
 *   Build a ticker -> ETFs[] crosswalk from Firestore `etf-holdings/*`,
 *   then generate a secondary universe JSON containing symbols that
 *   appear in XL* ETF holdings but are NOT in the primary universe
 *
 * Inputs:
 *   - Firestore collection: etf-holdings/{ETF}
 *   - Primary JSON file (from repo root): bulk-import.enriched_spy-qqq.json
 *
 * Output:
 *   - Secondary JSON file (repo root): bulk-import.enriched_XL-non-spy-qqq.json
 *
 * Usage (from functions/ directory):
 *
 *   npx ts-node -r tsconfig-paths/register -P scripts/tsconfig.json \
 *     symbols/enrich-bulk-import-with-etfs.ts
 */

import * as fs from 'fs';
import * as path from 'path';

import { db } from '../../src/firebase-admin-init';

interface BulkImportItem {
  symbol: string;
  name: string;
  exchange?: string;
  etfs?: string[];
}

interface Holding {
  ticker: string;
  name?: string;
}

interface EtfHoldingsDoc {
  ticker: string; // ETF ticker, e.g. XBI
  holdings: Holding[];
}

function normalizeTicker(raw: string): string {
  return raw.trim().toUpperCase().replace(/\./g, '-');
}

interface Crosswalk {
  tickerToEtfs: Map<string, Set<string>>;
  tickerToName: Map<string, string>;
}

async function buildCrosswalk(): Promise<Crosswalk> {
  const tickerToEtfs = new Map<string, Set<string>>();
  const tickerToName = new Map<string, string>();

  // Read all docs from etf-holdings
  const snapshot = await db.collection('etf-holdings').get();

  // eslint-disable-next-line no-console
  console.log(`Loaded ${snapshot.size} etf-holdings documents from Firestore.`);

  snapshot.forEach((doc) => {
    const data = doc.data() as Partial<EtfHoldingsDoc>;
    const etfTicker = (data.ticker ?? doc.id).toString().toUpperCase();
    const holdings = Array.isArray(data.holdings) ? data.holdings : [];

    for (const h of holdings) {
      if (!h || !h.ticker) {
        continue;
      }

      const symbol = normalizeTicker(h.ticker);
      if (!tickerToEtfs.has(symbol)) {
        tickerToEtfs.set(symbol, new Set<string>());
      }
      tickerToEtfs.get(symbol)!.add(etfTicker);

      if (h.name && !tickerToName.has(symbol)) {
        tickerToName.set(symbol, h.name.trim());
      }
    }
  });

  // eslint-disable-next-line no-console
  console.log(`Built ticker->ETF map for ${tickerToEtfs.size} unique tickers.`);

  return { tickerToEtfs, tickerToName };
}

function loadBulkUniverse(rootDir: string, filename: string): BulkImportItem[] {
  const inputPath = path.resolve(rootDir, filename);
  const raw = fs.readFileSync(inputPath, 'utf-8');
  const data = JSON.parse(raw) as unknown;

  if (!Array.isArray(data)) {
    throw new Error('stock_universe.bulk-import.json is not an array');
  }

  return data as BulkImportItem[];
}

function buildNonSpyQqqUniverse(
  tickerToEtfs: Map<string, Set<string>>,
  tickerToName: Map<string, string>,
  primaryUniverseSymbols: Set<string>,
): BulkImportItem[] {
  const items: BulkImportItem[] = [];

  for (const [symbol, etfs] of tickerToEtfs.entries()) {
    if (primaryUniverseSymbols.has(symbol)) {
      continue;
    }

    const name = tickerToName.get(symbol) ?? symbol;
    items.push({
      symbol,
      name,
      etfs: Array.from(etfs).sort(),
    });
  }

  // Sort for stable output
  items.sort((a, b) => a.symbol.localeCompare(b.symbol));

  // eslint-disable-next-line no-console
  console.log(`Built secondary universe with ${items.length} symbols not present in primary file.`);

  return items;
}

function writeUniverse(rootDir: string, filename: string, items: BulkImportItem[]): void {
  const outputPath = path.resolve(rootDir, filename);
  fs.writeFileSync(outputPath, JSON.stringify(items, null, 2), {
    encoding: 'utf-8',
  });

  // eslint-disable-next-line no-console
  console.log(`Wrote universe to ${outputPath}`);
}

async function main(): Promise<void> {
  const rootDir = path.resolve(__dirname, '..', '..'); // repo root (../.. from functions/scripts/lib)

  // eslint-disable-next-line no-console
  console.log('Building ticker->ETF crosswalk from etf-holdings/* ...');
  const { tickerToEtfs, tickerToName } = await buildCrosswalk();

  // eslint-disable-next-line no-console
  console.log('Loading primary universe: bulk-import.enriched_spy-qqq.json ...');
  const primary = loadBulkUniverse(rootDir, 'bulk-import.enriched_spy-qqq.json');

  // eslint-disable-next-line no-console
  console.log(`Loaded ${primary.length} BulkImportItem records from primary universe.`);

  // Track which symbols are already in the primary file
  const primarySymbols = new Set<string>();
  for (const item of primary) {
    primarySymbols.add(normalizeTicker(item.symbol));
  }

  // Build secondary universe: symbols that appear in XL* holdings but not in primary
  const secondary = buildNonSpyQqqUniverse(tickerToEtfs, tickerToName, primarySymbols);
  writeUniverse(rootDir, 'bulk-import.enriched_XL-non-spy-qqq.json', secondary);
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error('Fatal error in enrich-bulk-import-with-etfs:', err);
  process.exitCode = 1;
});
