import { randomUUID } from 'node:crypto';

import { onRequest, type HttpsOptions } from 'firebase-functions/v2/https';
import { defineSecret } from 'firebase-functions/params';
import type { Request, Response } from 'express';

import { ContractCatalogQueryService, FilterConflictError } from '../historical-options-corpus/services/contract-catalog-query.service';
import { authenticateRequestEither, createLogger, db } from '../utils/utils';
import { HistoricalOptionsErrorCode } from './historical-options-request.utils';
import {
  toFirstString,
  parseOptionalDate,
  parseOptionalNumber,
  parseOptionalNonNegativeNumber,
  parseOptionalBool,
} from './partner-request.utils';

import type {
  CatalogSortField,
  CatalogSortOrder,
  ContractCatalogEntry,
  ContractCatalogResponse,
  ContractSummaryResponse,
  ContractCatalogErrorResponse,
} from '@shared/options';

const ALLOWED_SYMBOLS = new Set(['QQQ', 'TQQQ']);
const VALID_SORT_FIELDS = new Set<CatalogSortField>([
  'expiration', 'strike', 'contractLengthDays', 'observationCount', 'delta',
]);
const VALID_SORT_ORDERS = new Set<CatalogSortOrder>(['asc', 'desc']);

const logger = createLogger('[partner-contract-catalog]');

const allowedServiceAccounts = defineSecret('ALLOWED_SERVICE_ACCOUNT_EMAILS');
const expectedGoogleAudience = defineSecret('EXPECTED_GOOGLE_AUDIENCE');

const functionOptions: HttpsOptions = {
  memory: '256MiB',
  maxInstances: 20,
  timeoutSeconds: 30,
  secrets: [allowedServiceAccounts, expectedGoogleAudience],
};

export interface PartnerContractCatalogDependencies {
  authenticateRequest: typeof authenticateRequestEither;
  now: () => Date;
}

const defaultDependencies: PartnerContractCatalogDependencies = {
  authenticateRequest: authenticateRequestEither,
  now: () => new Date(),
};

function parseOptionalType(value: unknown): 'call' | 'put' | null {
  const raw = toFirstString(value).toUpperCase();
  if (!raw) return null;
  if (raw === 'C') return 'call';
  if (raw === 'P') return 'put';
  return null;
}

function parseSortBy(value: unknown): CatalogSortField | null {
  const raw = toFirstString(value).toLowerCase();
  if (!raw) return null;
  if (VALID_SORT_FIELDS.has(raw as CatalogSortField)) return raw as CatalogSortField;
  return null;
}

function parseSortOrder(value: unknown): CatalogSortOrder | null {
  const raw = toFirstString(value).toLowerCase();
  if (!raw) return null;
  if (VALID_SORT_ORDERS.has(raw as CatalogSortOrder)) return raw as CatalogSortOrder;
  return null;
}

function errorResponse(
  code: HistoricalOptionsErrorCode,
  message: string,
  timestamp: string,
): ContractCatalogErrorResponse {
  return { ok: false, error: message, code, timestamp };
}

/**
 * HTTPS handler for `partnerContractCatalogV2`.
 *
 * Serves two modes:
 * - **Summary** (`?summary=true`): returns a length-bucket histogram and totals.
 * - **Catalog** (default): returns paginated, filtered, sorted contract metadata
 *   from the `ts-contracts` Firestore subcollection.
 */
