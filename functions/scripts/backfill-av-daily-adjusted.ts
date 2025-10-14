/**
 * Backfill script: Rebuild AV Daily Adjusted time-series for all tracked symbols.
 *
 * What it does per symbol:
 * - Deletes existing time-series/av-daily-adjusted subtree (years/*) and the parent series doc
 * - Calls the existing AvDailyTimeSeries handler with outputsize=FULL to write bars (year-sharded)
 * - Lets the handler write top-level time-series metadata and symbol doc metadata
 *
 * Usage (from functions/):
 *   npx ts-node -r tsconfig-paths/register ./scripts/backfill-av-daily-adjusted.ts
 *
 * Optional environment variables:
 *   SYMBOLS=AAPL,MSFT          // limit to a comma-separated list
 *   DRY_RUN=1                  // do not write, only print planned operations
 *   DELAY_MS=2500              // delay between symbols (default 2500ms)
 *   INCLUDE_WEEKLY=1           // also backfill WEEKLY_ADJUSTED
 *   INCLUDE_MONTHLY=1          // also backfill MONTHLY_ADJUSTED
 *   SCRIPT_HTTP_MAX_RETRIES=3  // max retries for transient network errors (default 3)
 *   SCRIPT_HTTP_RETRY_BASE_MS=1000 // base delay for retry backoff (default 1000ms)
 *   PROBE_MAX_RETRIES=3        // max retries for probeAlphaVantageConnectivity (default 3)
 *   PROBE_RETRY_BASE_MS=1500   // base delay for probe retry backoff (default 1500ms)
 *   ALLOW_NONDESTRUCTIVE_ON_PROBE_FAIL=1 // allow non-destructive backfill on probe failure (default 1)
 */

// Ensure Firebase Emulator env is set BEFORE loading any firebase-admin modules.
// Use runtime require to avoid import hoisting ordering.
// eslint-disable-next-line @typescript-eslint/no-var-requires
require('./scripts-util').setupEmulator();

// Prefer IPv4 for this script to avoid IPv6 connectivity issues on some networks
try {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const dns = require('node:dns');
  if (typeof dns.setDefaultResultOrder === 'function') {
    dns.setDefaultResultOrder('ipv4first');
  }
} catch { /* ignore */ }

import { db } from '../src/firebase-admin-init';
import axios from 'axios';

import { AlphaVantageHandlerFactory } from '../src/v2/alpha-vantage/alpha-vantage-factory';
import { AlphaVantageEndpoint, OutputSize } from '@shared/alpha-vantage';
import { ApiProvider } from '@shared/core';
import { FirestoreCollection } from '@shared/firestore';
import {
  getSymbolTimeSeriesDocPath,
  getSymbolTimeSeriesYearsCollectionPath,
  getSymbolTimeSeriesAllDocPath,
} from '../src/v2/common/firestore/firestore-paths';

import { HealthMetricsService } from '../src/v2/health-metrics/health-metrics.service';
import { RefreshStatus, RefreshTrigger } from '@shared/firestore';

// Basic logger
function log(...args: any[]) { console.log('[backfill-av-daily-adjusted]', ...args); }
function sleep(ms: number) { return new Promise(res => setTimeout(res, ms)); }

// Return the AV key the same way handlers do
function getAvKeyForScript(): string {
  if (process.env.FUNCTIONS_EMULATOR === 'true' && process.env.LOCAL_EMULATOR_ALPHAVANTAGE_API_KEY) {
    return process.env.LOCAL_EMULATOR_ALPHAVANTAGE_API_KEY;
  }
  if (process.env.ALPHAVANTAGE_API_KEY) return process.env.ALPHAVANTAGE_API_KEY;
  throw new Error('ALPHAVANTAGE_API_KEY not set');
}

// Lightweight probe to ensure AV is reachable before we delete data
async function probeAlphaVantageConnectivity(symbol: string): Promise<void> {
  const apikey = getAvKeyForScript();
  const url = 'https://www.alphavantage.co/query';
  const timeoutMs = 8000;
  const maxRetries = Number(process.env.PROBE_MAX_RETRIES || 3);
  const baseDelay = Number(process.env.PROBE_RETRY_BASE_MS || 1500);
  const transientCodes = new Set(['ETIMEDOUT', 'ENETUNREACH', 'ECONNRESET', 'EAI_AGAIN', 'ECONNABORTED']);

  let attempt = 0;
  while (attempt <= maxRetries) {
    try {
      const params = { function: 'SYMBOL_SEARCH', keywords: symbol, apikey, datatype: 'json' };
      await axios.get(url, { params, timeout: timeoutMs, headers: { 'User-Agent': 'av-proxy-backfill/1.0' } });
      return; // ok
    } catch (err: any) {
      const code = err?.code;
      const isTimeoutMsg = typeof err?.message === 'string' && err.message.toLowerCase().includes('timeout');
      const isTransient = transientCodes.has(code) || isTimeoutMsg || (!err?.response && !code);
      const msg = (err?.message || String(err));
      log(`probe failed for ${symbol}: ${msg}`);
      if (attempt >= maxRetries || !isTransient) throw err;
      const delay = baseDelay * Math.pow(2, attempt) + Math.floor(Math.random() * 500);
      log(`probe retry in ${delay}ms (attempt ${attempt + 1}/${maxRetries}) :: ${symbol}`);
      await sleep(delay);
      attempt++;
    }
  }
}

