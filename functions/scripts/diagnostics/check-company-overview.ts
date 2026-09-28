/**
 * Diagnostic + repair script: Check that every tracked symbol has company overview
 * data at symbol-data/{SYMBOL}/company-overview/av-company-overview.
 *
 * Phase 1 — Audit: Reads all tracked-symbols, checks each for a company-overview doc.
 * Phase 2 — Fetch (optional, --fetch): For every missing symbol, calls the existing
 *           AvCompanyOverviewHandler via the factory to fetch + save the data.
 *
 * Usage (from functions/):
 *   npx ts-node -r tsconfig-paths/register ./scripts/diagnostics/check-company-overview.ts
 *
 * CLI flags:
 *   --fetch          Fetch company overview for missing symbols (default: audit only)
 *   --dry-run        Log what would be fetched; make no API calls
 *   --symbols X,Y    Only check/fetch a subset of symbols
 *   --delay-ms N     Inter-request delay in ms (default: 1000, AV rate limit safety)
 */
import { db } from '../../src/firebase-admin-init';
import { FirestoreCollection } from '@shared/firestore';
import { AlphaVantageEndpoint, TRACKED_SYMBOL_V2_FIELDS } from '@shared/alpha-vantage';
import { AlphaVantageHandlerFactory } from '../../src/v2/alpha-vantage/alpha-vantage-factory';
import { HealthMetricsService } from '../../src/v2/health-metrics/health-metrics.service';
import { RefreshStatus, RefreshTrigger } from '@shared/firestore';

const DEFAULT_DELAY_MS = 1000;

function logInfo(...args: unknown[]): void {
  console.log('[check-company-overview]', ...args);
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

interface CliArgs {
  fetch: boolean;
  dryRun: boolean;
  symbolsRaw?: string;
  delayMs: number;
}

function parseCliArgs(argv: string[]): CliArgs {
  const args = argv.slice(2);
  let fetch = false;
  let dryRun = false;
  let symbolsRaw: string | undefined;
  let delayMs = DEFAULT_DELAY_MS;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--fetch') {
      fetch = true;
      continue;
    }
    if (arg === '--dry-run') {
      dryRun = true;
      continue;
    }
    if (arg === '--symbols' && args[i + 1]) {
      symbolsRaw = args[++i];
      continue;
    }
    if (arg.startsWith('--symbols=')) {
      symbolsRaw = arg.split('=', 2)[1];
      continue;
    }
    if (arg === '--delay-ms' && args[i + 1]) {
      delayMs = Number(args[++i]) || DEFAULT_DELAY_MS;
      continue;
    }
    if (arg.startsWith('--delay-ms=')) {
      delayMs = Number(arg.split('=', 2)[1]) || DEFAULT_DELAY_MS;
      continue;
    }
  }

  return { fetch, dryRun, symbolsRaw, delayMs };
}

/**
 * Reads all tracked symbols from Firestore (or a filtered subset).
 */
async function getTrackedSymbols(symbolsRaw?: string): Promise<string[]> {
  if (symbolsRaw && symbolsRaw.trim().length > 0) {
    return symbolsRaw
      .split(',')
      .map(s => s.trim().toUpperCase())
      .filter(Boolean);
  }
  const snap = await db.collection(FirestoreCollection.TRACKED_SYMBOLS).get();
  return snap.docs.map(d => d.id.toUpperCase());
}

/**
 * Checks whether a company-overview doc exists for the given symbol.
 * Path: symbol-data/{SYMBOL}/company-overview/av-company-overview
 */
async function hasCompanyOverview(symbol: string): Promise<boolean> {
  const docPath = [
    FirestoreCollection.SYMBOL_DATA,
    symbol,
    FirestoreCollection.COMPANY_OVERVIEW,
    `av-${FirestoreCollection.COMPANY_OVERVIEW}`,
  ].join('/');
  const snap = await db.doc(docPath).get();
  return snap.exists;
}

/**
 * Fetches company overview for a single symbol via the existing handler.
 * The handler fetches from AV, transforms, saves to Firestore, and writes
 * back companyInfo to the tracked-symbols doc.
 */
async function fetchCompanyOverview(
  symbol: string,
  dryRun: boolean,
): Promise<{ success: boolean; empty?: boolean; error?: string; durationMs: number }> {
  const started = Date.now();

  if (dryRun) {
    logInfo(`DRY_RUN fetch OVERVIEW for ${symbol}`);
    return { success: true, durationMs: 0 };
  }

  const hms = new HealthMetricsService();

  try {
    const handler = AlphaVantageHandlerFactory.createHandler(AlphaVantageEndpoint.OVERVIEW);
    const response = await handler.fetch({ symbol });
    const durationMs = Date.now() - started;
    const hasData = response?.data && Object.keys(response.data).length > 0;

    await hms.recordSymbolRefresh(
      AlphaVantageEndpoint.OVERVIEW as any,
      symbol,
      hasData ? RefreshStatus.SUCCESS : RefreshStatus.FAILURE,
      durationMs,
      hasData ? undefined : 'Empty company overview response',
      { trigger: RefreshTrigger.BACKFILL_SCRIPT },
    );
    return { success: true, empty: !hasData, durationMs };
  } catch (e: any) {
    const durationMs = Date.now() - started;
    const errorMsg = String(e?.message || e);
    await hms.recordSymbolRefresh(
      AlphaVantageEndpoint.OVERVIEW as any,
      symbol,
      RefreshStatus.FAILURE,
      durationMs,
      errorMsg,
      { trigger: RefreshTrigger.BACKFILL_SCRIPT },
    );
    return { success: false, error: errorMsg, durationMs };
  }
}

