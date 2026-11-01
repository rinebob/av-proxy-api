/**
 * partnerIvRankV2 — cross-symbol IV-rank screener table (Topic #158,
 * Thread #163, Task #189). Reads `iv-rank-latest/{SYMBOL}` — one flat doc
 * per enabled symbol, rewritten by the seed-worker rank pass and deleted on
 * `optionsEnabled` false-transition — so membership IS the enabled gate.
 *
 * GET ?sort=&dir=&minN=
 *   - sort:  optional whitelist of ivRank{W}/ivPct{W}/ivN{W} (W = 30/60/180/360);
 *            default = symbol ascending. Unknown names → 400 (strict here —
 *            a misspelled sort would silently return an unsorted table).
 *   - dir:   'asc' | 'desc' (default 'desc' — high-rank first, the screener's
 *            typical use). Rows missing the sort field fall to the bottom.
 *   - minN:  optional integer sample-count floor applied to the sort field's
 *            n-window (ivRank60 → ivN60); falls back to ivN360 when sort is
 *            unset — immature rows stay visible by default but are excludable.
 *
 * Auth/gating mirrors partnerIvMetricsV2: dual token auth + service-account
 * allowlist, same error envelope.
 */
import { onRequest, type HttpsOptions } from 'firebase-functions/v2/https';
import { randomUUID } from 'node:crypto';
import type { Request, Response } from 'express';

import { HttpMethod } from '@shared/core';
import { IV_RANK_LATEST_COLLECTION, type IvRankLatestDoc } from '@shared/options';

import { db } from '../../firebase-admin-init';
import { authenticateRequestEither, createLogger } from '../utils/utils';
import { allowedServiceAccounts, expectedGoogleAudience } from './partner-handler-base';
import { HistoricalOptionsErrorCode } from './historical-options-request.utils';
import { toFirstString } from './partner-request.utils';

const logger = createLogger('[partner-iv-rank]');

const RANK_FIELD_RE = /^iv(Rank|Pct|N)(30|60|180|360)$/;

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

export interface IvRankPartnerDependencies {
  authenticateRequest: typeof authenticateRequestEither;
  hasExpectedGoogleAudience: () => boolean;
  /** Single collection scan — IvRankLatestRepository listing in prod. */
  listLatest: () => Promise<IvRankLatestDoc[]>;
  now: () => Date;
}

const ivRankPartnerDependencies: IvRankPartnerDependencies = {
  authenticateRequest: authenticateRequestEither,
  hasExpectedGoogleAudience: () => expectedGoogleAudience.value().split(',').some((value) => Boolean(value.trim())),
  listLatest: async () => {
    const snap = await db.collection(IV_RANK_LATEST_COLLECTION).get();
    return snap.docs.map((d) => d.data() as IvRankLatestDoc);
  },
  now: () => new Date(),
};

export async function partnerIvRankHandler(
  req: Request,
  res: Response,
  dependencies: IvRankPartnerDependencies = ivRankPartnerDependencies,
): Promise<void> {
  const startedAt = dependencies.now().getTime();
  const requestId = randomUUID();

  try {
    if (req.method !== HttpMethod.GET) {
      logger.warn('ivRank.method_not_allowed', { requestId, method: req.method, status: 405 });
      sendPartnerError(res, 405, HistoricalOptionsErrorCode.METHOD_NOT_ALLOWED, 'Method Not Allowed', dependencies.now);
      return;
    }

    if (!dependencies.hasExpectedGoogleAudience()) {
      logger.error('ivRank.audience_not_configured', { requestId, status: 500 });
      sendPartnerError(res, 500, HistoricalOptionsErrorCode.INTERNAL_ERROR, 'Internal server error', dependencies.now);
      return;
    }

    const authResult = await dependencies.authenticateRequest(req, res);
    if (!authResult) {
      logger.warn('ivRank.auth_rejected', { requestId, status: res.statusCode });
      return;
    }

    if (!('serviceAccountEmail' in authResult)) {
      logger.warn('ivRank.auth_rejected', { requestId, status: 403 });
      sendPartnerError(res, 403, HistoricalOptionsErrorCode.FORBIDDEN, 'Service account authentication is required', dependencies.now);
      return;
    }

    // sort= — strict whitelist; dir= asc|desc.
    const sort = toFirstString(req.query.sort);
    if (sort && !RANK_FIELD_RE.test(sort)) {
      sendPartnerError(res, 400, HistoricalOptionsErrorCode.BAD_REQUEST,
        'sort= accepts only rank fields: ivRank{30|60|180|360}, ivPct{...}, ivN{...}.', dependencies.now);
      return;
    }
    const dirRaw = toFirstString(req.query.dir);
    if (dirRaw && dirRaw !== 'asc' && dirRaw !== 'desc') {
      sendPartnerError(res, 400, HistoricalOptionsErrorCode.BAD_REQUEST, "dir must be 'asc' or 'desc'.", dependencies.now);
      return;
    }
    const dir: 'asc' | 'desc' = dirRaw === 'asc' ? 'asc' : 'desc';

    // minN= — integer floor on the sort window's n (ivN360 fallback).
    const minNRaw = toFirstString(req.query.minN);
    const minN = minNRaw ? Number(minNRaw) : 0;
    if (!Number.isInteger(minN) || minN < 0) {
      sendPartnerError(res, 400, HistoricalOptionsErrorCode.BAD_REQUEST, 'minN must be a non-negative integer.', dependencies.now);
      return;
    }

    const docs = await dependencies.listLatest();

    const nField = sort
      ? (`ivN${sort.match(/\d+$/)![0]}` as keyof IvRankLatestDoc)
      : 'ivN360';
    // Serialize updatedAt to ISO — a raw TimestampLike leaks Firestore's
    // {_seconds,_nanoseconds} SDK shape onto the wire (sibling endpoints
    // emit ISO-8601 or null).
    const toIso = (ts: IvRankLatestDoc['updatedAt']): string | null =>
      ts && Number.isFinite(ts.seconds) ? new Date(ts.seconds * 1000).toISOString() : null;
    const rows = docs
      .filter((d) => minN === 0 || (Number(d[nField]) || 0) >= minN)
      .sort((a, b) => {
        if (!sort) return a.symbol.localeCompare(b.symbol);
        const av = Number(a[sort as keyof IvRankLatestDoc]);
        const bv = Number(b[sort as keyof IvRankLatestDoc]);
        const aBad = !Number.isFinite(av), bBad = !Number.isFinite(bv);
        if (aBad && bBad) return a.symbol.localeCompare(b.symbol);
        if (aBad) return 1; // missing sort field sinks to the bottom, either dir
        if (bBad) return -1;
        return dir === 'asc' ? av - bv : bv - av;
      })
      .map((d) => ({ ...d, updatedAt: toIso(d.updatedAt) }));

    const response = {
      ok: true,
      count: rows.length,
      sort: sort || 'symbol',
      dir,
      minN,
      rows,
      timestamp: dependencies.now().toISOString(),
      processingTimeMs: dependencies.now().getTime() - startedAt,
    };
    logger.info('ivRank.response', { requestId, rows: rows.length, sort, dir, minN });
    res.status(200).json(response);
  } catch (error) {
    const message = error instanceof Error ? error.message : HistoricalOptionsErrorCode.INTERNAL_ERROR;
    logger.error('ivRank.error', { requestId, error: message, status: 500 });
    sendPartnerError(res, 500, HistoricalOptionsErrorCode.INTERNAL_ERROR, 'Internal server error', dependencies.now);
  }
}

export const partnerIvRankV2 = onRequest(functionOptions, partnerIvRankHandler);
