import { randomUUID } from 'node:crypto';

import { onRequest, type HttpsOptions } from 'firebase-functions/v2/https';
import type { Request, Response } from 'express';

import { isValidIsoDate } from '../common/utils/date-time.utils';
import { resolveContractMetadata } from '../historical-options-corpus/services/contract-metadata.utils';
import {
  parseStorageLine,
  toApiObservation,
  type TimeSeriesApiObservation,
} from '../historical-options-corpus/services/time-series-contract.utils';
import { authenticateRequestEither, createLogger } from '../utils/utils';
import { HistoricalOptionsErrorCode } from './historical-options-request.utils';
import {
  ALLOWED_SYMBOLS,
  allowedServiceAccounts,
  expectedGoogleAudience,
  defaultGetGcs,
  type GcsAdapterPair,
} from './partner-handler-base';

const MAX_RESPONSE_BYTES = 10 * 1024 * 1024;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

const logger = createLogger('[partner-historical-options-contract]');

const functionOptions: HttpsOptions = {
  memory: '256MiB',
  maxInstances: 20,
  timeoutSeconds: 30,
  secrets: [allowedServiceAccounts, expectedGoogleAudience],
};

export interface PartnerHistoricalOptionsContractDependencies {
  authenticateRequest: typeof authenticateRequestEither;
  getGcs: () => GcsAdapterPair;
  randomUUID: () => string;
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
  return isValidIsoDate(raw) ? raw : null;
}

const defaultDependencies: PartnerHistoricalOptionsContractDependencies = {
  authenticateRequest: authenticateRequestEither,
  getGcs: defaultGetGcs,
  randomUUID: () => randomUUID(),
  now: () => new Date(),
};

/**
 * HTTPS handler for `partnerHistoricalOptionsContractV2`.
 * Returns the per-contract historical options time series for a single contract.
 */
