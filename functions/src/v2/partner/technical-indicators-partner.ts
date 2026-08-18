/**
 * Partner HTTPS endpoint for technical indicators (Hilbert Transform family).
 * On-demand: calls Alpha Vantage directly on each request — no Firestore persistence.
 *
 * Config-driven: the `indicator` query param is resolved through TECHNICAL_INDICATORS_CONFIG
 * to determine which AV function to call and which params to pass. Adding a new indicator
 * is a config entry — no code change needed.
 */
import axios from 'axios';
import { onRequest, type HttpsOptions } from 'firebase-functions/v2/https';
import { defineSecret } from 'firebase-functions/params';
import { randomUUID } from 'node:crypto';
import type { Request, Response } from 'express';

import { TECHNICAL_INDICATORS_CONFIG } from '@shared/alpha-vantage';
import { ApiProvider, DATA_PROVIDERS, HttpMethod } from '@shared/core';

import { toAlphaVantageUpstreamError } from '../alpha-vantage/utils';
import { withCors } from '../utils/cors-middleware';
import { authenticateRequestEither, createLogger, getAlphaVantageApiKey } from '../utils/utils';
import { allowedServiceAccounts, expectedGoogleAudience } from './partner-handler-base';
import {
  TechnicalIndicatorsErrorCode,
  mapTechnicalIndicatorsProviderError,
} from './technical-indicators-request.utils';
import { db } from '../../firebase-admin-init';
import { FirestoreCollection } from '@shared/firestore';

const MAX_RESPONSE_BYTES = 10 * 1024 * 1024;
const logger = createLogger('[partner-technical-indicators]');
const alphaVantageApiKey = defineSecret('ALPHAVANTAGE_API_KEY');

const functionOptions: HttpsOptions = {
  memory: '256MiB',
  maxInstances: 20,
  timeoutSeconds: 30,
  secrets: [alphaVantageApiKey, allowedServiceAccounts, expectedGoogleAudience],
};

const VALID_INTERVALS = ['1min', '5min', '15min', '30min', '60min', 'daily', 'weekly', 'monthly'];
const VALID_SERIES_TYPES = ['open', 'high', 'low', 'close'];

// ── Dependency injection interface ───────────────────────────────────────────

export interface TechnicalIndicatorsPartnerDependencies {
  authenticateRequest: typeof authenticateRequestEither;
  symbolExists: (symbol: string) => Promise<boolean>;
  fetchIndicator: (params: Record<string, string>) => Promise<unknown>;
  hasExpectedGoogleAudience: () => boolean;
  now: () => Date;
}

const defaultDependencies: TechnicalIndicatorsPartnerDependencies = {
  authenticateRequest: authenticateRequestEither,
  symbolExists: async (symbol: string) => {
    const snap = await db.doc(`${FirestoreCollection.TRACKED_SYMBOLS}/${symbol}`).get();
    return snap.exists;
  },
  fetchIndicator: async (params: Record<string, string>) => {
    const provider = DATA_PROVIDERS[ApiProvider.ALPHA_VANTAGE];
    const response = await axios.get(provider.baseUrl, {
      params: { ...params, apikey: getAlphaVantageApiKey() },
      timeout: provider.defaultTimeoutMs,
    });
    return response.data;
  },
  hasExpectedGoogleAudience: () =>
    expectedGoogleAudience.value().split(',').some((value) => Boolean(value.trim())),
  now: () => new Date(),
};

// ── Handler ──────────────────────────────────────────────────────────────────

