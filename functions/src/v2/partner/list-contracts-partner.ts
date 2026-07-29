import { randomUUID } from 'node:crypto';

import { onRequest, type HttpsOptions } from 'firebase-functions/v2/https';
import type { Request, Response } from 'express';

import { queryContractsByFilters } from '../historical-options-corpus/services/options-index-query.service';
import { authenticateRequestEither, createLogger, db } from '../utils/utils';
import { HistoricalOptionsErrorCode } from './historical-options-request.utils';
import {
  ALLOWED_SYMBOLS,
  allowedServiceAccounts,
  expectedGoogleAudience,
} from './partner-handler-base';

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

const logger = createLogger('[partner-list-contracts]');

const functionOptions: HttpsOptions = {
  memory: '256MiB',
  maxInstances: 20,
  timeoutSeconds: 30,
  secrets: [allowedServiceAccounts, expectedGoogleAudience],
};

export interface PartnerListContractsDependencies {
  authenticateRequest: typeof authenticateRequestEither;
  now: () => Date;
}

function toFirstString(value: unknown): string {
  if (Array.isArray(value)) {
    value = value[0];
  }
  return typeof value === 'string' ? value.trim() : '';
}

function parseOptionalDate(value: unknown): string | null {
  const raw = toFirstString(value);
  if (!raw) return null;
  if (!DATE_PATTERN.test(raw)) return null;
  const parsed = new Date(`${raw}T00:00:00.000Z`);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== raw) return null;
  return raw;
}

function parseOptionalStrike(value: unknown): number | null {
  const raw = toFirstString(value);
  if (!raw) return null;
  const num = Number(raw);
  if (!Number.isFinite(num) || num < 0) return null;
  return num;
}

function parseOptionalType(value: unknown): 'C' | 'P' | null {
  const raw = toFirstString(value).toUpperCase();
  if (!raw) return null;
  if (raw !== 'C' && raw !== 'P') return null;
  return raw;
}

const defaultDependencies: PartnerListContractsDependencies = {
  authenticateRequest: authenticateRequestEither,
  now: () => new Date(),
};

/**
 * HTTPS handler for `partnerListContractsV2`.
 * Returns a list of option contract IDs that exist in GCS storage for a given symbol,
 * filtered by expiration, strike, and/or type.
 */
export async function partnerListContractsHandler(
  req: Request,
  res: Response,
  dependencies: PartnerListContractsDependencies = defaultDependencies,
): Promise<void> {
  const startedAt = dependencies.now().getTime();
  const requestId = randomUUID();

  try {
    if (req.method !== 'GET') {
      res.status(405).json({
        ok: false,
        error: 'Method Not Allowed',
        code: HistoricalOptionsErrorCode.METHOD_NOT_ALLOWED,
        timestamp: dependencies.now().toISOString(),
      });
      return;
    }

    const authResult = await dependencies.authenticateRequest(req, res);
    if (!authResult) return;

    if (!('serviceAccountEmail' in authResult)) {
      logger.warn('partnerListContracts.forbidden', { requestId, status: 403 });
      res.status(403).json({
        ok: false,
        error: 'Service account authentication is required',
        code: HistoricalOptionsErrorCode.FORBIDDEN,
        timestamp: dependencies.now().toISOString(),
      });
      return;
    }

    const symbol = toFirstString(req.query.symbol).toUpperCase();

    if (!symbol) {
      res.status(400).json({
        ok: false,
        error: 'Missing or invalid symbol',
        code: HistoricalOptionsErrorCode.BAD_REQUEST,
        timestamp: dependencies.now().toISOString(),
      });
      return;
    }

    if (!ALLOWED_SYMBOLS.has(symbol)) {
      logger.warn('partnerListContracts.symbol_not_allowed', { requestId, symbol });
      res.status(400).json({
        ok: false,
        error: `Symbol ${symbol} is not supported. Allowed symbols: ${[...ALLOWED_SYMBOLS].join(', ')}`,
        code: HistoricalOptionsErrorCode.BAD_REQUEST,
        timestamp: dependencies.now().toISOString(),
      });
      return;
    }

    const expiration = parseOptionalDate(req.query.expiration);
    const strike = parseOptionalStrike(req.query.strike);
    const type = parseOptionalType(req.query.type);

    if (expiration === null && req.query.expiration !== undefined) {
      res.status(400).json({
        ok: false,
        error: 'Invalid expiration. Expected YYYY-MM-DD.',
        code: HistoricalOptionsErrorCode.BAD_REQUEST,
        timestamp: dependencies.now().toISOString(),
      });
      return;
    }

    if (strike === null && req.query.strike !== undefined) {
      res.status(400).json({
        ok: false,
        error: 'Invalid strike. Expected a non-negative number.',
        code: HistoricalOptionsErrorCode.BAD_REQUEST,
        timestamp: dependencies.now().toISOString(),
      });
      return;
    }

    if (type === null && req.query.type !== undefined) {
      res.status(400).json({
        ok: false,
        error: 'Invalid type. Expected C or P.',
        code: HistoricalOptionsErrorCode.BAD_REQUEST,
        timestamp: dependencies.now().toISOString(),
      });
      return;
    }

    if (!expiration && strike === null) {
      res.status(400).json({
        ok: false,
        error: 'At least one of expiration or strike must be provided (in addition to symbol).',
        code: HistoricalOptionsErrorCode.BAD_REQUEST,
        timestamp: dependencies.now().toISOString(),
      });
      return;
    }

    logger.info('partnerListContracts.request', {
      requestId,
      requester: authResult.serviceAccountEmail,
      symbol,
      expiration: expiration ?? 'none',
      strike: strike ?? 'none',
      type: type ?? 'none',
    });

    const contracts = await queryContractsByFilters(db, symbol, expiration, strike, type);

    logger.info('partnerListContracts.response', {
      requestId,
      symbol,
      expiration: expiration ?? 'none',
      strike: strike ?? 'none',
      type: type ?? 'none',
      count: contracts.length,
      processingTimeMs: dependencies.now().getTime() - startedAt,
    });

    res.status(200).json({
      ok: true,
      symbol,
      contracts,
      count: contracts.length,
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    logger.error('partnerListContracts.error', {
      requestId,
      error: message,
      status: 500,
      processingTimeMs: dependencies.now().getTime() - startedAt,
    });
    res.status(500).json({
      ok: false,
      error: 'Internal server error',
      code: HistoricalOptionsErrorCode.INTERNAL_ERROR,
      timestamp: dependencies.now().toISOString(),
    });
  }
}

export const partnerListContractsV2 = onRequest(
  functionOptions,
  partnerListContractsHandler,
);