export async function partnerHistoricalOptionsContractHandler(
  req: Request,
  res: Response,
  dependencies: PartnerHistoricalOptionsContractDependencies = defaultDependencies,
): Promise<void> {
  const startedAt = dependencies.now().getTime();
  const requestId = dependencies.randomUUID();

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
      logger.warn('partnerHistoricalOptionsContract.forbidden', { requestId, status: 403 });
      res.status(403).json({
        ok: false,
        error: 'Service account authentication is required',
        code: HistoricalOptionsErrorCode.FORBIDDEN,
        timestamp: dependencies.now().toISOString(),
      });
      return;
    }

    const symbol = toFirstString(req.query.symbol).toUpperCase();
    const contractID = toFirstString(req.query.contractID).toUpperCase();

    if (!symbol) {
      res.status(400).json({
        ok: false,
        error: 'Missing or invalid symbol',
        code: HistoricalOptionsErrorCode.BAD_REQUEST,
        timestamp: dependencies.now().toISOString(),
      });
      return;
    }

    if (!contractID) {
      res.status(400).json({
        ok: false,
        error: 'Missing or invalid contractID',
        code: HistoricalOptionsErrorCode.BAD_REQUEST,
        timestamp: dependencies.now().toISOString(),
      });
      return;
    }

    if (!contractID.startsWith(symbol)) {
      res.status(400).json({
        ok: false,
        error: 'contractID must start with symbol',
        code: HistoricalOptionsErrorCode.BAD_REQUEST,
        timestamp: dependencies.now().toISOString(),
      });
      return;
    }

    if (!ALLOWED_SYMBOLS.has(symbol)) {
      logger.warn('partnerHistoricalOptionsContract.symbol_not_allowed', { requestId, symbol });
      res.status(400).json({
        ok: false,
        error: `Symbol ${symbol} is not supported. Allowed symbols: ${[...ALLOWED_SYMBOLS].join(', ')}`,
        code: HistoricalOptionsErrorCode.BAD_REQUEST,
        timestamp: dependencies.now().toISOString(),
      });
      return;
    }

    const startDate = parseOptionalDate(req.query.startDate);
    const endDate = parseOptionalDate(req.query.endDate);

    if (startDate === null && req.query.startDate !== undefined) {
      res.status(400).json({
        ok: false,
        error: 'Invalid startDate. Expected YYYY-MM-DD.',
        code: HistoricalOptionsErrorCode.BAD_REQUEST,
        timestamp: dependencies.now().toISOString(),
      });
      return;
    }

    if (endDate === null && req.query.endDate !== undefined) {
      res.status(400).json({
        ok: false,
        error: 'Invalid endDate. Expected YYYY-MM-DD.',
        code: HistoricalOptionsErrorCode.BAD_REQUEST,
        timestamp: dependencies.now().toISOString(),
      });
      return;
    }

    if (startDate && endDate && startDate > endDate) {
      res.status(400).json({
        ok: false,
        error: 'startDate must be less than or equal to endDate',
        code: HistoricalOptionsErrorCode.BAD_REQUEST,
        timestamp: dependencies.now().toISOString(),
      });
      return;
    }

    logger.info('partnerHistoricalOptionsContract.request', {
      requestId,
      requester: authResult.serviceAccountEmail,
      symbol,
      contractID,
      startDate: startDate ?? 'none',
      endDate: endDate ?? 'none',
    });

    const { adapter: gcs, bucket } = dependencies.getGcs();

    const metadata = await resolveContractMetadata(symbol, contractID, bucket);
    if (!metadata) {
      res.status(400).json({
        ok: false,
        error: 'Unable to derive expiration, type, and strike from contractID or GCS metadata',
        code: HistoricalOptionsErrorCode.BAD_REQUEST,
        timestamp: dependencies.now().toISOString(),
      });
      return;
    }

    const lines = await gcs.readLines(symbol, contractID);
    if (lines === undefined) {
      res.status(404).json({
        ok: false,
        error: 'Time series object not found',
        code: HistoricalOptionsErrorCode.NOT_FOUND,
        timestamp: dependencies.now().toISOString(),
      });
      return;
    }

    let fileFirstDate: string | undefined;
    let fileLastDate: string | undefined;
    const series: TimeSeriesApiObservation[] = [];
    for (const line of lines) {
      const record = parseStorageLine(line);
      if (!record) continue;
      if (fileFirstDate === undefined) fileFirstDate = record.d;
      fileLastDate = record.d;
      if (startDate && record.d < startDate) continue;
      if (endDate && record.d > endDate) continue;
      series.push(toApiObservation(record));
    }

    const responseStart = series[0]?.date ?? startDate ?? fileFirstDate ?? '';
    const responseEnd = series[series.length - 1]?.date ?? endDate ?? fileLastDate ?? '';

    const response = {
      ok: true,
      symbol,
      contractID,
      expiration: metadata.expiration,
      type: metadata.type,
      strike: metadata.strike,
      startDate: responseStart,
      endDate: responseEnd,
      series,
    };

    const responseBytes = Buffer.byteLength(JSON.stringify(response), 'utf8');
    if (responseBytes > MAX_RESPONSE_BYTES) {
      logger.warn('partnerHistoricalOptionsContract.response_too_large', {
        requestId,
        symbol,
        contractID,
        startDate: startDate ?? 'none',
        endDate: endDate ?? 'none',
        responseBytes,
        status: 413,
      });
      res.status(413).json({
        ok: false,
        error: 'Serialized response exceeds the 10 MiB size limit',
        code: HistoricalOptionsErrorCode.RESPONSE_TOO_LARGE,
        timestamp: dependencies.now().toISOString(),
      });
      return;
    }

    logger.info('partnerHistoricalOptionsContract.response', {
      requestId,
      symbol,
      contractID,
      startDate: startDate ?? 'none',
      endDate: endDate ?? 'none',
      seriesCount: series.length,
      responseBytes,
      processingTimeMs: dependencies.now().getTime() - startedAt,
    });
    res.status(200).json(response);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    logger.error('partnerHistoricalOptionsContract.error', {
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

export const partnerHistoricalOptionsContractV2 = onRequest(
  functionOptions,
  partnerHistoricalOptionsContractHandler,
);
