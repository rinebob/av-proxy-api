/**
 * Backfill script: Fetch AV non-time-series endpoints for a set of symbols.
 *
 * Purpose:
 *   Manually seed/populate Firestore for Alpha Vantage "other" endpoints
 *   (e.g., OVERVIEW, EARNINGS, EARNINGS_ESTIMATES, ETF_PROFILE, etc.)
 *   across all or a subset of tracked symbols.
 *
 * What it does per {endpoint, symbol}:
 *   - Calls the existing v2 handler via AlphaVantageHandlerFactory
 *   - Lets the handler + saveAvData()/refresh manager write to Firestore
 *   - Records a health-metrics entry with trigger=BACKFILL_SCRIPT
 *
 * Usage (from functions/):
 *   npx ts-node -r tsconfig-paths/register ./scripts/backfill/backfill-av-other-endpoints.ts
 *
 * CLI arguments (preferred over env vars):
 *   --endpoints OVERVIEW,EARNINGS,EARNINGS_ESTIMATES,ETF_PROFILE   // required, AV endpoint ids
 *   --symbols   AAPL,MSFT,QQQ                                     // optional; default = all tracked symbols
 *   --dry-run                                                     // optional; log only, no network calls
 *   --env       emulators|prod                                    // optional; default = emulators
 *
 * NOTE: This script ENFORCES a fixed inter-request delay to respect
 * Alpha Vantage's 75 requests/minute rate limit. We currently use a
 * 1000ms delay between calls (~60 req/min) as a safety margin.
 */
// Environment selection MUST happen before loading firebase-admin.
// Default to emulators for safety; allow explicit --env prod to hit Prod.
type BackfillEnvironment = 'emulators' | 'prod';

function detectEnvironmentFromArgv(argv: string[]): BackfillEnvironment {
  const args = argv.slice(2);
  let env: BackfillEnvironment = 'emulators';

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--env' && args[i + 1]) {
      const v = String(args[++i]).toLowerCase();
      if (v === 'prod') env = 'prod';
      if (v === 'emulators') env = 'emulators';
      continue;
    }
    if (arg.startsWith('--env=')) {
      const v = arg.split('=', 2)[1].toLowerCase();
      if (v === 'prod') env = 'prod';
      if (v === 'emulators') env = 'emulators';
      continue;
    }
  }

  return env;
}

const BACKFILL_ENV: BackfillEnvironment = detectEnvironmentFromArgv(process.argv);

if (BACKFILL_ENV === 'emulators') {
  // Ensure Firebase Emulator env is set BEFORE loading any firebase-admin modules.
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  require('../scripts-util').setupEmulator();
}

import { db } from '../../src/firebase-admin-init';

import { AlphaVantageHandlerFactory } from '../../src/v2/alpha-vantage/alpha-vantage-factory';
import { AlphaVantageEndpoint } from '@shared/alpha-vantage';
import { FirestoreCollection, RefreshStatus, RefreshTrigger } from '@shared/firestore';
import { HealthMetricsService } from '../../src/v2/health-metrics/health-metrics.service';

// Alpha Vantage free tier: 75 requests/minute.
// We hard-code a 1000ms delay between calls (~60 req/min) to stay within limits.
const DELAY_MS_PER_REQUEST = 1000;

