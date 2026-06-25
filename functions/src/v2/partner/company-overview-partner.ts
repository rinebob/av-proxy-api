import { onRequest } from 'firebase-functions/v2/https';
import type { Request, Response } from 'express';
import { defineSecret } from 'firebase-functions/params';

import { withCors } from '../utils/cors-middleware';
import { authenticateRequestEither, createLogger } from '../utils/utils';
import { db } from '../../firebase-admin-init';
import { FirestoreCollection } from '@shared/firestore';
import type { AvCompanyOverview } from '@shared/alpha-vantage';

const logger = createLogger('[partner-company-overview]');

// Secrets for allowlisted partner service accounts and expected audience
const allowedServiceAccounts = defineSecret('ALLOWED_SERVICE_ACCOUNT_EMAILS');
const expectedGoogleAudience = defineSecret('EXPECTED_GOOGLE_AUDIENCE');

type HttpsOptions = {
  memory: '128MiB' | '256MiB' | '512MiB' | '1GiB' | '2GiB' | '4GiB' | '8GiB';
  maxInstances?: number;
  timeoutSeconds?: number;
  secrets?: ReturnType<typeof defineSecret>[];
};

const functionOptions: HttpsOptions = {
  memory: '256MiB',
  maxInstances: 20,
  timeoutSeconds: 30,
  secrets: [allowedServiceAccounts, expectedGoogleAudience],
};

/** Shape of the Firestore company-overview document. */
interface CompanyOverviewDoc {
  data: AvCompanyOverview;
  metadata?: {
    lastUpdated?: FirebaseFirestore.Timestamp;
    nextUpdate?: FirebaseFirestore.Timestamp;
    ttlSeconds?: number;
    vendor?: string;
    endpoint?: string;
  };
}

/**
 * Partner HTTPS endpoint to retrieve company overview data for a single symbol.
 * Auth: Dual-auth via authenticateRequestEither (Firebase ID token OR Google OIDC SA in allowlist).
 *
 * Query params:
 * - symbol (required): ticker symbol, case-insensitive
 *
 * Response:
 * { ok: boolean, symbol: string, data: AvCompanyOverview, metadata: {...}, timestamp: string, processingTimeMs: number }
 *
 * Data is read from Firestore at:
 *   symbol-data/{SYMBOL}/company-overview/av-company-overview
 * Populated by the internal AV refresh manager on a 7-day TTL.
 * Only equity symbols will have data; ETFs/indexes/crypto return 404.
 */
async function handler(req: Request, res: Response): Promise<void> {
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
    if (!authResult) return; // 401/403 already sent

    // Parse and validate query params
    const rawSymbol = String(req.query.symbol || '').trim();
    if (!rawSymbol) {
      res.status(400).json({ ok: false, error: 'Missing symbol', code: 'BAD_REQUEST' });
      return;
    }
    const symbol = rawSymbol.toUpperCase();

    logger.info('companyOverview.request', {
      symbol,
      requester: 'serviceAccountEmail' in authResult ? (authResult as any).serviceAccountEmail : 'firebase-user',
    });

    // Build Firestore path: symbol-data/{SYMBOL}/company-overview/av-company-overview
    const docPath = [
      FirestoreCollection.SYMBOL_DATA,
      symbol,
      FirestoreCollection.COMPANY_OVERVIEW,
      `av-${FirestoreCollection.COMPANY_OVERVIEW}`,
    ].join('/');

    const snap = await db.doc(docPath).get();

    if (!snap.exists) {
      logger.info('companyOverview.not_found', { symbol, docPath });
      res.status(404).json({
        ok: false,
        error: `No company overview data found for ${symbol}`,
        code: 'NOT_FOUND',
        timestamp: new Date().toISOString(),
      });
      return;
    }

    const doc = snap.data() as CompanyOverviewDoc;

    // Serialize Firestore Timestamps to ISO strings for the response
    const rawMeta = doc.metadata;
    const metadata = rawMeta
      ? {
          lastUpdated: rawMeta.lastUpdated?.toDate?.()?.toISOString() ?? null,
          nextUpdate: rawMeta.nextUpdate?.toDate?.()?.toISOString() ?? null,
          ttlSeconds: rawMeta.ttlSeconds ?? null,
          vendor: rawMeta.vendor ?? null,
          endpoint: rawMeta.endpoint ?? null,
        }
      : null;

    const processingTimeMs = Date.now() - start;

    logger.info('companyOverview.response', { symbol, processingTimeMs });

    res.status(200).json({
      ok: true,
      symbol,
      data: doc.data,
      metadata,
      timestamp: new Date().toISOString(),
      processingTimeMs,
    });
  } catch (e: any) {
    logger.error('companyOverview.error', { error: e?.message || 'UNKNOWN' });
    res.status(500).json({
      ok: false,
      error: e?.message || 'INTERNAL_ERROR',
      code: 'INTERNAL_ERROR',
      timestamp: new Date().toISOString(),
    });
  }
}

export const partnerCompanyOverviewV2 = onRequest(functionOptions, withCors(handler));
