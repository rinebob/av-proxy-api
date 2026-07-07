import { onRequest } from 'firebase-functions/v2/https';

import { createLogger } from '../../utils/utils';
import { processIntradaySnapshotJobInternal } from './intraday-snapshot-jobs.worker';
import { runIntradaySnapshotJobsForSymbols } from '../data-refresher/av-time-series-refresh-manager';
import { clockPtNow } from '../../common/bar-status/bar-status.service';

const log = createLogger('av.intraday.http');

/**
 * DEV/EMULATOR ONLY: Manually trigger the full intraday snapshot pipeline
 * for all (or a subset of) tracked symbols.
 *
 * POST body:
 * - marketDate  {string}   YYYY-MM-DD (required)
 * - clockPt     {string}   HHMM, e.g. "1000" (optional, defaults to current PT hour)
 * - symbols     {string[]} Optional symbol subset; omit to use all tracked symbols
 *
 * This calls runIntradaySnapshotJobsForSymbols directly, which creates the
 * intraday-runs/{runId} document and all job sub-documents, then enqueues
 * a Cloud Task per symbol unconditionally.
 *
 * NOTE: Do NOT expose this in production without appropriate auth.
 */
export const runIntradaySnapshotDev = onRequest(
  { secrets: ['ALPHAVANTAGE_API_KEY'] },
  async (req, res) => {
    try {
      if (req.method !== 'POST') {
        res.status(405).json({ ok: false, error: 'Method not allowed; use POST' });
        return;
      }

      const body = req.body || {};
      const { marketDate, clockPt, symbols } = body as {
        marketDate?: string;
        clockPt?: string;
        symbols?: string[];
      };

      if (typeof marketDate !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(marketDate)) {
        res.status(400).json({ ok: false, error: 'Invalid or missing marketDate (YYYY-MM-DD required)' });
        return;
      }

      // Derive clockPt from current PT time if not provided.
      const resolvedClockPt =
        typeof clockPt === 'string' && /^\d{4}$/.test(clockPt)
          ? clockPt
          : clockPtNow();

      const symbolsArray = Array.isArray(symbols) && symbols.length > 0 ? symbols : undefined;

      log.info('intraday.dev.start', { marketDate, clockPt: resolvedClockPt, symbolCount: symbolsArray?.length ?? 'all' });

      await runIntradaySnapshotJobsForSymbols({
        marketDate,
        clockPt: resolvedClockPt,
        ...(symbolsArray ? { symbols: symbolsArray } : {}),
      });

      log.info('intraday.dev.complete', { marketDate, clockPt: resolvedClockPt });
      res.status(200).json({ ok: true, marketDate, clockPt: resolvedClockPt });
    } catch (e: any) {
      const errMsg = String(e?.message || e);
      log.error('intraday.dev.error', { error: errMsg });
      res.status(500).json({ ok: false, error: errMsg });
    }
  },
);

/**
 * DEV/EMULATOR ONLY: Manually process a single intraday snapshot job for one symbol.
 *
 * POST body:
 * - marketDate  {string}  YYYY-MM-DD (required)
 * - symbol      {string}  Ticker symbol (required)
 * - runId       {string}  Run ID the job belongs to (required)
 * - clockPt     {string}  HHMM clock label (optional, defaults to "0000")
 *
 * Use this to test the worker in isolation without creating a full run.
 * The job document at intraday-runs/{runId}/jobs/{symbol} must already exist,
 * or the worker will no-op (job-not-found guard).
 *
 * NOTE: Do NOT expose this in production without appropriate auth.
 */
export const processIntradaySnapshotJobDev = onRequest(
  { secrets: ['ALPHAVANTAGE_API_KEY'] },
  async (req, res) => {
    try {
      if (req.method !== 'POST') {
        res.status(405).json({ ok: false, error: 'Method not allowed; use POST' });
        return;
      }

      const body = req.body || {};
      const { marketDate, symbol, runId, clockPt } = body as {
        marketDate?: string;
        symbol?: string;
        runId?: string;
        clockPt?: string;
      };

      if (typeof marketDate !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(marketDate)) {
        res.status(400).json({ ok: false, error: 'Invalid or missing marketDate (YYYY-MM-DD required)' });
        return;
      }
      if (typeof symbol !== 'string' || !symbol.trim()) {
        res.status(400).json({ ok: false, error: 'Invalid or missing symbol' });
        return;
      }
      if (typeof runId !== 'string' || !runId.trim()) {
        res.status(400).json({ ok: false, error: 'Invalid or missing runId' });
        return;
      }

      const payload = {
        marketDate,
        symbol: symbol.trim().toUpperCase(),
        runId: runId.trim(),
        clockPt: typeof clockPt === 'string' && clockPt ? clockPt : '0000',
      };

      log.info('intraday.job.dev.start', payload);
      await processIntradaySnapshotJobInternal(payload);
      log.info('intraday.job.dev.complete', payload);

      res.status(200).json({ ok: true, ...payload });
    } catch (e: any) {
      const errMsg = String(e?.message || e);
      log.error('intraday.job.dev.error', { error: errMsg });
      res.status(500).json({ ok: false, error: errMsg });
    }
  },
);
