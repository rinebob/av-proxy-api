/**
 * Script: generate-bulk-import-universe.ts
 *
 * Builds a stock universe suitable for bulkImportSymbolsV2 from public sources.
 *
 * - Scrapes S&P 500 and Nasdaq-100 constituents from Wikipedia
 * - Normalizes tickers (e.g. BRK.B -> BRK-B)
 * - Tags ETF memberships (SPY, QQQ, and sector SPDRs)
 * - Attempts to enrich missing exchange info using Yahoo Finance v2
 * - Emits a JSON array of BulkImportItem objects to stdout and to disk
 *
 * Usage (after installing deps and ts-node):
 *   npx ts-node scripts/generate-bulk-import-universe.ts
 */

import axios from 'axios';
import * as cheerio from 'cheerio';
import yahooFinance from 'yahoo-finance2';
import * as fs from 'fs';
import { BulkImportItem } from '@shared/alpha-vantage';

interface SectorMap {
  [key: string]: string;
}

interface UniverseEntry {
  symbol: string;
  name: string;
  exchange?: string;
  etfs: string[];
}

const SP500_URL = 'https://en.wikipedia.org/wiki/List_of_S%26P_500_companies';
const NDX_URL = 'https://en.wikipedia.org/wiki/Nasdaq-100';

// Map GICS sector name -> sector ETF
const SECTOR_MAP: SectorMap = {
  'Information Technology': 'XLK',
  'Health Care': 'XLV',
  Financials: 'XLF',
  'Consumer Discretionary': 'XLY',
  'Communication Services': 'XLC',
  Industrials: 'XLI',
  'Consumer Staples': 'XLP',
  Energy: 'XLE',
  Utilities: 'XLU',
  'Real Estate': 'XLRE',
  Materials: 'XLB',
};

const OUTPUT_JSON_PATH = 'stock_universe.bulk-import.json';

function normalizeTicker(raw: string): string {
  return raw.trim().toUpperCase().replace(/\./g, '-');
}

function resolveSectorEtf(sectorText: string): string | undefined {
  const normalized = sectorText.trim().toLowerCase();

  // Try exact key match first
  if (SECTOR_MAP[sectorText]) {
    return SECTOR_MAP[sectorText];
  }

  // Fallback: case-insensitive substring match to tolerate footnotes or minor wording diffs
  for (const [key, etf] of Object.entries(SECTOR_MAP)) {
    if (normalized.includes(key.toLowerCase())) {
      return etf;
    }
  }

  return undefined;
}

async function fetchSp500(): Promise<Map<string, UniverseEntry>> {
  console.log('Fetching S&P 500 constituents from Wikipedia...');
  const res = await axios.get<string>(SP500_URL, {
    headers: {
      // Wikipedia requires a descriptive User-Agent; use a standard browser UA here.
      'User-Agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0 Safari/537.36',
      'Accept-Language': 'en-US,en;q=0.9',
    },
  });
  const $ = cheerio.load(res.data);

  const universe = new Map<string, UniverseEntry>();

  const table = $('table.wikitable').first();
  table.find('tbody tr').each((_, row) => {
    const cols = $(row).find('td');
    if (cols.length === 0) {
      return;
    }

    const tickerText = $(cols[0]).text().trim();
    const nameText = $(cols[1]).text().trim();
    const sectorText = $(cols[3]).text().trim();

    if (!tickerText || !nameText) {
      return;
    }

    const symbol = normalizeTicker(tickerText);
    const sectorEtf = resolveSectorEtf(sectorText);
    const etfs = new Set<string>(['SPY']);
    if (sectorEtf) {
      etfs.add(sectorEtf);
    }

    universe.set(symbol, {
      symbol,
      name: nameText,
      exchange: undefined, // will be filled later via Yahoo Finance
      etfs: Array.from(etfs),
    });
  });

  console.log(`S&P 500: collected ${universe.size} symbols`);
  return universe;
}

