import { onRequest, type HttpsOptions } from 'firebase-functions/v2/https';
import type { Request, Response } from 'express';

import { withCors } from '../utils/cors-middleware';
import { authenticateRequestEither, createLogger } from '../utils/utils';
import { db } from '../../firebase-admin-init';
import { FirestoreCollection } from '@shared/firestore';
import type { AvCompanyOverview } from '@shared/alpha-vantage';
import { TRACKED_SYMBOL_V2_FIELDS } from '@shared/alpha-vantage';
import {
  allowedServiceAccounts,
  expectedGoogleAudience,
} from './partner-handler-base';

const logger = createLogger('[partner-company-overview]');

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
 * Equity symbols have full AV data; ETFs return a minimal payload from tracked-symbols metadata.
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
      // Fallback: check tracked-symbols for ETF metadata
      const tsSnap = await db.collection(FirestoreCollection.TRACKED_SYMBOLS).doc(symbol).get();
      const tsData = tsSnap.data();

      if (tsData && tsData[TRACKED_SYMBOL_V2_FIELDS.TYPE]?.toUpperCase() === 'ETF') {
        const etfData: AvCompanyOverview = {
          Symbol: symbol,
          AssetType: 'ETF',
          Name: tsData[TRACKED_SYMBOL_V2_FIELDS.NAME] ?? '',
          Description: '',
          CIK: '',
          Exchange: '',
          Currency: tsData[TRACKED_SYMBOL_V2_FIELDS.CURRENCY] ?? '',
          Country: tsData[TRACKED_SYMBOL_V2_FIELDS.REGION] ?? '',
          Sector: 'ETF',
          Industry: 'Exchange Traded Fund',
          Address: '',
          OfficialSite: '',
          FiscalYearEnd: '',
          LatestQuarter: '',
          MarketCapitalization: '',
          EBITDA: '',
          PERatio: '',
          PEGRatio: '',
          BookValue: '',
          DividendPerShare: '',
          DividendYield: '',
          EPS: '',
          RevenuePerShareTTM: '',
          ProfitMargin: '',
          OperatingMarginTTM: '',
          ReturnOnAssetsTTM: '',
          ReturnOnEquityTTM: '',
          RevenueTTM: '',
          GrossProfitTTM: '',
          DilutedEPSTTM: '',
          QuarterlyEarningsGrowthYOY: '',
          QuarterlyRevenueGrowthYOY: '',
          AnalystTargetPrice: '',
          AnalystRatingStrongBuy: '',
          AnalystRatingBuy: '',
          AnalystRatingHold: '',
          AnalystRatingSell: '',
          AnalystRatingStrongSell: '',
          TrailingPE: '',
          ForwardPE: '',
          PriceToSalesRatioTTM: '',
          PriceToBookRatio: '',
          EVToRevenue: '',
          EVToEBITDA: '',
          Beta: '',
          '52WeekHigh': '',
          '52WeekLow': '',
          '50DayMovingAverage': '',
          '200DayMovingAverage': '',
          SharesOutstanding: '',
          SharesFloat: '',
          PercentInsiders: '',
          PercentInstitutions: '',
          DividendDate: '',
          ExDividendDate: '',
        };

        const processingTimeMs = Date.now() - start;
        logger.info('companyOverview.etf_fallback', { symbol, processingTimeMs });

        res.status(200).json({
          ok: true,
          symbol,
          data: etfData,
          metadata: {
            lastUpdated: tsData[TRACKED_SYMBOL_V2_FIELDS.LAST_UPDATED]?.toDate?.()?.toISOString() ?? null,
            nextUpdate: null,
            ttlSeconds: null,
            vendor: 'tracked_symbols',
            endpoint: 'ETF_FALLBACK',
          },
          timestamp: new Date().toISOString(),
          processingTimeMs,
        });
        return;
      }

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
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : 'UNKNOWN';
    logger.error('companyOverview.error', { error: message });
    res.status(500).json({
      ok: false,
      error: message,
      code: 'INTERNAL_ERROR',
      timestamp: new Date().toISOString(),
    });
  }
}

export const partnerCompanyOverviewV2 = onRequest(functionOptions, withCors(handler));
