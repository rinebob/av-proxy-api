import { onRequest } from 'firebase-functions/v2/https';
import { defineSecret } from 'firebase-functions/params';
import { randomUUID } from 'node:crypto';
import type { Request, Response } from 'express';

import {
  AlphaVantageEndpoint,
  type AvHistoricalOptionsResponse,
} from '@shared/alpha-vantage';
import { ApiProvider, HttpMethod } from '@shared/core';

import { AlphaVantageHandlerFactory } from '../alpha-vantage/alpha-vantage-factory';
import { AvHistoricalOptionsHandler } from '../alpha-vantage/handlers/av-historical-options.handler';
import {
  AlphaVantageUpstreamError,
  analyzeOptions,
} from '../alpha-vantage/utils';
import { authenticateRequestEither, createLogger } from '../utils/utils';
import {
  HistoricalOptionsErrorCode,
  mapHistoricalOptionsProviderError,
  parseHistoricalOptionsRequest,
} from './historical-options-request.utils';

const MAX_RESPONSE_BYTES = 10 * 1024 * 1024;
const logger = createLogger('[partner-historical-options]');

const alphaVantageApiKey = defineSecret('ALPHAVANTAGE_API_KEY');
const allowedServiceAccounts = defineSecret('ALLOWED_SERVICE_ACCOUNT_EMAILS');
const expectedGoogleAudience = defineSecret('EXPECTED_GOOGLE_AUDIENCE');

type HttpsOptions = {
  memory: '128MiB' | '256MiB' | '512MiB' | '1GiB' | '2GiB' | '4GiB' | '8GiB';
  maxInstances?: number;
  timeoutSeconds?: number;
  secrets?: ReturnType<typeof defineSecret>[];
};

const functionOptions: HttpsOptions = {
  memory: '1GiB',
  maxInstances: 10,
  timeoutSeconds: 60,
  secrets: [alphaVantageApiKey, allowedServiceAccounts, expectedGoogleAudience],
};

export interface HistoricalOptionsPartnerDependencies {
  authenticateRequest: typeof authenticateRequestEither;
  fetchOptions: (params: { symbol: string; date?: string }) => Promise<AvHistoricalOptionsResponse>;
  analyzeOptionsData: typeof analyzeOptions;
  hasExpectedGoogleAudience: () => boolean;
  now: () => Date;
}

const historicalOptionsPartnerDependencies: HistoricalOptionsPartnerDependencies = {
  authenticateRequest: authenticateRequestEither,
  fetchOptions: async params => {
    const optionsHandler = AlphaVantageHandlerFactory.createHandler<AvHistoricalOptionsHandler>(
      AlphaVantageEndpoint.HISTORICAL_OPTIONS,
    );
    return optionsHandler.fetchWithoutPersistence(params);
  },
  analyzeOptionsData: analyzeOptions,
  hasExpectedGoogleAudience: () => expectedGoogleAudience.value().split(',').some(value => Boolean(value.trim())),
  now: () => new Date(),
};

