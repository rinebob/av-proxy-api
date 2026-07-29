import { randomUUID } from 'node:crypto';

import { onRequest, type HttpsOptions } from 'firebase-functions/v2/https';
import type { Request, Response } from 'express';

import { authenticateRequestEither, createLogger } from '../utils/utils';
import {
  type SpreadRequest,
  type SpreadResponse,
  type SpreadErrorResponse,
  SpreadErrorCode,
} from './spread-request.types';
import { validateSpread, SpreadPricingService } from '../spread-pricing/services';
import {
  allowedServiceAccounts,
  expectedGoogleAudience,
  defaultGetGcs,
  type GcsAdapterPair,
} from './partner-handler-base';

const MAX_RESPONSE_BYTES = 10 * 1024 * 1024;

const logger = createLogger('[partner-spread-time-series]');

const functionOptions: HttpsOptions = {
  memory: '256MiB',
  maxInstances: 20,
  timeoutSeconds: 30,
  secrets: [allowedServiceAccounts, expectedGoogleAudience],
};

export interface PartnerSpreadTimeSeriesDependencies {
  authenticateRequest: typeof authenticateRequestEither;
  getGcs: () => GcsAdapterPair;
  randomUUID: () => string;
  now: () => Date;
}

const defaultDependencies: PartnerSpreadTimeSeriesDependencies = {
  authenticateRequest: authenticateRequestEither,
  getGcs: defaultGetGcs,
  randomUUID: () => randomUUID(),
  now: () => new Date(),
};

/**
 * HTTPS handler for `partnerSpreadTimeSeries`.
 * Computes and returns a historical time series for a single options spread.
 */
export async function partnerSpreadTimeSeriesHandler(
  req: Request,
  res: Response,
  dependencies: PartnerSpreadTimeSeriesDependencies = defaultDependencies,
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
      } satisfies SpreadErrorResponse);
      return;
    }

    const authResult = await dependencies.authenticateRequest(req, res);
    if (!authResult) return;

    if (!('serviceAccountEmail' in authResult)) {
      logger.warn('partnerSpreadTimeSeries.forbidden', { requestId, status: 403 });
      res.status(403).json({
        ok: false,
        error: 'Service account authentication is required',
        code: SpreadErrorCode.FORBIDDEN,
        timestamp: dependencies.now().toISOString(),
      } satisfies SpreadErrorResponse);
      return;
    }

    const body = req.body as SpreadRequest | undefined;
    if (!body || typeof body !== 'object') {
      res.status(400).json({
        ok: false,
        error: 'Missing or invalid request body. Expected JSON with spreadType, symbol, and legs.',
        code: SpreadErrorCode.BAD_REQUEST,
        timestamp: dependencies.now().toISOString(),
      } satisfies SpreadErrorResponse);
      return;
    }

    const validation = validateSpread(body);
    if (!validation.valid) {
      res.status(400).json({
        ok: false,
        error: validation.error ?? 'Invalid spread request',
        code: SpreadErrorCode.BAD_REQUEST,
        timestamp: dependencies.now().toISOString(),
      } satisfies SpreadErrorResponse);
      return;
    }

    logger.info('partnerSpreadTimeSeries.request', {
      requestId,
      requester: authResult.serviceAccountEmail,
      spreadType: body.spreadType,
      symbol: body.symbol,
      legCount: body.legs.length,
      startDate: body.startDate ?? 'none',
      endDate: body.endDate ?? 'none',
    });

    const { adapter: gcs } = dependencies.getGcs();
    const pricingService = new SpreadPricingService(gcs);

    const result = await pricingService.computeSpread(body);

    if ('error' in result) {
      const status = result.code === SpreadErrorCode.NOT_FOUND ? 400 : 500;
      res.status(status).json({
        ok: false,
        error: result.error,
        code: result.code,
        timestamp: dependencies.now().toISOString(),
      } satisfies SpreadErrorResponse);
      return;
    }

    const response: SpreadResponse = {
      ok: true,
      ...result,
    };

    const responseBytes = Buffer.byteLength(JSON.stringify(response), 'utf8');
    if (responseBytes > MAX_RESPONSE_BYTES) {
      logger.warn('partnerSpreadTimeSeries.response_too_large', {
        requestId,
        spreadType: body.spreadType,
        symbol: body.symbol,
        responseBytes,
        status: 413,
      });
      res.status(413).json({
        ok: false,
        error: 'Serialized response exceeds the 10 MiB size limit',
        code: SpreadErrorCode.RESPONSE_TOO_LARGE,
        timestamp: dependencies.now().toISOString(),
      } satisfies SpreadErrorResponse);
      return;
    }

    logger.info('partnerSpreadTimeSeries.response', {
      requestId,
      spreadType: body.spreadType,
      symbol: body.symbol,
      seriesCount: response.series.length,
      gapsCount: response.gaps.length,
      responseBytes,
      processingTimeMs: dependencies.now().getTime() - startedAt,
    });
    res.status(200).json(response);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    logger.error('partnerSpreadTimeSeries.error', {
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
    } satisfies SpreadErrorResponse);
  }
}

export const partnerSpreadTimeSeries = onRequest(
  functionOptions,
  partnerSpreadTimeSeriesHandler,
);