export async function technicalIndicatorsPartnerHandler(
  req: Request,
  res: Response,
  dependencies: TechnicalIndicatorsPartnerDependencies = defaultDependencies,
): Promise<void> {
  const startedAt = dependencies.now().getTime();
  const requestId = randomUUID();

  try {
    if (req.method === HttpMethod.OPTIONS) {
      res.status(204).send('');
      return;
    }
    if (req.method !== HttpMethod.GET) {
      logger.warn('technicalIndicators.method_not_allowed', { requestId, method: req.method, status: 405 });
      res.status(405).json({
        ok: false,
        error: 'Method Not Allowed',
        code: TechnicalIndicatorsErrorCode.METHOD_NOT_ALLOWED,
        timestamp: dependencies.now().toISOString(),
      });
      return;
    }

    if (!dependencies.hasExpectedGoogleAudience()) {
      logger.error('technicalIndicators.audience_not_configured', { requestId, status: 500 });
      res.status(500).json({
        ok: false,
        error: 'Internal server error',
        code: TechnicalIndicatorsErrorCode.INTERNAL_ERROR,
        timestamp: dependencies.now().toISOString(),
      });
      return;
    }

    const authResult = await dependencies.authenticateRequest(req, res);
    if (!authResult) {
      logger.warn('technicalIndicators.auth_rejected', { requestId, status: res.statusCode });
      return;
    }

    // Dual-auth: accept both service-account (server-to-server OIDC) and Firebase user
    // (browser ID token) auth. Per PRD-av-endpoints-hilbert-fe.md §Technical Context,
    // the SA UI calls this endpoint directly from the browser using Firebase ID tokens.
    // The service-account path remains for server-to-server callers.
    const requester = 'serviceAccountEmail' in authResult
      ? authResult.serviceAccountEmail
      : `firebase-user:${(authResult as any)?.uid ?? 'unknown'}`;

    // ── Param validation ─────────────────────────────────────────────────────

    const rawSymbol = String(req.query.symbol || '').trim();
    const rawIndicator = String(req.query.indicator || '').trim().toLowerCase();
    const rawInterval = String(req.query.interval || '').trim().toLowerCase();
    const rawSeriesType = String(req.query.series_type || '').trim().toLowerCase();

    if (!rawSymbol) {
      logger.warn('technicalIndicators.missing_symbol', { requestId, status: 400 });
      res.status(400).json({
        ok: false,
        error: 'Missing required parameter: symbol',
        code: TechnicalIndicatorsErrorCode.BAD_REQUEST,
        timestamp: dependencies.now().toISOString(),
      });
      return;
    }

    if (!rawIndicator) {
      logger.warn('technicalIndicators.missing_indicator', { requestId, status: 400 });
      res.status(400).json({
        ok: false,
        error: 'Missing required parameter: indicator',
        code: TechnicalIndicatorsErrorCode.BAD_REQUEST,
        timestamp: dependencies.now().toISOString(),
      });
      return;
    }

    const indicatorConfig = TECHNICAL_INDICATORS_CONFIG[rawIndicator];
    if (!indicatorConfig) {
      const validIndicators = Object.keys(TECHNICAL_INDICATORS_CONFIG);
      logger.warn('technicalIndicators.invalid_indicator', { requestId, indicator: rawIndicator, status: 400 });
      res.status(400).json({
        ok: false,
        error: `Invalid indicator: ${rawIndicator}`,
        code: TechnicalIndicatorsErrorCode.BAD_REQUEST,
        validIndicators,
        timestamp: dependencies.now().toISOString(),
      });
      return;
    }

    const interval = rawInterval || indicatorConfig.defaultParams?.interval || 'daily';
    if (!VALID_INTERVALS.includes(interval)) {
      logger.warn('technicalIndicators.invalid_interval', { requestId, interval, status: 400 });
      res.status(400).json({
        ok: false,
        error: `Invalid interval: ${interval}. Valid values: ${VALID_INTERVALS.join(', ')}`,
        code: TechnicalIndicatorsErrorCode.BAD_REQUEST,
        timestamp: dependencies.now().toISOString(),
      });
      return;
    }

    const seriesType = rawSeriesType || indicatorConfig.defaultParams?.series_type || 'close';
    if (!VALID_SERIES_TYPES.includes(seriesType)) {
      logger.warn('technicalIndicators.invalid_series_type', { requestId, seriesType, status: 400 });
      res.status(400).json({
        ok: false,
        error: `Invalid series_type: ${seriesType}. Valid values: ${VALID_SERIES_TYPES.join(', ')}`,
        code: TechnicalIndicatorsErrorCode.BAD_REQUEST,
        timestamp: dependencies.now().toISOString(),
      });
      return;
    }

    const symbol = rawSymbol.toUpperCase();

    logger.info('technicalIndicators.request', {
      requestId,
      symbol,
      indicator: rawIndicator,
      interval,
      series_type: seriesType,
      requester,
    });

    // ── Symbol enforcement ───────────────────────────────────────────────────

    const exists = await dependencies.symbolExists(symbol);
    if (!exists) {
      logger.info('technicalIndicators.symbol_not_tracked', { requestId, symbol, status: 404 });
      res.status(404).json({
        ok: false,
        error: `Symbol ${symbol} is not tracked`,
        code: TechnicalIndicatorsErrorCode.NOT_FOUND,
        timestamp: dependencies.now().toISOString(),
      });
      return;
    }

    // ── AV API call ──────────────────────────────────────────────────────────

    const avParams: Record<string, string> = {
      function: indicatorConfig.function,
      symbol,
      interval,
      series_type: seriesType,
    };

    let data: unknown;
    const upstreamStartedAt = dependencies.now().getTime();
    try {
      data = await dependencies.fetchIndicator(avParams);
    } catch (error) {
      const upstreamError = toAlphaVantageUpstreamError(error);
      const mapped = mapTechnicalIndicatorsProviderError(upstreamError);
      logger.error('technicalIndicators.upstream_error', {
        requestId,
        symbol,
        indicator: rawIndicator,
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

    // ── Response envelope ────────────────────────────────────────────────────

    const response = {
      ok: true,
      symbol,
      indicator: rawIndicator,
      interval,
      series_type: seriesType,
      data,
      timestamp: dependencies.now().toISOString(),
      processingTimeMs: dependencies.now().getTime() - startedAt,
    };

    const responseBytes = Buffer.byteLength(JSON.stringify(response), 'utf8');
    if (responseBytes > MAX_RESPONSE_BYTES) {
      logger.warn('technicalIndicators.response_too_large', {
        requestId,
        symbol,
        indicator: rawIndicator,
        responseBytes,
        status: 413,
        upstreamTimeMs: dependencies.now().getTime() - upstreamStartedAt,
      });
      res.status(413).json({
        ok: false,
        error: 'Technical indicators response exceeds the supported response size',
        code: TechnicalIndicatorsErrorCode.RESPONSE_TOO_LARGE,
        timestamp: dependencies.now().toISOString(),
      });
      return;
    }

    logger.info('technicalIndicators.response', {
      requestId,
      symbol,
      indicator: rawIndicator,
      status: 200,
      responseBytes,
      upstreamTimeMs: dependencies.now().getTime() - upstreamStartedAt,
      processingTimeMs: response.processingTimeMs,
    });

    res.status(200).json(response);
  } catch (error) {
    const message = error instanceof Error ? error.message : TechnicalIndicatorsErrorCode.INTERNAL_ERROR;
    logger.error('technicalIndicators.error', {
      requestId,
      error: message,
      status: 500,
      processingTimeMs: dependencies.now().getTime() - startedAt,
    });
    res.status(500).json({
      ok: false,
      error: 'Internal server error',
      code: TechnicalIndicatorsErrorCode.INTERNAL_ERROR,
      timestamp: dependencies.now().toISOString(),
    });
  }
}

export const partnerTechnicalIndicatorsV2 = onRequest(
  functionOptions,
  withCors(technicalIndicatorsPartnerHandler),
);