export async function historicalOptionsPartnerHandler(
  req: Request,
  res: Response,
  dependencies: HistoricalOptionsPartnerDependencies = historicalOptionsPartnerDependencies,
): Promise<void> {
  const startedAt = dependencies.now().getTime();
  const requestId = randomUUID();

  try {
    if (req.method !== HttpMethod.GET) {
      logger.warn('historicalOptions.method_not_allowed', {
        requestId,
        method: req.method,
        status: 405,
        processingTimeMs: dependencies.now().getTime() - startedAt,
      });
      res.status(405).json({
        ok: false,
        error: 'Method Not Allowed',
        code: HistoricalOptionsErrorCode.METHOD_NOT_ALLOWED,
        timestamp: dependencies.now().toISOString(),
      });
      return;
    }

    if (!dependencies.hasExpectedGoogleAudience()) {
      logger.error('historicalOptions.audience_not_configured', { requestId, status: 500 });
      res.status(500).json({
        ok: false,
        error: 'Internal server error',
        code: HistoricalOptionsErrorCode.INTERNAL_ERROR,
        timestamp: dependencies.now().toISOString(),
      });
      return;
    }

    const authResult = await dependencies.authenticateRequest(req, res);
    if (!authResult) {
      logger.warn('historicalOptions.authentication_rejected', {
        requestId,
        status: res.statusCode,
        processingTimeMs: dependencies.now().getTime() - startedAt,
      });
      return;
    }

    if (!('serviceAccountEmail' in authResult)) {
      logger.warn('historicalOptions.firebase_auth_rejected', { requestId, status: 403 });
      res.status(403).json({
        ok: false,
        error: 'Service account authentication is required',
        code: HistoricalOptionsErrorCode.FORBIDDEN,
        timestamp: dependencies.now().toISOString(),
      });
      return;
    }

    const request = parseHistoricalOptionsRequest(req.query.symbol, req.query.date);
    if (!request) {
      logger.warn('historicalOptions.invalid_request', { requestId, status: 400 });
      res.status(400).json({
        ok: false,
        error: 'Invalid request. Provide a valid symbol and optional date in YYYY-MM-DD format.',
        code: HistoricalOptionsErrorCode.BAD_REQUEST,
        timestamp: dependencies.now().toISOString(),
      });
      return;
    }

    const { symbol, date } = request;

    logger.info('historicalOptions.request', {
      requestId,
      symbol,
      date: date ?? 'provider-default',
      requester: authResult.serviceAccountEmail,
    });

    let data: AvHistoricalOptionsResponse;
    const upstreamStartedAt = dependencies.now().getTime();
    try {
      data = await dependencies.fetchOptions({ symbol, date });
    } catch (error) {
      if (!(error instanceof AlphaVantageUpstreamError)) {
        throw error;
      }

      const mapped = mapHistoricalOptionsProviderError(error);
      logger.error('historicalOptions.provider_error', {
        requestId,
        symbol,
        date,
        code: mapped.code,
        status: mapped.status,
        upstreamTimeMs: dependencies.now().getTime() - upstreamStartedAt,
      });
      res.status(mapped.status).json({
        ok: false,
        error: mapped.message,
        code: mapped.code,
        timestamp: dependencies.now().toISOString(),
      });
      return;
    }

    const response = {
      ok: true,
      symbol,
      date: date ?? null,
      source: ApiProvider.ALPHA_VANTAGE,
      endpoint: AlphaVantageEndpoint.HISTORICAL_OPTIONS,
      data,
      analysis: dependencies.analyzeOptionsData(data.data),
      timestamp: dependencies.now().toISOString(),
      processingTimeMs: dependencies.now().getTime() - startedAt
    };

    const responseBytes = Buffer.byteLength(JSON.stringify(response), 'utf8');
    if (responseBytes > MAX_RESPONSE_BYTES) {
      logger.warn('historicalOptions.response_too_large', {
        requestId,
        symbol,
        date,
        responseBytes,
        status: 413,
        upstreamTimeMs: dependencies.now().getTime() - upstreamStartedAt,
      });
      res.status(413).json({
        ok: false,
        error: 'Historical options response exceeds the supported response size',
        code: HistoricalOptionsErrorCode.RESPONSE_TOO_LARGE,
        timestamp: dependencies.now().toISOString(),
      });
      return;
    }

    logger.info('historicalOptions.response', {
      requestId,
      symbol,
      date: date ?? 'provider-default',
      contracts: data.data.length,
      responseBytes,
      status: 200,
      upstreamTimeMs: dependencies.now().getTime() - upstreamStartedAt,
      processingTimeMs: response.processingTimeMs,
    });
    res.status(200).json(response);
  } catch (error) {
    const message = error instanceof Error ? error.message : HistoricalOptionsErrorCode.INTERNAL_ERROR;
    logger.error('historicalOptions.error', {
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

export const partnerHistoricalOptionsV2 = onRequest(functionOptions, historicalOptionsPartnerHandler);