async function getTrackedSymbols(): Promise<string[]> {
  const snap = await db.collection(FirestoreCollection.TRACKED_SYMBOLS).get();
  return snap.docs.map(d => d.id.toUpperCase());
}

async function deleteCollection(path: string, batchSize = 400): Promise<number> {
  let deleted = 0;
  while (true) {
    const snap = await db.collection(path).limit(batchSize).get();
    if (snap.empty) break;
    const batch = db.batch();
    for (const doc of snap.docs) batch.delete(doc.ref);
    await batch.commit();
    deleted += snap.size;
    if (snap.size < batchSize) break;
  }
  return deleted;
}

async function deleteDailyAdjustedForSymbol(symbol: string, dryRun: boolean): Promise<void> {
  const endpoint = AlphaVantageEndpoint.TIME_SERIES_DAILY_ADJUSTED;
  const parentPath = getSymbolTimeSeriesDocPath(symbol, endpoint, ApiProvider.ALPHA_VANTAGE);
  const yearsPath = getSymbolTimeSeriesYearsCollectionPath(symbol, endpoint, ApiProvider.ALPHA_VANTAGE);
  const allDocPath = getSymbolTimeSeriesAllDocPath(symbol, endpoint, ApiProvider.ALPHA_VANTAGE); // not used for daily, safe no-op

  log(`delete start ${symbol} parent=${parentPath}`);
  if (dryRun) return;

  // Delete year-sharded docs
  const yearsDeleted = await deleteCollection(yearsPath).catch(() => 0);
  log(`deleted years/* count=${yearsDeleted}`);

  // Attempt delete of monthly 'all' doc path (harmless for daily)
  try { await db.doc(allDocPath).delete(); } catch { /* ignore */ }

  // Finally delete parent doc to clear stale metadata
  try { await db.doc(parentPath).delete(); } catch { /* ignore */ }
}

async function deleteWeeklyAdjustedForSymbol(symbol: string, dryRun: boolean): Promise<void> {
  const endpoint = AlphaVantageEndpoint.TIME_SERIES_WEEKLY_ADJUSTED;
  const parentPath = getSymbolTimeSeriesDocPath(symbol, endpoint, ApiProvider.ALPHA_VANTAGE);
  const yearsPath = getSymbolTimeSeriesYearsCollectionPath(symbol, endpoint, ApiProvider.ALPHA_VANTAGE);
  log(`delete weekly start ${symbol} parent=${parentPath}`);
  if (dryRun) return;
  const yearsDeleted = await deleteCollection(yearsPath).catch(() => 0);
  log(`deleted weekly years/* count=${yearsDeleted}`);
  try { await db.doc(parentPath).delete(); } catch { /* ignore */ }
}

async function deleteMonthlyAdjustedForSymbol(symbol: string, dryRun: boolean): Promise<void> {
  const endpoint = AlphaVantageEndpoint.TIME_SERIES_MONTHLY_ADJUSTED;
  const parentPath = getSymbolTimeSeriesDocPath(symbol, endpoint, ApiProvider.ALPHA_VANTAGE);
  const allDocPath = getSymbolTimeSeriesAllDocPath(symbol, endpoint, ApiProvider.ALPHA_VANTAGE);
  log(`delete monthly start ${symbol} parent=${parentPath}`);
  if (dryRun) return;
  // monthly uses single 'all/data' doc
  try { await db.doc(allDocPath).delete(); } catch { /* ignore */ }
  try { await db.doc(parentPath).delete(); } catch { /* ignore */ }
}

