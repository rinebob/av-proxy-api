import { onRequest, type HttpsOptions } from 'firebase-functions/v2/https';
import type { Request, Response } from 'express';

import { withCors } from '../utils/cors-middleware';
import { authenticateRequestEither, createLogger } from '../utils/utils';
import { getPartnerTimeSeries, type TimeSeriesReadParams } from '../common/firestore/time-series-readers';
import { TimeSeriesInterval } from '@shared/alpha-vantage';
import {
  allowedServiceAccounts,
  expectedGoogleAudience,
} from './partner-handler-base';

// Accepted intervals derived from the shared enum (no magic strings)
const ALLOWED_INTERVALS = [
  TimeSeriesInterval.DAILY,
  TimeSeriesInterval.WEEKLY,
  TimeSeriesInterval.MONTHLY,
] as const;

const logger = createLogger('[partner-time-series]');

function parseInterval(val: unknown): TimeSeriesInterval | null {
  if (typeof val !== 'string') return null;
  const lc = val.toLowerCase();
  const match = ALLOWED_INTERVALS.find((i) => i === lc);
  return match ?? null;
}

async function handler(req: Request, res: Response) {
  const start = Date.now();
  try {
    if (req.method === 'OPTIONS') {
      res.status(204).send('');
      return;
    }
    if (req.method !== 'GET') {
      res.status(405).json({ ok: false, error: 'Method Not Allowed', code: 'METHOD_NOT_ALLOWED' });
      return;
    }

    // Server-to-server only: require allowlisted Google OIDC SA token or Firebase ID token
    const authResult = await authenticateRequestEither(req, res);
    if (!authResult) return; // Response already sent with 401/403

    const symbol = String(req.query.symbol || '').toUpperCase();
    const interval = parseInterval(req.query.interval);
    if (!symbol) {
      res.status(400).json({ ok: false, error: 'Missing symbol', code: 'BAD_REQUEST' });
      return;
    }
    if (!interval) {
      res.status(400).json({ ok: false, error: `Invalid interval. Use one of: ${ALLOWED_INTERVALS.join(', ')}`, code: 'BAD_REQUEST' });
      return;
    }

    const params: TimeSeriesReadParams = {
      symbol,
      interval,
      range: (req.query.range as any) || undefined,
      from: (req.query.from as any) || undefined,
      to: (req.query.to as any) || undefined,
      limit: req.query.limit != null ? Number(req.query.limit) : undefined,
      isSplitAdjusted: req.query.adjusted === 'true',
    };

    logger.info('partnerTimeSeries.request', {
      method: req.method,
      path: req.path,
      query: req.query,
      symbol,
      interval,
      params,
    });

    const result = await getPartnerTimeSeries(params);
    const firstBar = result.bars?.[0];
    const lastBar = result.bars?.[result.bars.length - 1];

    logger.info('partnerTimeSeries.response', {
      symbol,
      interval,
      isSplitAdjusted: result.isSplitAdjusted,
      requested: params,
      rangeUsed: result.rangeUsed,
      count: result.count,
      truncated: result.truncated,
      availableYears: result.availableYears,
      firstBarTs: firstBar?.t,
      lastBarTs: lastBar?.t,
    });
    const status = result.ok ? 200 : result.code === 'NOT_FOUND' ? 404 : 500;
    res.status(status).json({ ...result, processingTimeMs: Date.now() - start });
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : 'UNKNOWN';
    res.status(500).json({ ok: false, error: message, code: 'INTERNAL_ERROR', timestamp: new Date().toISOString() });
  }
}

const functionOptions: HttpsOptions = {
  memory: '1GiB',
  maxInstances: 20,
  timeoutSeconds: 60,
  secrets: [allowedServiceAccounts, expectedGoogleAudience]
};

export const partnerTimeSeriesV2 = onRequest(functionOptions, withCors(handler));