async function main(): Promise<void> {
  const { fetch, dryRun, symbolsRaw, delayMs } = parseCliArgs(process.argv);

  const symbols = await getTrackedSymbols(symbolsRaw);

  logInfo(`Auditing ${symbols.length} tracked symbols for company-overview data...`);

  // Phase 1: Audit
  const missing: string[] = [];
  const present: string[] = [];
  const missingEquities: string[] = [];
  const missingETFs: string[] = [];

  for (let i = 0; i < symbols.length; i++) {
    const symbol = symbols[i];
    const exists = await hasCompanyOverview(symbol);
    if (exists) {
      present.push(symbol);
    } else {
      missing.push(symbol);
      // Read the type field from tracked-symbols to classify
      const tsSnap = await db.collection(FirestoreCollection.TRACKED_SYMBOLS).doc(symbol).get();
      const tsType = tsSnap.data()?.[TRACKED_SYMBOL_V2_FIELDS.TYPE] as string | undefined;
      if (tsType && tsType.toUpperCase() === 'ETF') {
        missingETFs.push(symbol);
      } else {
        missingEquities.push(symbol);
      }
    }
    if ((i + 1) % 50 === 0) {
      logInfo(`  checked ${i + 1}/${symbols.length}...`);
    }
  }

  logInfo('\n=== AUDIT RESULTS ===');
  logInfo(`Total tracked symbols: ${symbols.length}`);
  logInfo(`Have company-overview:  ${present.length}`);
  logInfo(`Missing:                ${missing.length} (equities: ${missingEquities.length}, ETFs: ${missingETFs.length})`);

  if (present.length > 0) {
    logInfo(`\nSymbols with company-overview data (comma-separated):\n${present.join(',')}`);
  }

  if (missingETFs.length > 0) {
    logInfo(`\nMissing ETFs (no AV company overview expected):\n  ${missingETFs.join('\n  ')}`);
  }

  if (missingEquities.length > 0) {
    logInfo(`\nMissing equities (should have company overview):\n  ${missingEquities.join('\n  ')}`);
    logInfo(`\nComma-separated (for --symbols flag):\n${missingEquities.join(',')}`);
  }

  if (missing.length === 0) {
    logInfo('\nAll tracked symbols have company-overview data. Nothing to do.');
    return;
  }

  // Only fetch equities — ETFs won't have AV company overview data
  const toFetch = missingEquities;

  if (toFetch.length === 0) {
    logInfo('\nAll missing symbols are ETFs — no fetch needed.');
    return;
  }

  // Phase 2: Fetch (optional)
  if (!fetch) {
    logInfo('\nTo fetch company overview for missing equities, re-run with:');
    logInfo(`  --fetch --symbols "${toFetch.join(',')}"`);
    return;
  }

  logInfo(`\n=== FETCH PHASE ===`);
  logInfo(`Fetching OVERVIEW for ${toFetch.length} missing equities (delay: ${delayMs}ms)...`);

  if (dryRun) {
    logInfo('DRY_RUN mode — no API calls will be made.');
  }

  let fetchedCount = 0;
  let emptyCount = 0;
  let failCount = 0;
  const fetchedSymbols: string[] = [];
  const emptySymbols: string[] = [];
  const failures: { symbol: string; error: string }[] = [];

  for (let i = 0; i < toFetch.length; i++) {
    const symbol = toFetch[i];
    logInfo(`\n[${i + 1}/${toFetch.length}] ${symbol}`);

    const result = await fetchCompanyOverview(symbol, dryRun);

    if (result.success && !result.empty) {
      fetchedCount++;
      fetchedSymbols.push(symbol);
      logInfo(`  ✓ fetched in ${result.durationMs}ms`);
    } else if (result.success && result.empty) {
      emptyCount++;
      emptySymbols.push(symbol);
      logInfo(`  ○ no data (likely ETF/index) in ${result.durationMs}ms`);
    } else {
      failCount++;
      failures.push({ symbol, error: result.error || 'unknown' });
      logInfo(`  ✗ ERROR: ${result.error}`);
    }

    // Rate-limit delay between requests (skip after last one)
    if (i < toFetch.length - 1) {
      await sleep(delayMs);
    }
  }

  logInfo('\n=== FETCH SUMMARY ===');
  logInfo(`Fetched with data: ${fetchedCount}`);
  logInfo(`No data (ETF/index): ${emptyCount}`);
  logInfo(`Failed:              ${failCount}`);

  if (fetchedSymbols.length > 0) {
    logInfo('\nSymbols fetched with data (for RS notification):');
    logInfo(`\nComma-separated:\n${fetchedSymbols.join(',')}`);
  }

  if (emptySymbols.length > 0) {
    logInfo('\nSymbols with no AV company overview data (likely ETFs/indexes):');
    logInfo(`  ${emptySymbols.join('\n  ')}`);
    logInfo(`\nComma-separated:\n${emptySymbols.join(',')}`);
  }

  if (failures.length > 0) {
    logInfo('\nFailed symbols:');
    for (const f of failures) {
      logInfo(`  ${f.symbol}: ${f.error}`);
    }
  }

  logInfo('\nDone.');
}

main().catch((e) => {
  console.error('[check-company-overview] fatal', e?.message || e);
  process.exitCode = 1;
});
