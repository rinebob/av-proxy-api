import { randomUUID } from 'node:crypto';

import { onRequest, type HttpsOptions } from 'firebase-functions/v2/https';
import type { Request, Response } from 'express';

import { isValidIsoDate } from '../common/utils/date-time.utils';
import { authenticateRequestEither, createLogger } from '../utils/utils';
import {
  type SpreadBatchRequest,
  type SpreadBatchResponse,
  type SpreadBatchErrorResponse,
  type SpreadBatchItem,
  type SpreadBatchItemSuccess,
  type SpreadBatchItemFailure,
  type SpreadRequest,
  SpreadErrorCode,
} from './spread-request.types';
import { validateSpread, SpreadPricingService } from '../spread-pricing/services';
import {
  allowedServiceAccounts,
  expectedGoogleAudience,
  defaultGetGcs,
  type GcsAdapterPair,
} from './partner-handler-base';

const MAX_BATCH_SIZE = 200;
const MAX_RESPONSE_BYTES = 10 * 1024 * 1024;
const CONCURRENCY = 10;

const logger = createLogger('[partner-spread-time-series-batch]');

const functionOptions: HttpsOptions = {
  memory: '1GiB',
  maxInstances: 20,
  timeoutSeconds: 120,
  secrets: [allowedServiceAccounts, expectedGoogleAudience],
};

export interface PartnerSpreadTimeSeriesBatchDependencies {
  authenticateRequest: typeof authenticateRequestEither;
  getGcs: () => GcsAdapterPair;
  randomUUID: () => string;
  now: () => Date;
}

const defaultDependencies: PartnerSpreadTimeSeriesBatchDependencies = {
  authenticateRequest: authenticateRequestEither,
  getGcs: defaultGetGcs,
  randomUUID: () => randomUUID(),
  now: () => new Date(),
};

/**
 * HTTPS handler for `partnerSpreadTimeSeriesBatch`.
 * Computes time series for up to 200 spreads in a single request.
 * Returns per-spread results with partial failure support.
 */
