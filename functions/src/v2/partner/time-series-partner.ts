import { onRequest } from 'firebase-functions/v2/https';
import type { Request, Response } from 'express';

import { withCors } from '../utils/cors-middleware';
import { authenticateRequestEither } from '../utils/utils';
import { getPartnerTimeSeries, type TimeSeriesReadParams } from '../common/firestore/time-series-readers';
import { TimeSeriesInterval } from '@shared/alpha-vantage';
import { defineSecret } from 'firebase-functions/params';

// Accepted intervals derived from the shared enum (no magic strings)
const ALLOWED_INTERVALS = [
  TimeSeriesInterval.DAILY,
  TimeSeriesInterval.WEEKLY,
  TimeSeriesInterval.MONTHLY,
] as const;

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
    };

    const result = await getPartnerTimeSeries(params);
    const status = result.ok ? 200 : result.code === 'NOT_FOUND' ? 404 : 500;
    res.status(status).json({ ...result, processingTimeMs: Date.now() - start });
  } catch (e: any) {
    res.status(500).json({ ok: false, error: e?.message || 'UNKNOWN', code: 'INTERNAL_ERROR', timestamp: new Date().toISOString() });
  }
}

// Define the function options with explicit type
type HttpsOptions = {
  memory: '128MiB' | '256MiB' | '512MiB' | '1GiB' | '2GiB' | '4GiB' | '8GiB';
  maxInstances?: number;
  timeoutSeconds?: number;
  secrets?: ReturnType<typeof defineSecret>[];
};

const allowedServiceAccounts = defineSecret('ALLOWED_SERVICE_ACCOUNT_EMAILS');
const expectedGoogleAudience = defineSecret('EXPECTED_GOOGLE_AUDIENCE');

const functionOptions: HttpsOptions = {
  memory: '256MiB',
  maxInstances: 20,
  timeoutSeconds: 60,
  secrets: [allowedServiceAccounts, expectedGoogleAudience]
};

export const partnerTimeSeriesV2 = onRequest(functionOptions, withCors(handler));
