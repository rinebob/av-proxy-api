import axios from 'axios';
import { onRequest, type HttpsOptions } from 'firebase-functions/v2/https';
import { defineSecret } from 'firebase-functions/params';
import { randomUUID } from 'node:crypto';
import type { Request, Response } from 'express';

import {
  AlphaVantageEndpoint,
  type AvHistoricalOptionsResponse,
  type SvtOptionsAnalysis,
} from '@shared/alpha-vantage';
import { ApiProvider, DATA_PROVIDERS, HttpMethod } from '@shared/core';

import { AlphaVantageUpstreamError } from '../alpha-vantage/utils';
import { HistoricalOptionsRetrievalService } from '../historical-options-corpus/services/historical-options-retrieval.service';
import { NoOpAvThrottle } from '../historical-options-corpus/services/av-throttle.service';
import { symbolManagerService } from '../alpha-vantage/services/symbol-manager.service';
import { authenticateRequestEither, createLogger, getAlphaVantageApiKey } from '../utils/utils';
import {
  HistoricalOptionsErrorCode,
  mapHistoricalOptionsProviderError,
  parseHistoricalOptionsRequest,
} from './historical-options-request.utils';
import {
  allowedServiceAccounts,
  expectedGoogleAudience,
} from './partner-handler-base';

const MAX_RESPONSE_BYTES = 10 * 1024 * 1024;
const logger = createLogger('[partner-historical-options]');

const alphaVantageApiKey = defineSecret('ALPHAVANTAGE_API_KEY');

function sendPartnerError(
  res: Response,
  status: number,
  code: HistoricalOptionsErrorCode,
  message: string,
  now: () => Date,
): void {
  res.status(status).json({
    ok: false,
    error: message,
    code,
    timestamp: now().toISOString(),
  });
}

const functionOptions: HttpsOptions = {
  memory: '1GiB',
  maxInstances: 10,
  timeoutSeconds: 60,
  secrets: [alphaVantageApiKey, allowedServiceAccounts, expectedGoogleAudience],
};

export interface HistoricalOptionsPartnerDependencies {
  authenticateRequest: typeof authenticateRequestEither;
  fetchOptions: (
    params: { symbol: string; date?: string },
  ) => Promise<{ response: AvHistoricalOptionsResponse; analysis: SvtOptionsAnalysis }>;
  hasExpectedGoogleAudience: () => boolean;
  isSymbolTracked: (symbol: string) => Promise<boolean>;
  now: () => Date;
}

const historicalOptionsPartnerDependencies: HistoricalOptionsPartnerDependencies = {
  authenticateRequest: authenticateRequestEither,
  fetchOptions: async (params) => {
    const provider = DATA_PROVIDERS[ApiProvider.ALPHA_VANTAGE];
    const retrieval = new HistoricalOptionsRetrievalService({
      axiosInstance: axios.create({
        baseURL: provider.baseUrl,
        timeout: provider.defaultTimeoutMs,
      }),
      throttle: new NoOpAvThrottle(),
      apiKey: getAlphaVantageApiKey(),
      baseUrl: provider.baseUrl,
    });
    return retrieval.fetch(params);
  },
  hasExpectedGoogleAudience: () => expectedGoogleAudience.value().split(',').some((value) => Boolean(value.trim())),
  isSymbolTracked: (symbol: string) => symbolManagerService.isSymbolTracked(symbol),
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
      sendPartnerError(res, 405, HistoricalOptionsErrorCode.METHOD_NOT_ALLOWED, 'Method Not Allowed', dependencies.now);
      return;
    }

    if (!dependencies.hasExpectedGoogleAudience()) {
      logger.error('historicalOptions.audience_not_configured', { requestId, status: 500 });
      sendPartnerError(res, 500, HistoricalOptionsErrorCode.INTERNAL_ERROR, 'Internal server error', dependencies.now);
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
      sendPartnerError(res, 403, HistoricalOptionsErrorCode.FORBIDDEN, 'Service account authentication is required', dependencies.now);
      return;
    }

    const request = parseHistoricalOptionsRequest(req.query.symbol, req.query.date);
    if (!request) {
      logger.warn('historicalOptions.invalid_request', { requestId, status: 400 });
      sendPartnerError(res, 400, HistoricalOptionsErrorCode.BAD_REQUEST, 'Invalid request. Provide a valid symbol and optional date in YYYY-MM-DD format.', dependencies.now);
      return;
    }

    const { symbol, date } = request;

    const isTracked = await dependencies.isSymbolTracked(symbol);
    if (!isTracked) {
      logger.warn('historicalOptions.symbol_not_tracked', { requestId, symbol, status: 404 });
      sendPartnerError(res, 404, HistoricalOptionsErrorCode.NOT_FOUND, `Symbol ${symbol} is not in the tracked_symbols collection. Add the symbol to tracked_symbols before retrying.`, dependencies.now);
      return;
    }

    logger.info('historicalOptions.request', {
      requestId,
      symbol,
      date: date ?? 'provider-default',
      requester: authResult.serviceAccountEmail,
    });

    let result: { response: AvHistoricalOptionsResponse; analysis: SvtOptionsAnalysis };
    const upstreamStartedAt = dependencies.now().getTime();
    try {
      result = await dependencies.fetchOptions({ symbol, date });
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
      sendPartnerError(res, mapped.status, mapped.code, mapped.message, dependencies.now);
      return;
    }

    const response = {
      ok: true,
      symbol,
      date: date ?? null,
      source: ApiProvider.ALPHA_VANTAGE,
      endpoint: AlphaVantageEndpoint.HISTORICAL_OPTIONS,
      data: result.response,
      analysis: result.analysis,
      timestamp: dependencies.now().toISOString(),
      processingTimeMs: dependencies.now().getTime() - startedAt,
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
      sendPartnerError(res, 413, HistoricalOptionsErrorCode.RESPONSE_TOO_LARGE, 'Historical options response exceeds the supported response size', dependencies.now);
      return;
    }

    logger.info('historicalOptions.response', {
      requestId,
      symbol,
      date: date ?? 'provider-default',
      contracts: result.response.data.length,
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
    sendPartnerError(res, 500, HistoricalOptionsErrorCode.INTERNAL_ERROR, 'Internal server error', dependencies.now);
  }
}

export const partnerHistoricalOptionsV2 = onRequest(functionOptions, historicalOptionsPartnerHandler);