function logInfo(...args: unknown[]): void {
  // eslint-disable-next-line no-console
  console.log('[backfill-av-other-endpoints]', ...args);
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function parseEndpointList(raw: string | undefined): AlphaVantageEndpoint[] {
  if (!raw) {
    throw new Error('--endpoints is required (comma-separated AV endpoint ids, e.g. "OVERVIEW,EARNINGS").');
  }
  const items = raw
    .split(',')
    .map(s => s.trim())
    .filter(Boolean);

  const endpoints: AlphaVantageEndpoint[] = [];
  for (const id of items) {
    if ((AlphaVantageEndpoint as any)[id] == null) {
      throw new Error(`Unknown AlphaVantageEndpoint id: ${id}`);
    }
    endpoints.push((AlphaVantageEndpoint as any)[id] as AlphaVantageEndpoint);
  }
  return endpoints;
}

async function getTrackedSymbols(): Promise<string[]> {
  const snap = await db.collection(FirestoreCollection.TRACKED_SYMBOLS).get();
  return snap.docs.map(d => d.id.toUpperCase());
}

async function getTargetSymbols(symbolsRaw: string | undefined): Promise<string[]> {
  if (symbolsRaw && symbolsRaw.trim().length > 0) {
    return symbolsRaw
      .split(',')
      .map(s => s.trim().toUpperCase())
      .filter(Boolean);
  }
  return getTrackedSymbols();
}

interface CliArgs {
  endpointsRaw?: string;
  symbolsRaw?: string;
  dryRun: boolean;
  env: BackfillEnvironment;
}

function parseCliArgs(argv: string[]): CliArgs {
  const args = argv.slice(2);
  let endpointsRaw: string | undefined;
  let symbolsRaw: string | undefined;
  let dryRun = false;
  let env: BackfillEnvironment = BACKFILL_ENV;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--endpoints' && args[i + 1]) {
      endpointsRaw = args[++i];
      continue;
    }
    if (arg.startsWith('--endpoints=')) {
      endpointsRaw = arg.split('=', 2)[1];
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
    if (arg === '--dry-run') {
      dryRun = true;
      continue;
    }
    if (arg === '--env' && args[i + 1]) {
      const v = String(args[++i]).toLowerCase();
      if (v === 'prod') env = 'prod';
      if (v === 'emulators') env = 'emulators';
      continue;
    }
    if (arg.startsWith('--env=')) {
      const v = arg.split('=', 2)[1].toLowerCase();
      if (v === 'prod') env = 'prod';
      if (v === 'emulators') env = 'emulators';
      continue;
    }
  }

  return { endpointsRaw, symbolsRaw, dryRun, env };
}

async function backfillEndpointForSymbol(
  endpoint: AlphaVantageEndpoint,
  symbol: string,
  dryRun: boolean,
): Promise<void> {
  const hms = new HealthMetricsService();
  const started = Date.now();

  if (dryRun) {
    logInfo(`DRY_RUN fetch ${endpoint} ${symbol}`);
    return;
  }

  try {
    const handler: any = AlphaVantageHandlerFactory.createHandler(endpoint);
    await handler.fetch({ symbol });
    const duration = Date.now() - started;
    await hms.recordSymbolRefresh(
      endpoint as any,
      symbol,
      RefreshStatus.SUCCESS,
      duration,
      undefined,
      { trigger: RefreshTrigger.BACKFILL_SCRIPT },
    );
    logInfo(`seeded ${endpoint} for ${symbol} in ${duration}ms`);
  } catch (e: any) {
    const duration = Date.now() - started;
    await hms.recordSymbolRefresh(
      endpoint as any,
      symbol,
      RefreshStatus.FAILURE,
      duration,
      String(e?.message || e),
      { trigger: RefreshTrigger.BACKFILL_SCRIPT },
    );
    logInfo(`ERROR ${endpoint} ${symbol}: ${e?.message || e}`);
    throw e;
  }
}

async function main(): Promise<void> {
  const { endpointsRaw, symbolsRaw, dryRun, env } = parseCliArgs(process.argv);

  const endpoints = parseEndpointList(endpointsRaw);
  const symbols = await getTargetSymbols(symbolsRaw);

  const isEmu = !!process.env.FIRESTORE_EMULATOR_HOST || String(process.env.FUNCTIONS_EMULATOR || '') === 'true';
  const target = isEmu
    ? `EMULATOR (${process.env.FIRESTORE_EMULATOR_HOST || 'unknown-host'})`
    : `PROJECT ${(process.env.GOOGLE_CLOUD_PROJECT || process.env.GCLOUD_PROJECT || 'unknown-project')}`;

  logInfo('preflight', {
    target,
    endpoints: endpoints.map(e => e.toString()),
    symbolsCount: symbols.length,
    scope: symbolsRaw ? `subset [${symbols.join(', ')}]` : 'ALL tracked symbols',
    dryRun,
    env,
    delayMs: DELAY_MS_PER_REQUEST,
  });

  let idx = 0;
  for (const symbol of symbols) {
    idx++;
    logInfo(`\n[${idx}/${symbols.length}] SYMBOL ${symbol}`);
    for (const endpoint of endpoints) {
      logInfo(`  → ${endpoint}`);
      try {
        await backfillEndpointForSymbol(endpoint, symbol, dryRun);
      } catch {
        // Continue to next endpoint/symbol; errors are logged per-call
      }
      await sleep(DELAY_MS_PER_REQUEST);
    }
  }

  logInfo('backfill complete');
}

main().catch((e) => {
  // eslint-disable-next-line no-console
  console.error('[backfill-av-other-endpoints] fatal', e?.message || e);
  process.exitCode = 1;
});
