import { randomUUID } from 'node:crypto';

import { onRequest, type HttpsOptions } from 'firebase-functions/v2/https';
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
import {
  ALLOWED_SYMBOLS,
  allowedServiceAccounts,
  expectedGoogleAudience,
} from './partner-handler-base';

import type {
  CatalogSortField,
  CatalogSortOrder,
  ContractCatalogEntry,
  ContractCatalogResponse,
  ContractSummaryResponse,
  ContractCatalogErrorResponse,
} from '@shared/options';
import { VALID_LENGTH_BUCKETS } from '@shared/options';

const VALID_SORT_FIELDS = new Set<CatalogSortField>([
  'expiration', 'strike', 'contractLengthDays', 'observationCount', 'delta',
]);
const VALID_SORT_ORDERS = new Set<CatalogSortOrder>(['asc', 'desc']);

const logger = createLogger('[partner-contract-catalog]');

const functionOptions: HttpsOptions = {
  memory: '256MiB',
  maxInstances: 20,
  timeoutSeconds: 30,
  secrets: [allowedServiceAccounts, expectedGoogleAudience],
};

export interface PartnerContractCatalogDependencies {
  authenticateRequest: typeof authenticateRequestEither;
  now: () => Date;
  /** Override for testing. Defaults to `new ContractCatalogQueryService(db)`. */
  queryServiceFactory?: () => ContractCatalogQueryService;
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

/**
 * Parses a comma-separated list of contract length bucket labels.
 * Returns `undefined` when the param is absent, or a string array of trimmed
 * non-empty values. Does not validate individual labels — that is the caller's
 * responsibility.
 */
function parseOptionalBucketList(value: unknown): string[] | undefined {
  const raw = toFirstString(value);
  if (!raw) return undefined;
  return raw.split(',').map((s) => s.trim()).filter((s) => s.length > 0);
}

function errorResponse(
  code: HistoricalOptionsErrorCode,
  message: string,
  timestamp: string,
): ContractCatalogErrorResponse {
  return { ok: false, error: message, code, timestamp };
}

/**
 * Sends a 400 error when a parsed param is `null` but the raw query value
 * was provided (indicating a format error). Returns `true` when the param
 * is valid or absent, `false` when the error response was sent.
 */
function requireValidParam(
  res: Response,
  parsed: unknown,
  rawProvided: boolean,
  paramName: string,
  expectedFormat: string,
  now: string,
): boolean {
  if (parsed === null && rawProvided) {
    res.status(400).json(errorResponse(
      HistoricalOptionsErrorCode.BAD_REQUEST,
      `Invalid ${paramName}. Expected ${expectedFormat}.`,
      now,
    ));
    return false;
  }
  return true;
}

/**
 * Sends a 400 error when a range pair's lower bound exceeds its upper bound.
 * Works for both string (ISO date) and numeric comparisons.
 * Returns `true` when the pair is valid, `false` when the error was sent.
 */
function requireRangeOrder<T extends string | number>(
  res: Response,
  gte: T | null,
  lte: T | null,
  paramName: string,
  now: string,
): boolean {
  if (gte !== null && lte !== null && gte > lte) {
    res.status(400).json(errorResponse(
      HistoricalOptionsErrorCode.BAD_REQUEST,
      `${paramName}Gte must be less than or equal to ${paramName}Lte.`,
      now,
    ));
    return false;
  }
  return true;
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

    const queryService = (dependencies.queryServiceFactory ?? (() => new ContractCatalogQueryService(db)))();
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
    const expirationGte = parseOptionalDate(req.query.expirationGte);
    const expirationLte = parseOptionalDate(req.query.expirationLte);
    const strike = parseOptionalNonNegativeNumber(req.query.strike);
    const type = parseOptionalType(req.query.type);
    const contractLengthBuckets = parseOptionalBucketList(req.query.contractLengthBucket);
    if (contractLengthBuckets) {
      const invalid = contractLengthBuckets.filter((b) => !VALID_LENGTH_BUCKETS.has(b));
      if (invalid.length > 0) {
        res.status(400).json(errorResponse(
          HistoricalOptionsErrorCode.BAD_REQUEST,
          `Invalid contractLengthBucket value(s): ${invalid.join(', ')}. Valid values: ${[...VALID_LENGTH_BUCKETS].join(', ')}.`,
          now,
        ));
        return;
      }
    }
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
    if (!requireValidParam(res, expiration, req.query.expiration !== undefined, 'expiration', 'YYYY-MM-DD', now)) return;
    if (!requireValidParam(res, expirationGte, req.query.expirationGte !== undefined, 'expirationGte', 'YYYY-MM-DD', now)) return;
    if (!requireValidParam(res, expirationLte, req.query.expirationLte !== undefined, 'expirationLte', 'YYYY-MM-DD', now)) return;

    // # Reason: exact-match expiration and range expiration are mutually exclusive —
    // combining them is contradictory and would produce confusing Firestore behavior.
    if (expiration && (expirationGte || expirationLte)) {
      res.status(400).json(errorResponse(
        HistoricalOptionsErrorCode.BAD_REQUEST,
        'expiration (exact match) cannot be combined with expirationGte/expirationLte (range filter).',
        now,
      ));
      return;
    }

    if (!requireValidParam(res, strike, req.query.strike !== undefined, 'strike', 'a non-negative number', now)) return;
    if (!requireValidParam(res, type, req.query.type !== undefined, 'type', 'C or P', now)) return;
    if (!requireValidParam(res, sortBy, req.query.sortBy !== undefined, 'sortBy', `one of: ${[...VALID_SORT_FIELDS].join(', ')}`, now)) return;
    if (!requireValidParam(res, sortOrder, req.query.sortOrder !== undefined, 'sortOrder', 'asc or desc', now)) return;
    if (!requireValidParam(res, pageSize, req.query.pageSize !== undefined, 'pageSize', 'a non-negative number', now)) return;

    // Validate range pairs
    // # Reason: ISO date strings sort lexicographically in calendar order.
    if (!requireRangeOrder(res, expirationGte, expirationLte, 'expiration', now)) return;
    if (!requireRangeOrder(res, strikeGte, strikeLte, 'strike', now)) return;
    if (!requireRangeOrder(res, deltaGte, deltaLte, 'delta', now)) return;
    if (!requireRangeOrder(res, ivGte, ivLte, 'iv', now)) return;

    logger.info('partnerContractCatalog.request', {
      requestId,
      requester: authResult.serviceAccountEmail,
      symbol,
      expiration: expiration ?? 'none',
      expirationGte: expirationGte ?? 'none',
      expirationLte: expirationLte ?? 'none',
      contractLengthBuckets: contractLengthBuckets?.join(',') ?? 'none',
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
      expirationGte: expirationGte ?? undefined,
      expirationLte: expirationLte ?? undefined,
      contractLengthBuckets,
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
  } catch (error: unknown) {
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
