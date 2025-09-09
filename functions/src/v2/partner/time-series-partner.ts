import { onRequest } from 'firebase-functions/v2/https';
import type { Request, Response } from 'express';

import { withCors } from '../utils/cors-middleware';
import { authenticateRequestEither } from '../utils/utils';
import { getPartnerTimeSeries, type TimeSeriesReadParams, type IntervalInput } from '../common/firestore/time-series-readers';

function isValidInterval(val: any): val is IntervalInput {
  return val === 'DAILY' || val === 'WEEKLY' || val === 'MONTHLY';
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
    const interval = String(req.query.interval || '').toUpperCase() as IntervalInput;

    if (!symbol) {
      res.status(400).json({ ok: false, error: 'Missing required parameter: symbol', code: 'BAD_REQUEST' });
      return;
    }
    if (!isValidInterval(interval)) {
      res.status(400).json({ ok: false, error: 'Invalid interval. Use DAILY | WEEKLY | MONTHLY', code: 'BAD_REQUEST' });
      return;
    }

    const range = req.query.range ? String(req.query.range) as TimeSeriesReadParams['range'] : undefined;
    const from = req.query.from ? String(req.query.from) : undefined;
    const to = req.query.to ? String(req.query.to) : undefined;
    const limit = req.query.limit != null ? Number(req.query.limit) : undefined;

    const result = await getPartnerTimeSeries({ symbol, interval, range, from, to, limit });

    const status = result.ok ? 200 : result.code === 'NOT_FOUND' ? 404 : 500;
    res.status(status).json({ ...result, processingTimeMs: Date.now() - start });
  } catch (e: any) {
    res.status(500).json({ ok: false, error: e?.message || 'UNKNOWN', code: 'INTERNAL_ERROR', timestamp: new Date().toISOString() });
  }
}

export const partnerTimeSeriesV2 = onRequest({
  memory: '256MiB',
  maxInstances: 20,
  timeoutSeconds: 60,
}, withCors(handler));
