import { onRequest, type HttpsOptions } from 'firebase-functions/v2/https';
import type { Request, Response } from 'express';

import { withCors } from '../utils/cors-middleware';
import { authenticateRequestEither } from '../utils/utils';
import { symbolManagerService } from '../alpha-vantage/services/symbol-manager.service';
import { serializeTrackedSymbols } from '../common/common-dm';
import type { ListSymbolsOptions } from '@shared/alpha-vantage';
import {
  allowedServiceAccounts,
  expectedGoogleAudience,
} from './partner-handler-base';

const functionOptions: HttpsOptions = {
  memory: '256MiB',
  maxInstances: 20,
  timeoutSeconds: 60,
  secrets: [allowedServiceAccounts, expectedGoogleAudience],
};

/**
 * Partner HTTPS endpoint to list tracked symbols.
 * Auth: Dual-auth via authenticateRequestEither (Firebase ID token OR Google OIDC SA in allowlist).
 *
 * Query params (all optional):
 * - activeOnly: boolean (default true)
 * - limit: number (default 1000; soft-capped to 5000)
 * - offset: number (default 0)
 * - sortBy: 'symbol' | 'lastUpdated' (default 'symbol')
 * - sortDirection: 'asc' | 'desc' (default 'asc')
 *
 * Response:
 * { ok: boolean, symbols: TrackedSymbolV2[], total: number, limit: number, offset: number, timestamp: string, processingTimeMs: number }
 */
async function handler(req: Request, res: Response) {
  const start = Date.now();
  try {
    if (req.method === 'OPTIONS') { res.status(204).send(''); return; }
    if (req.method !== 'GET') {
      res.status(405).json({ ok: false, error: 'Method Not Allowed', code: 'METHOD_NOT_ALLOWED' });
      return;
    }

    // Server-to-server only: require allowlisted Google OIDC SA token or Firebase ID token
    const authResult = await authenticateRequestEither(req, res);
    if (!authResult) return; // 401/403 already sent

    // Parse and clamp query params
    const q = req.query;
    const parsed: ListSymbolsOptions = {
      activeOnly: q.activeOnly === undefined ? true : String(q.activeOnly) === 'true',
      limit: q.limit != null ? Math.min(Math.max(Number(q.limit), 1), 5000) : 1000,
      offset: q.offset != null ? Math.max(Number(q.offset), 0) : 0,
      sortBy: (q.sortBy as any) || 'symbol',
      sortDirection: (q.sortDirection as any) || 'asc',
    };

    const result = await symbolManagerService.listSymbolsV2(parsed);
    const symbols = serializeTrackedSymbols(result.symbols);

    res.status(200).json({
      ok: true,
      symbols,
      total: result.total,
      limit: result.limit,
      offset: result.offset,
      timestamp: new Date().toISOString(),
      processingTimeMs: Date.now() - start,
    });
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : 'UNKNOWN';
    res.status(500).json({ ok: false, error: message, code: 'INTERNAL_ERROR', timestamp: new Date().toISOString() });
  }
}

export const partnerListTrackedSymbolsV2 = onRequest(functionOptions, withCors(handler));