export async function partnerContractCatalogHandler(
  req: Request,
  res: Response,
  dependencies: PartnerContractCatalogDependencies = defaultDependencies,
): Promise<void> {
  const startedAt = dependencies.now().getTime();
  const requestId = randomUUID();

  try {
    if (req.method !== 'GET') {
      res.status(405).json(errorResponse(
        HistoricalOptionsErrorCode.METHOD_NOT_ALLOWED,
        'Method Not Allowed',
        dependencies.now().toISOString(),
      ));
      return;
    }

    const authResult = await dependencies.authenticateRequest(req, res);
    if (!authResult) return;

    if (!('serviceAccountEmail' in authResult)) {
      logger.warn('partnerContractCatalog.forbidden', { requestId, status: 403 });
      res.status(403).json(errorResponse(
        HistoricalOptionsErrorCode.FORBIDDEN,
        'Service account authentication is required',
        dependencies.now().toISOString(),
      ));
      return;
    }

    const symbol = toFirstString(req.query.symbol).toUpperCase();

    if (!symbol) {
      res.status(400).json(errorResponse(
        HistoricalOptionsErrorCode.BAD_REQUEST,
        'Missing or invalid symbol',
        dependencies.now().toISOString(),
      ));
      return;
    }

    if (!ALLOWED_SYMBOLS.has(symbol)) {
      logger.warn('partnerContractCatalog.symbol_not_allowed', { requestId, symbol });
      res.status(400).json(errorResponse(
        HistoricalOptionsErrorCode.BAD_REQUEST,
        `Symbol ${symbol} is not supported. Allowed symbols: ${[...ALLOWED_SYMBOLS].join(', ')}`,
        dependencies.now().toISOString(),
      ));
      return;
    }

    const queryService = new ContractCatalogQueryService(db);
    const now = dependencies.now().toISOString();

    // --- Summary mode ---
    if (parseOptionalBool(req.query.summary)) {
      const summary = await queryService.getSummary(symbol);

      if (!summary) {
        res.status(404).json(errorResponse(
          HistoricalOptionsErrorCode.NOT_FOUND,
          `No catalog data found for symbol ${symbol}. The symbol may not have been backfilled yet.`,
          now,
        ));
        return;
      }

      const response: ContractSummaryResponse = {
        ok: true,
        symbol: summary.symbol,
        totalContracts: summary.totalContracts,
        expirationCount: summary.expirationCount,
        lengthBuckets: summary.lengthBuckets,
        lastUpdated: summary.lastUpdated,
      };

      logger.info('partnerContractCatalog.summary', {
        requestId,
        requester: authResult.serviceAccountEmail,
        symbol,
        totalContracts: summary.totalContracts,
        processingTimeMs: dependencies.now().getTime() - startedAt,
      });

      res.status(200).json(response);
      return;
    }

    // --- Catalog mode ---
    const expiration = parseOptionalDate(req.query.expiration);
    const strike = parseOptionalNonNegativeNumber(req.query.strike);
    const type = parseOptionalType(req.query.type);
    const contractLengthBucket = toFirstString(req.query.contractLengthBucket) || undefined;
    const strikeGte = parseOptionalNumber(req.query.strikeGte);
    const strikeLte = parseOptionalNumber(req.query.strikeLte);
    const deltaGte = parseOptionalNumber(req.query.deltaGte);
    const deltaLte = parseOptionalNumber(req.query.deltaLte);
    const ivGte = parseOptionalNumber(req.query.ivGte);
    const ivLte = parseOptionalNumber(req.query.ivLte);
    const minObservationCount = parseOptionalNonNegativeNumber(req.query.minObservationCount);
    const sortBy = parseSortBy(req.query.sortBy);
    const sortOrder = parseSortOrder(req.query.sortOrder);
    const pageSize = parseOptionalNonNegativeNumber(req.query.pageSize);
    const pageToken = toFirstString(req.query.pageToken) || undefined;

    // Validate individual params
    if (expiration === null && req.query.expiration !== undefined) {
      res.status(400).json(errorResponse(
        HistoricalOptionsErrorCode.BAD_REQUEST,
        'Invalid expiration. Expected YYYY-MM-DD.',
        now,
      ));
      return;
    }

    if (strike === null && req.query.strike !== undefined) {
      res.status(400).json(errorResponse(
        HistoricalOptionsErrorCode.BAD_REQUEST,
        'Invalid strike. Expected a non-negative number.',
        now,
      ));
      return;
    }

    if (type === null && req.query.type !== undefined) {
      res.status(400).json(errorResponse(
        HistoricalOptionsErrorCode.BAD_REQUEST,
        'Invalid type. Expected C or P.',
        now,
      ));
      return;
    }

    if (sortBy === null && req.query.sortBy !== undefined) {
      res.status(400).json(errorResponse(
        HistoricalOptionsErrorCode.BAD_REQUEST,
        `Invalid sortBy. Expected one of: ${[...VALID_SORT_FIELDS].join(', ')}.`,
        now,
      ));
      return;
    }

    if (sortOrder === null && req.query.sortOrder !== undefined) {
      res.status(400).json(errorResponse(
        HistoricalOptionsErrorCode.BAD_REQUEST,
        'Invalid sortOrder. Expected asc or desc.',
        now,
      ));
      return;
    }

    if (pageSize === null && req.query.pageSize !== undefined) {
      res.status(400).json(errorResponse(
        HistoricalOptionsErrorCode.BAD_REQUEST,
        'Invalid pageSize. Expected a non-negative number.',
        now,
      ));
      return;
    }

    // Validate range pairs
    if (strikeGte !== null && strikeLte !== null && strikeGte > strikeLte) {
      res.status(400).json(errorResponse(
        HistoricalOptionsErrorCode.BAD_REQUEST,
        'strikeGte must be less than or equal to strikeLte.',
        now,
      ));
      return;
    }

    if (deltaGte !== null && deltaLte !== null && deltaGte > deltaLte) {
      res.status(400).json(errorResponse(
        HistoricalOptionsErrorCode.BAD_REQUEST,
        'deltaGte must be less than or equal to deltaLte.',
        now,
      ));
      return;
    }

    if (ivGte !== null && ivLte !== null && ivGte > ivLte) {
      res.status(400).json(errorResponse(
        HistoricalOptionsErrorCode.BAD_REQUEST,
        'ivGte must be less than or equal to ivLte.',
        now,
      ));
      return;
    }

    logger.info('partnerContractCatalog.request', {
      requestId,
      requester: authResult.serviceAccountEmail,
      symbol,
      expiration: expiration ?? 'none',
      contractLengthBucket: contractLengthBucket ?? 'none',
      type: type ?? 'none',
      strike: strike ?? 'none',
      sortBy: sortBy ?? 'default',
      sortOrder: sortOrder ?? 'default',
      pageSize: pageSize ?? 'default',
      hasPageToken: !!pageToken,
    });

    const result = await queryService.queryCatalog({
      symbol,
      expiration: expiration ?? undefined,
      contractLengthBucket,
      type: type ?? undefined,
      strike: strike ?? undefined,
      strikeGte: strikeGte ?? undefined,
      strikeLte: strikeLte ?? undefined,
      deltaGte: deltaGte ?? undefined,
      deltaLte: deltaLte ?? undefined,
      ivGte: ivGte ?? undefined,
      ivLte: ivLte ?? undefined,
      minObservationCount: minObservationCount ?? undefined,
      sortBy: sortBy ?? undefined,
      sortOrder: sortOrder ?? undefined,
      pageSize: pageSize ?? undefined,
      pageToken,
    });

    const entries: ContractCatalogEntry[] = result.contracts.map(({ lastUpdated: _, ...entry }) => entry);

    const response: ContractCatalogResponse = {
      ok: true,
      symbol,
      contracts: entries,
      count: entries.length,
      nextPageToken: result.nextPageToken,
    };

    logger.info('partnerContractCatalog.response', {
      requestId,
      symbol,
      count: result.contracts.length,
      hasNextPage: !!result.nextPageToken,
      processingTimeMs: dependencies.now().getTime() - startedAt,
    });

    res.status(200).json(response);
  } catch (error: any) {
    if (error instanceof FilterConflictError) {
      res.status(400).json(errorResponse(
        HistoricalOptionsErrorCode.BAD_REQUEST,
        error.message,
        dependencies.now().toISOString(),
      ));
      return;
    }

    const message = error instanceof Error ? error.message : String(error);
    logger.error('partnerContractCatalog.error', {
      requestId,
      error: message,
      status: 500,
      processingTimeMs: dependencies.now().getTime() - startedAt,
    });
    res.status(500).json(errorResponse(
      HistoricalOptionsErrorCode.INTERNAL_ERROR,
      'Internal server error',
      dependencies.now().toISOString(),
    ));
  }
}

export const partnerContractCatalogV2 = onRequest(
  functionOptions,
  partnerContractCatalogHandler,
);
