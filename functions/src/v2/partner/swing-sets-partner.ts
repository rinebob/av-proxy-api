/**
 * partnerSwingSetsV2 — partner read endpoint for SA-owned swing sets
 * (Task #128). This is the ONLY external read path into options-swing-sets;
 * direct Firestore reads by consumers are not allowed (IMPL §5).
 *
 * GET /partnerSwingSetsV2?symbol={symbol}&paramsId={paramsId}
 * - symbol required; paramsId optional
 * - not tracked → 404 NOT_FOUND
 * - tracked but !optionsEnabled → 403 OPTIONS_NOT_ENABLED
 * - paramsId given → that SwingSetDoc or 404
 * - paramsId omitted → canonical docs present for the symbol, keyed by
 *   paramsId (a partial set means generation is still in progress)
 *
 * Auth: same dual-auth as partnerHistoricalOptionsV2 — a Google service
 * account is required; Firebase-authenticated callers get 403.
 */
import { onRequest, type HttpsOptions } from 'firebase-functions/v2/https';
import { randomUUID } from 'node:crypto';
import type { Request, Response } from 'express';

import { FirestoreCollection } from '@shared/firestore';
import { HttpMethod } from '@shared/core';
import { CANONICAL_ZIGZAG_CONFIGS, deriveParamsId } from '@shared/zigzag';
import type { SwingSetDoc } from '@shared/zigzag';

import { db } from '../../firebase-admin-init';
import { authenticateRequestEither, createLogger } from '../utils/utils';
import { SwingSetRepository } from '../swing-set/services/swing-set.repository';
import { allowedServiceAccounts, expectedGoogleAudience } from './partner-handler-base';

const logger = createLogger('[partner-swing-sets]');
const CANONICAL_PARAMS_IDS = new Set(CANONICAL_ZIGZAG_CONFIGS.map(deriveParamsId));

export enum SwingSetsErrorCode {
  BAD_REQUEST = 'BAD_REQUEST',
  FORBIDDEN = 'FORBIDDEN',
  INTERNAL_ERROR = 'INTERNAL_ERROR',
  METHOD_NOT_ALLOWED = 'METHOD_NOT_ALLOWED',
  NOT_FOUND = 'NOT_FOUND',
  OPTIONS_NOT_ENABLED = 'OPTIONS_NOT_ENABLED',
}

// Symbol must match the tracked-symbols keying pattern (same shape the
// historical-options endpoint validates against).
const SYMBOL_PATTERN = /^[A-Z0-9][A-Z0-9.-]{0,31}$/;
// paramsId is interpolated into a doc id — keep it to the deriveParamsId
// alphabet so odd inputs can't address nested Firestore paths.
const PARAMS_ID_PATTERN = /^[A-Za-z0-9_-]+$/;

function sendPartnerError(
  res: Response,
  status: number,
  code: SwingSetsErrorCode,
  message: string,
  now: () => Date,
): void {
  res.status(status).json({ ok: false, error: message, code, timestamp: now().toISOString() });
}

const functionOptions: HttpsOptions = {
  memory: '512MiB',
  maxInstances: 10,
  timeoutSeconds: 60,
  secrets: [allowedServiceAccounts, expectedGoogleAudience],
};

export interface SwingSetsPartnerDependencies {
  authenticateRequest: typeof authenticateRequestEither;
  hasExpectedGoogleAudience: () => boolean;
  getTrackedFlags: (symbol: string) => Promise<{ tracked: boolean; optionsEnabled: boolean }>;
  getSwingSet: (symbol: string, paramsId: string) => Promise<SwingSetDoc | null>;
  listSwingSets: (symbol: string) => Promise<SwingSetDoc[]>;
  now: () => Date;
}

const repository = new SwingSetRepository(db);

const swingSetsPartnerDependencies: SwingSetsPartnerDependencies = {
  authenticateRequest: authenticateRequestEither,
  hasExpectedGoogleAudience: () =>
    expectedGoogleAudience.value().split(',').some((v) => Boolean(v.trim())),
  getTrackedFlags: async (symbol) => {
    const snap = await db.collection(FirestoreCollection.TRACKED_SYMBOLS).doc(symbol).get();
    const data = snap.data() as { optionsEnabled?: boolean } | undefined;
    return { tracked: snap.exists, optionsEnabled: data?.optionsEnabled === true };
  },
  getSwingSet: (symbol, paramsId) => repository.get(symbol, paramsId),
  listSwingSets: (symbol) => repository.listBySymbol(symbol),
  now: () => new Date(),
};

