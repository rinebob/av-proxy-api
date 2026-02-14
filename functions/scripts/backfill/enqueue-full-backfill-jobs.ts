/**
 * Enqueue FULL_BACKFILL time-series jobs for Alpha Vantage D/W/M
 * intervals using the existing time-series jobs pipeline.
 *
 * Usage (from functions/):
 *   TS_TIME_SERIES_TASKS_ENABLED=true \
 *   SYMBOLS=AAPL,MSFT              # optional subset, otherwise all tracked-symbols
 *   INCLUDE_WEEKLY=1               # optional, default 1
 *   INCLUDE_MONTHLY=1              # optional, default 1
 *   MARKET_DATE=2026-01-22         # optional, default today (ET)
 *   npx ts-node -r tsconfig-paths/register ./scripts/enqueue-full-backfill-jobs.ts
 */

// Ensure Firebase Emulator env is set BEFORE loading any firebase-admin modules.
// eslint-disable-next-line @typescript-eslint/no-var-requires
require('../scripts-util').setupEmulator();

import { AlphaVantageEndpoint } from '@shared/alpha-vantage';

import { enqueueFullBackfillJobsForEndpoint } from '../src/v2/alpha-vantage/data-refresher/av-time-series-refresh-manager';
import { betterLogger } from '../src/v2/utils/utils';

const scriptLogger = betterLogger('script.fullBackfill');

function getBoolEnv(name: string, defaultVal: boolean): boolean {
  const raw = String(process.env[name] || '').trim().toLowerCase();
  if (!raw) return defaultVal;
  if (raw === '1' || raw === 'true' || raw === 'yes' || raw === 'y') return true;
  if (raw === '0' || raw === 'false' || raw === 'no' || raw === 'n') return false;
  return defaultVal;
}

async function main() {
  const symbolsEnv = String(process.env.SYMBOLS || '').trim();
  const includeWeekly = getBoolEnv('INCLUDE_WEEKLY', true);
  const includeMonthly = getBoolEnv('INCLUDE_MONTHLY', true);
  const marketDate = String(process.env.MARKET_DATE || '').trim() || undefined;

  const symbols = symbolsEnv
    ? symbolsEnv.split(',').map((s) => s.trim().toUpperCase()).filter(Boolean)
    : undefined;

  scriptLogger.info(
    `enqueue_full_backfill.preflight marketDate=${marketDate || 'auto(et)'} includeWeekly=${includeWeekly} includeMonthly=${includeMonthly} symbols=${
      symbols ? symbols.join(',') : 'ALL'
    }`,
    {
      function: 'enqueue-full-backfill-jobs',
      marketDate: marketDate || 'auto(et)',
      includeWeekly,
      includeMonthly,
      symbols: symbols || 'ALL',
    } as any,
  );

  const results: any[] = [];

  // DAILY is always included
  results.push(await enqueueFullBackfillJobsForEndpoint({
    endpoint: AlphaVantageEndpoint.TIME_SERIES_DAILY_ADJUSTED,
    marketDate,
    symbols,
  }));

  if (includeWeekly) {
    results.push(await enqueueFullBackfillJobsForEndpoint({
      endpoint: AlphaVantageEndpoint.TIME_SERIES_WEEKLY_ADJUSTED,
      marketDate,
      symbols,
    }));
  }

  if (includeMonthly) {
    results.push(await enqueueFullBackfillJobsForEndpoint({
      endpoint: AlphaVantageEndpoint.TIME_SERIES_MONTHLY_ADJUSTED,
      marketDate,
      symbols,
    }));
  }

  scriptLogger.info(
    `enqueue_full_backfill.summary count=${results.length} daily=${JSON.stringify(results[0] || {})}`,
    {
      function: 'enqueue-full-backfill-jobs',
      results,
    } as any,
  );
}

main().catch((e) => {
  const msg = String(e?.message || e);
  scriptLogger.error(`enqueue_full_backfill.fatal error=${msg}`, {
    function: 'enqueue-full-backfill-jobs',
    error: msg,
  } as any);
  process.exitCode = 1;
});
