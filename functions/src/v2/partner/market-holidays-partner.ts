import { onRequest, type HttpsOptions } from 'firebase-functions/v2/https';
import type { Request, Response } from 'express';

import { withCors } from '../utils/cors-middleware';
import { authenticateRequestEither, createLogger } from '../utils/utils';
import { getUnifiedMarketHolidaysForYear } from '../common/market-calendar/market-holidays.data';
import {
  allowedServiceAccounts,
  expectedGoogleAudience,
} from './partner-handler-base';

const logger = createLogger('[partner-market-holidays]');

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

    const yearRaw = String(req.query.year || '').trim();
    if (!/^\d{4}$/.test(yearRaw)) {
      res.status(400).json({
        ok: false,
        error: 'BAD_REQUEST',
        code: 'BAD_REQUEST',
        message: 'Missing or invalid year. Expected year=YYYY.',
      });
      return;
    }

    const holidays = getUnifiedMarketHolidaysForYear(yearRaw);
    if (!holidays.length) {
      res.status(404).json({
        ok: false,
        error: 'NOT_FOUND',
        code: 'NOT_FOUND',
        message: `No holiday data available for year=${yearRaw}.`,
      });
      return;
    }

    logger.info('marketHolidays.request', {
      method: req.method,
      path: req.path,
      query: req.query,
      year: yearRaw,
      holidayCount: holidays.length,
    });

    res.status(200).json({
      ok: true,
      year: yearRaw,
      holidays,
      processingTimeMs: Date.now() - start,
      timestamp: new Date().toISOString(),
    });
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : 'UNKNOWN';
    logger.error('marketHolidays.error', { error: message });
    res.status(500).json({
      ok: false,
      error: message,
      code: 'INTERNAL_ERROR',
      timestamp: new Date().toISOString(),
    });
  }
}

const functionOptions: HttpsOptions = {
  memory: '256MiB',
  maxInstances: 10,
  timeoutSeconds: 30,
  secrets: [allowedServiceAccounts, expectedGoogleAudience],
};

export const partnerMarketHolidays = onRequest(functionOptions, withCors(handler));