export async function swingSetsPartnerHandler(
  req: Request,
  res: Response,
  dependencies: SwingSetsPartnerDependencies = swingSetsPartnerDependencies,
): Promise<void> {
  const startedAt = dependencies.now().getTime();
  const requestId = randomUUID();

  try {
    if (req.method !== HttpMethod.GET) {
      sendPartnerError(res, 405, SwingSetsErrorCode.METHOD_NOT_ALLOWED, 'Method Not Allowed', dependencies.now);
      return;
    }

    if (!dependencies.hasExpectedGoogleAudience()) {
      logger.error('swingSets.audience_not_configured', { requestId });
      sendPartnerError(res, 500, SwingSetsErrorCode.INTERNAL_ERROR, 'Internal server error', dependencies.now);
      return;
    }

    const authResult = await dependencies.authenticateRequest(req, res);
    if (!authResult) return;

    if (!('serviceAccountEmail' in authResult)) {
      sendPartnerError(res, 403, SwingSetsErrorCode.FORBIDDEN, 'Service account authentication is required', dependencies.now);
      return;
    }

    const symbol = String(req.query.symbol ?? '').trim().toUpperCase();
    if (!SYMBOL_PATTERN.test(symbol)) {
      logger.warn('swingSets.invalid_request', { requestId, status: 400 });
      sendPartnerError(res, 400, SwingSetsErrorCode.BAD_REQUEST, 'symbol query parameter is required and must be a valid symbol', dependencies.now);
      return;
    }
    const paramsIdRaw = String(req.query.paramsId ?? '').trim();
    if (paramsIdRaw && !PARAMS_ID_PATTERN.test(paramsIdRaw)) {
      logger.warn('swingSets.invalid_request', { requestId, symbol, status: 400 });
      sendPartnerError(res, 400, SwingSetsErrorCode.BAD_REQUEST, 'paramsId contains invalid characters', dependencies.now);
      return;
    }
    const paramsId = paramsIdRaw || undefined;

    const flags = await dependencies.getTrackedFlags(symbol);
    if (!flags.tracked) {
      logger.warn('swingSets.symbol_not_tracked', { requestId, symbol, status: 404 });
      sendPartnerError(res, 404, SwingSetsErrorCode.NOT_FOUND, `Symbol ${symbol} is not in the tracked_symbols collection.`, dependencies.now);
      return;
    }
    if (!flags.optionsEnabled) {
      logger.warn('swingSets.options_not_enabled', { requestId, symbol, status: 403 });
      sendPartnerError(res, 403, SwingSetsErrorCode.OPTIONS_NOT_ENABLED, `Symbol ${symbol} is not options-enabled.`, dependencies.now);
      return;
    }

    logger.info('swingSets.request', { requestId, symbol, paramsId, requester: authResult.serviceAccountEmail });

    if (paramsId) {
      const doc = await dependencies.getSwingSet(symbol, paramsId);
      if (!doc) {
        logger.warn('swingSets.not_found', { requestId, symbol, paramsId, status: 404 });
        sendPartnerError(res, 404, SwingSetsErrorCode.NOT_FOUND, `No swing set for ${symbol}/${paramsId}.`, dependencies.now);
        return;
      }
      logger.info('swingSets.response', { requestId, symbol, paramsId, docs: 1, status: 200 });
      res.status(200).json({
        ok: true,
        symbol,
        paramsId,
        source: 'sa',
        data: doc,
        timestamp: dependencies.now().toISOString(),
        processingTimeMs: dependencies.now().getTime() - startedAt,
      });
      return;
    }

    const docs = await dependencies.listSwingSets(symbol);
    // Only canonical configs are served — listBySymbol returns every doc for
    // the symbol, so filter to the canonical paramsId set.
    const canonical = docs.filter((d) => CANONICAL_PARAMS_IDS.has(d.paramsId));
    if (canonical.length === 0) {
      // Covers both "enabled, generation hasn't run yet" and "enabled but no
      // daily-adjusted data" — indistinguishable here; the caller retries.
      logger.warn('swingSets.not_found', { requestId, symbol, status: 404 });
      sendPartnerError(res, 404, SwingSetsErrorCode.NOT_FOUND, `No swing sets for ${symbol}.`, dependencies.now);
      return;
    }
    const data = Object.fromEntries(canonical.map((d) => [d.paramsId, d]));
    logger.info('swingSets.response', { requestId, symbol, docs: canonical.length, status: 200 });
    res.status(200).json({
      ok: true,
      symbol,
      source: 'sa',
      data,
      timestamp: dependencies.now().toISOString(),
      processingTimeMs: dependencies.now().getTime() - startedAt,
    });
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    logger.error('swingSets.error', { requestId, error: msg });
    sendPartnerError(res, 500, SwingSetsErrorCode.INTERNAL_ERROR, 'Internal server error', dependencies.now);
  }
}

export const partnerSwingSetsV2 = onRequest(functionOptions, (req, res) =>
  swingSetsPartnerHandler(req, res),
);
