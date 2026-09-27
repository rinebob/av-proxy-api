/**
 * partnerIvMetricsV2 — read-side for computed symbol IV metrics (Topic #158,
 * Task #172). Serves `days` entries from the year-sharded symbol-metrics
 * docs (`symbol-metrics/{SYMBOL}/years/{YYYY}`) written by the Task #171
 * seed-worker hook.
 *
 * GET ?symbol=&from=&to=&metrics=
 *   - symbol:   required, tracked symbol
 *   - from/to:  required YYYY-MM-DD range (inclusive, bounded — year span cap)
 *   - metrics:  optional comma list whitelist-filtered to SYMBOL_METRIC_FIELDS;
 *               unknown names are ignored (lenient), default = all
 *
 * Rows are `{ date, ...requestedFields }` ascending by date across year
 * boundaries. Auth/gating follows the partnerHistoricalOptionsV2 envelope:
 * untracked → 404, optionsEnabled !== true → 403 OPTIONS_NOT_ENABLED.
 */
import { onRequest, type HttpsOptions } from 'firebase-functions/v2/https';
import { randomUUID } from 'node:crypto';
import type { Request, Response } from 'express';

import { HttpMethod } from '@shared/core';
import { FirestoreCollection } from '@shared/firestore';
import { TRACKED_SYMBOL_V2_FIELDS } from '@shared/alpha-vantage';
import {
  SYMBOL_METRIC_FIELDS,
  type IvMetricsRow,
  type SymbolMetricField,
  type SymbolMetricsYearDoc,
} from '@shared/options';

import { db } from '../../firebase-admin-init';
import { authenticateRequestEither, createLogger } from '../utils/utils';
import { allowedServiceAccounts, expectedGoogleAudience } from './partner-handler-base';
import { HistoricalOptionsErrorCode, SYMBOL_PATTERN } from './historical-options-request.utils';
import { parseOptionalDate, toFirstString } from './partner-request.utils';
import { SymbolMetricsRepository } from '../symbol-metrics/services/symbol-metrics.repository';
import type { TrackedSymbolDocReader } from '../historical-options-corpus/services/options-enabled-gate';

const MAX_YEAR_SPAN = 10;
const MAX_RESPONSE_BYTES = 10 * 1024 * 1024; // sibling parity (well under for ~3.6k rows)
const logger = createLogger('[partner-iv-metrics]');

const functionOptions: HttpsOptions = {
  memory: '256MiB',
  maxInstances: 10,
  timeoutSeconds: 60,
  secrets: [allowedServiceAccounts, expectedGoogleAudience],
};

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

export interface IvMetricsPartnerDependencies {
  authenticateRequest: typeof authenticateRequestEither;
  hasExpectedGoogleAudience: () => boolean;
  /** Tracked-symbol doc read — gates 404 (untracked) vs OPTIONS_NOT_ENABLED. */
  readTrackedSymbolDoc: TrackedSymbolDocReader;
  /** Year-shard read — SymbolMetricsRepository.readYear in prod. */
  readYear: (symbol: string, year: string | number) => Promise<SymbolMetricsYearDoc | null>;
  now: () => Date;
}

const defaultReadTrackedSymbolDoc: TrackedSymbolDocReader = async (symbol) => {
  const doc = await db.collection(FirestoreCollection.TRACKED_SYMBOLS).doc(symbol).get();
  return doc.exists ? doc.data() : undefined;
};

const ivMetricsPartnerDependencies: IvMetricsPartnerDependencies = {
  authenticateRequest: authenticateRequestEither,
  hasExpectedGoogleAudience: () => expectedGoogleAudience.value().split(',').some((value) => Boolean(value.trim())),
  readTrackedSymbolDoc: defaultReadTrackedSymbolDoc,
  readYear: (symbol, year) => new SymbolMetricsRepository(db).readYear(symbol, year),
  now: () => new Date(),
};

/** Whitelist-parse `metrics=` — unknown names ignored (lenient forward
 *  compat: new metric fields added later don't break older clients). */
function parseMetricsParam(value: unknown): SymbolMetricField[] | null {
  const raw = toFirstString(value);
  if (!raw) return [...SYMBOL_METRIC_FIELDS];
  const known = new Set<string>(SYMBOL_METRIC_FIELDS);
  const fields = raw.split(',').map((f) => f.trim()).filter((f) => known.has(f)) as SymbolMetricField[];
  return fields.length > 0 ? fields : null;
}