export async function partnerSpreadTimeSeriesBatchHandler(
  req: Request,
  res: Response,
  dependencies: PartnerSpreadTimeSeriesBatchDependencies = defaultDependencies,
): Promise<void> {
  const startedAt = dependencies.now().getTime();
  const requestId = dependencies.randomUUID();

  try {
    if (req.method !== 'POST') {
      res.status(405).json({
        ok: false,
        error: 'Method Not Allowed',
        code: SpreadErrorCode.METHOD_NOT_ALLOWED,
        timestamp: dependencies.now().toISOString(),
      } satisfies SpreadBatchErrorResponse);
      return;
    }

    const authResult = await dependencies.authenticateRequest(req, res);
    if (!authResult) return;

    if (!('serviceAccountEmail' in authResult)) {
      logger.warn('partnerSpreadTimeSeriesBatch.forbidden', { requestId, status: 403 });
      res.status(403).json({
        ok: false,
        error: 'Service account authentication is required',
        code: SpreadErrorCode.FORBIDDEN,
        timestamp: dependencies.now().toISOString(),
      } satisfies SpreadBatchErrorResponse);
      return;
    }

    const body = req.body as SpreadBatchRequest | undefined;
    if (!body || typeof body !== 'object' || !Array.isArray(body.spreads)) {
      res.status(400).json({
        ok: false,
        error: 'Missing or invalid request body. Expected JSON with a "spreads" array.',
        code: SpreadErrorCode.BAD_REQUEST,
        timestamp: dependencies.now().toISOString(),
      } satisfies SpreadBatchErrorResponse);
      return;
    }

    if (body.spreads.length === 0) {
      res.status(400).json({
        ok: false,
        error: 'spreads array must not be empty',
        code: SpreadErrorCode.BAD_REQUEST,
        timestamp: dependencies.now().toISOString(),
      } satisfies SpreadBatchErrorResponse);
      return;
    }

    if (body.spreads.length > MAX_BATCH_SIZE) {
      res.status(400).json({
        ok: false,
        error: `spreads array exceeds maximum batch size of ${MAX_BATCH_SIZE}`,
        code: SpreadErrorCode.BAD_REQUEST,
        timestamp: dependencies.now().toISOString(),
      } satisfies SpreadBatchErrorResponse);
      return;
    }

    const batchStartDate = body.startDate;
    const batchEndDate = body.endDate;

    if (batchStartDate !== undefined && !isValidIsoDate(batchStartDate)) {
      res.status(400).json({
        ok: false,
        error: 'Invalid startDate. Expected YYYY-MM-DD.',
        code: SpreadErrorCode.BAD_REQUEST,
        timestamp: dependencies.now().toISOString(),
      } satisfies SpreadBatchErrorResponse);
      return;
    }

    if (batchEndDate !== undefined && !isValidIsoDate(batchEndDate)) {
      res.status(400).json({
        ok: false,
        error: 'Invalid endDate. Expected YYYY-MM-DD.',
        code: SpreadErrorCode.BAD_REQUEST,
        timestamp: dependencies.now().toISOString(),
      } satisfies SpreadBatchErrorResponse);
      return;
    }

    if (batchStartDate !== undefined && batchEndDate !== undefined && batchStartDate > batchEndDate) {
      res.status(400).json({
        ok: false,
        error: 'startDate must be less than or equal to endDate',
        code: SpreadErrorCode.BAD_REQUEST,
        timestamp: dependencies.now().toISOString(),
      } satisfies SpreadBatchErrorResponse);
      return;
    }

    logger.info('partnerSpreadTimeSeriesBatch.request', {
      requestId,
      requester: authResult.serviceAccountEmail,
      spreadCount: body.spreads.length,
      startDate: batchStartDate ?? 'none',
      endDate: batchEndDate ?? 'none',
    });

    const { adapter: gcs } = dependencies.getGcs();
    const pricingService = new SpreadPricingService(gcs);

    const results = await processBatch(
      pricingService,
      body.spreads,
      batchStartDate,
      batchEndDate,
    );

    const succeeded = results.filter((r) => r.ok).length;
    const failed = results.length - succeeded;

    const response: SpreadBatchResponse = {
      ok: true,
      total: results.length,
      succeeded,
      failed,
      results,
    };

    const responseBytes = Buffer.byteLength(JSON.stringify(response), 'utf8');
    if (responseBytes > MAX_RESPONSE_BYTES) {
      logger.warn('partnerSpreadTimeSeriesBatch.response_too_large', {
        requestId,
        spreadCount: body.spreads.length,
        responseBytes,
        status: 413,
      });
      res.status(413).json({
        ok: false,
        error: 'Serialized response exceeds the 10 MiB size limit',
        code: SpreadErrorCode.RESPONSE_TOO_LARGE,
        timestamp: dependencies.now().toISOString(),
      } satisfies SpreadBatchErrorResponse);
      return;
    }

    logger.info('partnerSpreadTimeSeriesBatch.response', {
      requestId,
      spreadCount: body.spreads.length,
      succeeded,
      failed,
      responseBytes,
      processingTimeMs: dependencies.now().getTime() - startedAt,
    });
    res.status(200).json(response);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    logger.error('partnerSpreadTimeSeriesBatch.error', {
      requestId,
      error: message,
      status: 500,
      processingTimeMs: dependencies.now().getTime() - startedAt,
    });
    res.status(500).json({
      ok: false,
      error: 'Internal server error',
      code: SpreadErrorCode.INTERNAL_ERROR,
      timestamp: dependencies.now().toISOString(),
    } satisfies SpreadBatchErrorResponse);
  }
}

/**
 * Processes a batch of spread requests with bounded concurrency.
 * Each spread is validated and computed independently. Failures are captured
 * per-spread and do not abort the batch.
 */
async function processBatch(
  pricingService: SpreadPricingService,
  spreads: SpreadRequest[],
  batchStartDate?: string,
  batchEndDate?: string,
): Promise<SpreadBatchItem[]> {
  const results: SpreadBatchItem[] = new Array(spreads.length);

  for (let i = 0; i < spreads.length; i += CONCURRENCY) {
    const chunk = spreads.slice(i, i + CONCURRENCY);
    const offset = i;

    const chunkResults = await Promise.all(
      chunk.map(async (spread, j) => {
        const index = offset + j;

        const merged: SpreadRequest = {
          ...spread,
          startDate: batchStartDate ?? spread.startDate,
          endDate: batchEndDate ?? spread.endDate,
        };

        const validation = validateSpread(merged);
        if (!validation.valid) {
          return {
            ok: false,
            index,
            error: validation.error ?? 'Invalid spread request',
            code: SpreadErrorCode.BAD_REQUEST,
          } satisfies SpreadBatchItemFailure;
        }

        const result = await pricingService.computeSpread(merged);

        if ('error' in result) {
          return {
            ok: false,
            index,
            error: result.error,
            code: result.code,
          } satisfies SpreadBatchItemFailure;
        }

        return {
          ok: true,
          index,
          spreadType: result.spreadType,
          symbol: result.symbol,
          debitOrCredit: result.debitOrCredit,
          startDate: result.startDate,
          endDate: result.endDate,
          gaps: result.gaps,
          series: result.series,
        } satisfies SpreadBatchItemSuccess;
      }),
    );

    for (const item of chunkResults) {
      results[item.index] = item;
    }
  }

  return results;
}

export const partnerSpreadTimeSeriesBatch = onRequest(
  functionOptions,
  partnerSpreadTimeSeriesBatchHandler,
);
