import { onRequest } from 'firebase-functions/v2/https';
import type { Request, Response } from 'express';

import { withCors } from '../utils/cors-middleware';
import { authenticateRequestEither, createLogger } from '../utils/utils';
import { db } from '../../firebase-admin-init';
import { defineSecret } from 'firebase-functions/params';
import { getSymbolTimeSeriesYearDocPath } from '../common/firestore/firestore-paths';
import { AlphaVantageEndpoint } from '@shared/alpha-vantage';
import { ApiProvider } from '@shared/core';
import type { CompactBar } from '@shared/alpha-vantage';

const logger = createLogger('[partner-intraday-snapshot]');

const MAX_SYMBOLS = 1000;

export interface IntradaySnapshotRequest {
  symbols: string[];
}

export interface IntradaySnapshot {
  symbol: string;
  ip: number;   // intraday price
  ipc: number;  // intraday percent change
  io: number;   // intraday observed at (epoch ms)
  it: string;   // intraday time (HH:mm ET)
  ic: number;   // intraday change
}

export interface IntradaySnapshotResponse {
  ok: boolean;
  marketDate: string;
  count: number;
  snapshots: IntradaySnapshot[];
  timestamp: string;
  processingTimeMs: number;
  error?: string;
  code?: string;
}

/**
 * Get today's ET date as YYYY-MM-DD string.
 */
function getTodayEt(): string {
  const now = new Date();
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/New_York',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);
}

/**
 * Read intraday snapshot data for a single symbol from Firestore.
 * Reads from the year-sharded DAILY_ADJUSTED document and finds today's bar.
 */
async function readIntradaySnapshot(symbol: string, marketDate: string): Promise<IntradaySnapshot | null> {
  const upperSymbol = symbol.toUpperCase();
  const year = parseInt(marketDate.substring(0, 4), 10);
  
  const docPath = getSymbolTimeSeriesYearDocPath(
    upperSymbol,
    AlphaVantageEndpoint.TIME_SERIES_DAILY_ADJUSTED,
    ApiProvider.ALPHA_VANTAGE,
    year,
    true // isSplitAdjusted = true
  );

  try {
    const snap = await db.doc(docPath).get();
    if (!snap.exists) {
      logger.debug('snapshot.doc_not_found', { symbol: upperSymbol, docPath });
      return null;
    }

    const data = snap.data() as { bars?: CompactBar[] };
    const bars = data?.bars || [];

    // Find today's bar by date string
    const todayBar = bars.find(bar => bar.d === marketDate);
    if (!todayBar) {
      logger.debug('snapshot.bar_not_found', { symbol: upperSymbol, marketDate, availableDates: bars.slice(-5).map(b => b.d) });
      return null;
    }

    // Check if intraday fields are present
    if (todayBar.ip == null || todayBar.io == null) {
      logger.debug('snapshot.no_intraday_data', { symbol: upperSymbol, marketDate, hasIp: todayBar.ip != null, hasIo: todayBar.io != null });
      return null;
    }

    return {
      symbol: upperSymbol,
      ip: todayBar.ip,
      ipc: todayBar.ipc ?? 0,
      io: todayBar.io,
      it: todayBar.it ?? '',
      ic: todayBar.ic ?? 0,
    };
  } catch (error) {
    logger.warn('snapshot.read_error', { symbol: upperSymbol, error: String(error) });
    return null;
  }
}

async function handler(req: Request, res: Response) {
  const start = Date.now();
  try {
    if (req.method === 'OPTIONS') {
      res.status(204).send('');
      return;
    }
    if (req.method !== 'POST') {
      res.status(405).json({ ok: false, error: 'Method Not Allowed', code: 'METHOD_NOT_ALLOWED' });
      return;
    }

    // Server-to-server only: require allowlisted Google OIDC SA token or Firebase ID token
    const authResult = await authenticateRequestEither(req, res);
    if (!authResult) return; // Response already sent with 401/403

    // Parse request body
    let body: IntradaySnapshotRequest;
    try {
      body = req.body as IntradaySnapshotRequest;
    } catch {
      res.status(400).json({ ok: false, error: 'Invalid JSON body', code: 'BAD_REQUEST' });
      return;
    }

    // Validate symbols array
    if (!body.symbols || !Array.isArray(body.symbols)) {
      res.status(400).json({ ok: false, error: 'Missing symbols array', code: 'BAD_REQUEST' });
      return;
    }

    if (body.symbols.length === 0) {
      res.status(400).json({ ok: false, error: 'Empty symbols array', code: 'BAD_REQUEST' });
      return;
    }

    if (body.symbols.length > MAX_SYMBOLS) {
      res.status(400).json({
        ok: false,
        error: `Too many symbols. Maximum is ${MAX_SYMBOLS}, received ${body.symbols.length}`,
        code: 'BAD_REQUEST'
      });
      return;
    }

    // Validate symbol strings
    const invalidSymbols = body.symbols.filter(s => typeof s !== 'string' || s.length === 0);
    if (invalidSymbols.length > 0) {
      res.status(400).json({
        ok: false,
        error: `Invalid symbols found: ${invalidSymbols.slice(0, 5).join(', ')}${invalidSymbols.length > 5 ? '...' : ''}`,
        code: 'BAD_REQUEST'
      });
      return;
    }

    const marketDate = getTodayEt();
    const uniqueSymbols = [...new Set(body.symbols.map(s => s.toUpperCase()))];

    logger.info('intradaySnapshot.request', {
      symbolCount: uniqueSymbols.length,
      marketDate,
      requester: 'serviceAccountEmail' in authResult ? authResult.serviceAccountEmail : 'firebase-user'
    });

    // Read snapshots for all symbols in parallel
    const snapshots = (await Promise.all(
      uniqueSymbols.map(symbol => readIntradaySnapshot(symbol, marketDate))
    )).filter((s): s is IntradaySnapshot => s !== null);

    const missingCount = uniqueSymbols.length - snapshots.length;

    logger.info('intradaySnapshot.response', {
      requested: uniqueSymbols.length,
      found: snapshots.length,
      missing: missingCount,
      marketDate,
      durationMs: Date.now() - start
    });

    const response: IntradaySnapshotResponse = {
      ok: true,
      marketDate,
      count: snapshots.length,
      snapshots,
      timestamp: new Date().toISOString(),
      processingTimeMs: Date.now() - start
    };

    res.status(200).json(response);
  } catch (e: any) {
    logger.error('intradaySnapshot.error', { error: e?.message || 'UNKNOWN' });
    res.status(500).json({
      ok: false,
      error: e?.message || 'INTERNAL_ERROR',
      code: 'INTERNAL_ERROR',
      timestamp: new Date().toISOString()
    });
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
  memory: '1GiB',
  maxInstances: 20,
  timeoutSeconds: 60,
  secrets: [allowedServiceAccounts, expectedGoogleAudience]
};

export const partnerIntradaySnapshotV2 = onRequest(functionOptions, withCors(handler));
