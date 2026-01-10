import { onRequest } from 'firebase-functions/v2/https';

import { AlphaVantageEndpoint } from '@shared/alpha-vantage';
import { TradingPhase } from '@shared/health-metrics';

import { createLogger } from '../../utils/utils';
import { processTimeSeriesJobInternal, ProcessTimeSeriesJobPayload } from './time-series-jobs.worker';

const log = createLogger('av.ts.jobs.http');

/**
 * DEV/EMULATOR ONLY: Manual entry point for processing a single
 * time-series job. This is intended for validating the worker logic
 * before wiring Cloud Tasks in non-production environments.
 *
 * NOTE: Do NOT expose this in production without appropriate auth;
 * the eventual Cloud Tasks entry point will have a separate export
 * and security model.
 */
export const processTimeSeriesJobDev = onRequest(async (req, res) => {
  try {
    if (req.method !== 'POST') {
      res.status(405).json({ ok: false, error: 'Method not allowed; use POST' });
      return;
    }

    const body = req.body || {};
    const { marketDate, symbol, endpoint, phase } = body as Partial<ProcessTimeSeriesJobPayload>;

    if (typeof marketDate !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(marketDate)) {
      res.status(400).json({ ok: false, error: 'Invalid or missing marketDate (YYYY-MM-DD required)' });
      return;
    }
    if (typeof symbol !== 'string' || !symbol.trim()) {
      res.status(400).json({ ok: false, error: 'Invalid or missing symbol' });
      return;
    }
    if (!Object.values(AlphaVantageEndpoint).includes(endpoint as AlphaVantageEndpoint)) {
      res.status(400).json({ ok: false, error: 'Invalid or missing endpoint' });
      return;
    }

    // Accept phase as a case-insensitive string ('PRE' / 'POST') and
    // map it explicitly to the TradingPhase enum. TradingPhase values
    // are lowercase ('pre' / 'post'), so we cannot cast directly from
    // the incoming string.
    const phaseStr = typeof phase === 'string' ? phase.toUpperCase().trim() : '';
    if (phaseStr !== 'PRE' && phaseStr !== 'POST') {
      res.status(400).json({ ok: false, error: 'Invalid or missing phase' });
      return;
    }
    const phaseEnum = phaseStr === 'POST' ? TradingPhase.POST : TradingPhase.PRE;

    const payload: ProcessTimeSeriesJobPayload = {
      marketDate,
      symbol: symbol.trim().toUpperCase(),
      endpoint: endpoint as AlphaVantageEndpoint,
      phase: phaseEnum,
    };

    log.info('job.dev.start', payload as unknown as Record<string, unknown>);
    await processTimeSeriesJobInternal(payload);
    log.info('job.dev.complete', payload as unknown as Record<string, unknown>);

    res.status(200).json({ ok: true });
  } catch (e: any) {
    const errMsg = String(e?.message || e);
    log.error('job.dev.error', { error: errMsg });
    res.status(500).json({ ok: false, error: errMsg });
  }
});