async function fetchNasdaq100(universe: Map<string, UniverseEntry>): Promise<void> {
  console.log('Fetching Nasdaq-100 constituents from Wikipedia...');
  const res = await axios.get<string>(NDX_URL, {
    headers: {
      'User-Agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0 Safari/537.36',
      'Accept-Language': 'en-US,en;q=0.9',
    },
  });
  const $ = cheerio.load(res.data);

  // Heuristically pick the first table that contains the word "Ticker" in the header
  const table = $('table')
    .filter((_, el) => $(el).text().includes('Ticker'))
    .first();

  const seen = new Set<string>();

  table.find('tbody tr').each((_, row) => {
    const cols = $(row).find('td');
    if (cols.length === 0) {
      return;
    }

    const col0 = $(cols[0]).text().trim();
    const col1 = $(cols[1]).text().trim();

    if (!col0 || !col1) {
      return;
    }

    // Heuristic: ticker is usually shorter & all caps
    const candidateA = normalizeTicker(col0);
    const candidateB = normalizeTicker(col1);

    const pickA = /^[A-Z.\-]+$/.test(candidateA) && candidateA.length <= candidateB.length;
    const symbol = pickA ? candidateA : candidateB;
    const name = pickA ? col1 : col0;

    if (seen.has(symbol)) {
      return;
    }
    seen.add(symbol);

    if (universe.has(symbol)) {
      const existing = universe.get(symbol)!;
      if (!existing.etfs.includes('QQQ')) {
        existing.etfs.push('QQQ');
      }
      existing.exchange = existing.exchange ?? 'NASDAQ';
    } else {
      universe.set(symbol, {
        symbol,
        name,
        exchange: 'NASDAQ',
        etfs: ['QQQ'],
      });
    }
  });

  console.log('Nasdaq-100 merge complete.');
}

async function enrichExchanges(universe: Map<string, UniverseEntry>): Promise<void> {
  const entries = Array.from(universe.values());
  const unknowns = entries.filter((e) => !e.exchange || e.exchange === 'Unknown');

  console.log(`Enriching exchange data via Yahoo Finance for ${unknowns.length} symbols...`);

  const CHUNK_SIZE = 50;

  for (let i = 0; i < unknowns.length; i += CHUNK_SIZE) {
    const chunk = unknowns.slice(i, i + CHUNK_SIZE);
    const symbols = chunk.map((s) => s.symbol);

    try {
      const quotes = (await yahooFinance.quote(symbols as any)) as any;
      const quoteArray: any[] = Array.isArray(quotes) ? quotes : [quotes];

      for (const q of quoteArray) {
        const quoteAny = q as any;

        if (!quoteAny || !quoteAny.symbol) {
          continue;
        }
        const symbol = normalizeTicker(quoteAny.symbol as string);
        const entry = universe.get(symbol);
        if (!entry) {
          continue;
        }

        const exchRaw = (quoteAny.exchange as string | undefined) ?? '';
        let exch: string | undefined;
        if (exchRaw.includes('NMS') || exchRaw.includes('NAS')) {
          exch = 'NASDAQ';
        } else if (exchRaw.includes('NYQ') || exchRaw.includes('NYS')) {
          exch = 'NYSE';
        } else if (exchRaw) {
          exch = exchRaw;
        }

        if (exch) {
          entry.exchange = exch;
        }
      }
    } catch (err) {
      console.error(`Error enriching exchanges for chunk starting at index ${i}:`, err);
    }

    // Basic throttling to be polite to Yahoo
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
}

function projectToBulkImportItems(universe: Map<string, UniverseEntry>): BulkImportItem[] {
  const items: BulkImportItem[] = [];

  for (const entry of universe.values()) {
    const item: BulkImportItem = {
      symbol: entry.symbol,
      name: entry.name,
    };

    if (entry.exchange) {
      item.exchange = entry.exchange;
    }

    if (entry.etfs.length > 0) {
      // Ensure deduped & uppercased
      const etfSet = new Set<string>(entry.etfs.map((e) => e.toUpperCase()));
      item.etfs = Array.from(etfSet).sort();
    }

    items.push(item);
  }

  // Sort for stable output (by symbol)
  items.sort((a, b) => a.symbol.localeCompare(b.symbol));

  return items;
}

async function main(): Promise<void> {
  const universe = await fetchSp500();
  await fetchNasdaq100(universe);
  await enrichExchanges(universe);

  const items = projectToBulkImportItems(universe);

  console.log(`\nGenerated ${items.length} BulkImportItem records.`);

  fs.writeFileSync(OUTPUT_JSON_PATH, JSON.stringify(items, null, 2), {
    encoding: 'utf-8',
  });

  console.log(`Wrote JSON payload to ${OUTPUT_JSON_PATH}`);
  console.log('\nSample (first 5 items):');
  console.log(JSON.stringify(items.slice(0, 5), null, 2));
}

main().catch((err) => {
  console.error('Fatal error in generate-bulk-import-universe:', err);
  process.exitCode = 1;
});