async function backfillSymbol(symbol: string, delayMs: number, dryRun: boolean): Promise<void> {
  if (dryRun) {
    const endpoints: string[] = ['DAILY_ADJUSTED'];
    if (process.env.INCLUDE_WEEKLY === '1') endpoints.push('WEEKLY_ADJUSTED');
    if (process.env.INCLUDE_MONTHLY === '1') endpoints.push('MONTHLY_ADJUSTED');
    log(`DRY_RUN seed ${symbol} [${endpoints.join(', ')}]`);
    return;
  }

  // local helper to retry handler.fetch on transient network errors
  const fetchWithRetry = async (endpoint: AlphaVantageEndpoint, params: { symbol: string; outputsize: OutputSize; __checkWriteToggle: boolean; }) => {
    const maxRetries = Number(process.env.SCRIPT_HTTP_MAX_RETRIES || 3);
    const baseDelayMs = Number(process.env.SCRIPT_HTTP_RETRY_BASE_MS || 1000);
    const transientCodes = new Set(['ETIMEDOUT', 'ENETUNREACH', 'ECONNRESET', 'EAI_AGAIN', 'ECONNABORTED']);
    let attempt = 0;
    while (true) {
      try {
        const handler = AlphaVantageHandlerFactory.createHandler(endpoint);
        return await handler.fetch(params);
      } catch (err: any) {
        const code = err?.code;
        const isAxiosTimeoutMsg = typeof err?.message === 'string' && err.message.toLowerCase().includes('timeout of');
        const isTransient = transientCodes.has(code) || isAxiosTimeoutMsg || (!err?.response && !code);
        if (attempt >= maxRetries || !isTransient) throw err;
        const delay = baseDelayMs * Math.pow(2, attempt);
        log(`retry ${endpoint} ${symbol} in ${delay}ms (attempt ${attempt + 1}/${maxRetries}) code=${code || 'n/a'}`);
        await sleep(delay);
        attempt++;
      }
    }
  };

  const hms = new HealthMetricsService();

  // DAILY
  let started = Date.now();
  try {
    await fetchWithRetry(AlphaVantageEndpoint.TIME_SERIES_DAILY_ADJUSTED, { symbol, outputsize: OutputSize.FULL, __checkWriteToggle: false });
    let duration = Date.now() - started;
    await hms.recordSymbolRefresh(
      AlphaVantageEndpoint.TIME_SERIES_DAILY_ADJUSTED as any,
      symbol,
      RefreshStatus.SUCCESS,
      duration,
      undefined,
      { trigger: RefreshTrigger.BACKFILL_SCRIPT }
    );
    let durationLog = duration;
    log(`seeded DAILY ${symbol} in ${durationLog}ms`);
  } catch (e: any) {
    let duration = Date.now() - started;
    await hms.recordSymbolRefresh(
      AlphaVantageEndpoint.TIME_SERIES_DAILY_ADJUSTED as any,
      symbol,
      RefreshStatus.FAILURE,
      duration,
      String(e?.message || e),
      { trigger: RefreshTrigger.BACKFILL_SCRIPT }
    );
    throw e;
  }
  if (delayMs > 0) await sleep(delayMs);

  // WEEKLY (optional)
  if (process.env.INCLUDE_WEEKLY === '1') {
    started = Date.now();
    try {
      await fetchWithRetry(AlphaVantageEndpoint.TIME_SERIES_WEEKLY_ADJUSTED, { symbol, outputsize: OutputSize.FULL, __checkWriteToggle: false });
      const duration = Date.now() - started;
      await hms.recordSymbolRefresh(
        AlphaVantageEndpoint.TIME_SERIES_WEEKLY_ADJUSTED as any,
        symbol,
        RefreshStatus.SUCCESS,
        duration,
        undefined,
        { trigger: RefreshTrigger.BACKFILL_SCRIPT }
      );
      log(`seeded WEEKLY ${symbol} in ${duration}ms`);
    } catch (e: any) {
      const duration = Date.now() - started;
      await hms.recordSymbolRefresh(
        AlphaVantageEndpoint.TIME_SERIES_WEEKLY_ADJUSTED as any,
        symbol,
        RefreshStatus.FAILURE,
        duration,
        String(e?.message || e),
        { trigger: RefreshTrigger.BACKFILL_SCRIPT }
      );
      throw e;
    }
    if (delayMs > 0) await sleep(delayMs);
  }

  // MONTHLY (optional)
  if (process.env.INCLUDE_MONTHLY === '1') {
    started = Date.now();
    try {
      await fetchWithRetry(AlphaVantageEndpoint.TIME_SERIES_MONTHLY_ADJUSTED, { symbol, outputsize: OutputSize.FULL, __checkWriteToggle: false });
      const duration = Date.now() - started;
      await hms.recordSymbolRefresh(
        AlphaVantageEndpoint.TIME_SERIES_MONTHLY_ADJUSTED as any,
        symbol,
        RefreshStatus.SUCCESS,
        duration,
        undefined,
        { trigger: RefreshTrigger.BACKFILL_SCRIPT }
      );
      log(`seeded MONTHLY ${symbol} in ${duration}ms`);
    } catch (e: any) {
      const duration = Date.now() - started;
      await hms.recordSymbolRefresh(
        AlphaVantageEndpoint.TIME_SERIES_MONTHLY_ADJUSTED as any,
        symbol,
        RefreshStatus.FAILURE,
        duration,
        String(e?.message || e),
        { trigger: RefreshTrigger.BACKFILL_SCRIPT }
      );
      throw e;
    }
    if (delayMs > 0) await sleep(delayMs);
  }
}