export async function partnerIvMetricsHandler(
  req: Request,
  res: Response,
  dependencies: IvMetricsPartnerDependencies = ivMetricsPartnerDependencies,
): Promise<void> {
  const startedAt = dependencies.now().getTime();
  const requestId = randomUUID();

  try {
    if (req.method !== HttpMethod.GET) {
      logger.warn('ivMetrics.method_not_allowed', { requestId, method: req.method, status: 405 });
      sendPartnerError(res, 405, HistoricalOptionsErrorCode.METHOD_NOT_ALLOWED, 'Method Not Allowed', dependencies.now);
      return;
    }

    if (!dependencies.hasExpectedGoogleAudience()) {
      logger.error('ivMetrics.audience_not_configured', { requestId, status: 500 });
      sendPartnerError(res, 500, HistoricalOptionsErrorCode.INTERNAL_ERROR, 'Internal server error', dependencies.now);
      return;
    }

    const authResult = await dependencies.authenticateRequest(req, res);
    if (!authResult) {
      logger.warn('ivMetrics.auth_rejected', { requestId, status: res.statusCode });
      return;
    }

    if (!('serviceAccountEmail' in authResult)) {
      logger.warn('ivMetrics.auth_rejected', { requestId, status: 403 });
      sendPartnerError(res, 403, HistoricalOptionsErrorCode.FORBIDDEN, 'Service account authentication is required', dependencies.now);
      return;
    }

    const symbol = toFirstString(req.query.symbol).toUpperCase();
    const from = parseOptionalDate(req.query.from);
    const to = parseOptionalDate(req.query.to);
    if (!symbol || !SYMBOL_PATTERN.test(symbol) || !from || !to || from > to) {
      logger.warn('ivMetrics.invalid_request', { requestId, status: 400 });
      sendPartnerError(res, 400, HistoricalOptionsErrorCode.BAD_REQUEST,
        'Invalid request. Provide symbol, from, and to (YYYY-MM-DD, from <= to).', dependencies.now);
      return;
    }
    if (Number(to.slice(0, 4)) - Number(from.slice(0, 4)) + 1 > MAX_YEAR_SPAN) {
      logger.warn('ivMetrics.invalid_request', { requestId, symbol, from, to, status: 400 });
      sendPartnerError(res, 400, HistoricalOptionsErrorCode.BAD_REQUEST,
        `Range spans more than ${MAX_YEAR_SPAN} years — narrow the range.`, dependencies.now);
      return;
    }

    const metrics = parseMetricsParam(req.query.metrics);
    if (!metrics) {
      logger.warn('ivMetrics.invalid_request', { requestId, symbol, metrics: req.query.metrics, status: 400 });
      sendPartnerError(res, 400, HistoricalOptionsErrorCode.BAD_REQUEST,
        `metrics= accepts only: ${SYMBOL_METRIC_FIELDS.join(', ')}.`, dependencies.now);
      return;
    }

    const doc = await dependencies.readTrackedSymbolDoc(symbol);
    if (!doc) {
      logger.warn('ivMetrics.symbol_not_tracked', { requestId, symbol, status: 404 });
      sendPartnerError(res, 404, HistoricalOptionsErrorCode.NOT_FOUND,
        `Symbol ${symbol} is not in the tracked_symbols collection.`, dependencies.now);
      return;
    }
    if (doc[TRACKED_SYMBOL_V2_FIELDS.OPTIONS_ENABLED] !== true) {
      logger.warn('ivMetrics.options_not_enabled', { requestId, symbol, status: 403 });
      sendPartnerError(res, 403, HistoricalOptionsErrorCode.OPTIONS_NOT_ENABLED,
        `Options metrics are not enabled for ${symbol}.`, dependencies.now);
      return;
    }

    const startYear = Number(from.slice(0, 4));
    const endYear = Number(to.slice(0, 4));
    const yearDocs = await Promise.all(
      Array.from({ length: endYear - startYear + 1 }, (_, i) =>
        dependencies.readYear(symbol, startYear + i)),
    );

    const rows: IvMetricsRow[] = [];
    for (const yearDoc of yearDocs) {
      if (!yearDoc?.days) continue;
      for (const [date, entry] of Object.entries(yearDoc.days)) {
        if (date < from || date > to) continue;
        // Corrupt entries (null/non-object) skipped rather than failing the read.
        if (typeof entry !== 'object' || entry === null) continue;
        const row: IvMetricsRow = { date };
        const out = row as Record<string, unknown>;
        for (const field of metrics) {
          const v = entry[field];
          if (v !== undefined) out[field] = v;
        }
        rows.push(row);
      }
    }
    rows.sort((a, b) => a.date.localeCompare(b.date));

    const response = {
      ok: true,
      symbol,
      from,
      to,
      metrics,
      rows,
      timestamp: dependencies.now().toISOString(),
      processingTimeMs: dependencies.now().getTime() - startedAt,
    };
    const responseBytes = Buffer.byteLength(JSON.stringify(response), 'utf8');
    if (responseBytes > MAX_RESPONSE_BYTES) {
      logger.warn('ivMetrics.response_too_large', { requestId, symbol, responseBytes, status: 413 });
      sendPartnerError(res, 413, HistoricalOptionsErrorCode.RESPONSE_TOO_LARGE, 'IV metrics response exceeds the supported response size', dependencies.now);
      return;
    }
    logger.info('ivMetrics.response', {
      requestId, symbol, from, to, rows: rows.length, responseBytes,
      processingTimeMs: response.processingTimeMs,
    });
    res.status(200).json(response);
  } catch (error) {
    const message = error instanceof Error ? error.message : HistoricalOptionsErrorCode.INTERNAL_ERROR;
    logger.error('ivMetrics.error', {
      requestId, error: message, status: 500,
      processingTimeMs: dependencies.now().getTime() - startedAt,
    });
    sendPartnerError(res, 500, HistoricalOptionsErrorCode.INTERNAL_ERROR, 'Internal server error', dependencies.now);
  }
}

export const partnerIvMetricsV2 = onRequest(functionOptions, partnerIvMetricsHandler);