async function main() {
  const dryRun = String(process.env.DRY_RUN || '').trim() === '1';
  const delayMs = Number(process.env.DELAY_MS || 2500);
  const symbolsEnv = String(process.env.SYMBOLS || '').trim();

  const symbols = symbolsEnv
    ? symbolsEnv.split(',').map(s => s.trim().toUpperCase()).filter(Boolean)
    : await getTrackedSymbols();

  // --- Preflight summary ---
  const isEmu = !!process.env.FIRESTORE_EMULATOR_HOST || String(process.env.FUNCTIONS_EMULATOR || '') === 'true';
  const endpoints: string[] = ['DAILY_ADJUSTED'];
  if (process.env.INCLUDE_WEEKLY === '1') endpoints.push('WEEKLY_ADJUSTED');
  if (process.env.INCLUDE_MONTHLY === '1') endpoints.push('MONTHLY_ADJUSTED');
  const target = isEmu ? `EMULATOR (${process.env.FIRESTORE_EMULATOR_HOST || 'unknown-host'})` : `PRODUCTION (project=${process.env.GOOGLE_CLOUD_PROJECT || process.env.GCLOUD_PROJECT || 'unknown-project'})`;
  const scope = symbolsEnv ? `subset [${symbols.join(', ')}]` : 'ALL tracked symbols';
  log(`preflight: target=${target} endpoints=${endpoints.join(', ')} scope=${scope} dryRun=${dryRun} delayMs=${delayMs}`);

  log(`backfill start count=${symbols.length} dryRun=${dryRun} delayMs=${delayMs}`);

  // Helper: perform safe seed for a single symbol (probe -> delete -> backfill)
  const seedSymbolOnce = async (symbol: string): Promise<void> => {
    const allowNonDestructive = String(process.env.ALLOW_NONDESTRUCTIVE_ON_PROBE_FAIL || '1') === '1';
    // 0) Probe AV before any destructive actions
    try {
      await probeAlphaVantageConnectivity(symbol);
    } catch (probeErr) {
      if (!allowNonDestructive) throw probeErr;
      log(`probe ultimately failed; attempting NON-DESTRUCTIVE backfill for ${symbol}`);
      // Try backfill without deleting anything; if it succeeds, we consider the symbol done
      await backfillSymbol(symbol, delayMs, dryRun);
      return;
    }

    // 1) Delete existing trees
    await deleteDailyAdjustedForSymbol(symbol, dryRun);
    if (process.env.INCLUDE_WEEKLY === '1') await deleteWeeklyAdjustedForSymbol(symbol, dryRun);
    if (process.env.INCLUDE_MONTHLY === '1') await deleteMonthlyAdjustedForSymbol(symbol, dryRun);

    // 2) Backfill using existing handler(s)
    await backfillSymbol(symbol, delayMs, dryRun);
  };

  // Per-symbol attempts with backoff+jitter
  const failed: string[] = [];
  const maxSymbolAttempts = Number(process.env.SYMBOL_MAX_ATTEMPTS || 3);
  const symbolBaseBackoff = Number(process.env.SYMBOL_RETRY_BASE_MS || 30000);

  let idx = 0;
  for (const symbol of symbols) {
    idx++;
    log(`\n[${idx}/${symbols.length}] SYMBOL ${symbol}`);
    let attempt = 0;
    while (attempt < maxSymbolAttempts) {
      try {
        await seedSymbolOnce(symbol);
        break; // success
      } catch (e: any) {
        attempt++;
        if (attempt >= maxSymbolAttempts) {
          log(`symbol FAILED after ${attempt} attempts: ${symbol} :: ${e?.message || e}`);
          failed.push(symbol);
          break;
        }
        const jitter = Math.floor(Math.random() * 1000);
        const wait = symbolBaseBackoff * Math.pow(2, attempt - 1) + jitter;
        log(`symbol retry in ${wait}ms (attempt ${attempt}/${maxSymbolAttempts}) :: ${symbol}`);
        await sleep(wait);
      }
    }
  }

  // Final sweep for any failed symbols
  if (failed.length > 0) {
    log(`final sweep starting for ${failed.length} failed symbols...`);
    const retryAgain: string[] = [];
    for (const symbol of failed) {
      try {
        await seedSymbolOnce(symbol);
      } catch {
        retryAgain.push(symbol);
      }
    }
    if (retryAgain.length > 0) {
      log(`final sweep could not complete for: ${retryAgain.join(', ')}`);
    } else {
      log('final sweep completed successfully');
    }
  }

  log('backfill complete');
}

main().catch((e) => {
  console.error('[backfill-av-daily-adjusted] fatal', e?.message || e);
  process.exitCode = 1;
});
