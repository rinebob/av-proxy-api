import { randomUUID } from 'node:crypto';

import { onRequest, type HttpsOptions } from 'firebase-functions/v2/https';
import type { Request, Response } from 'express';

import {
  buildCellId,
  cellYearDocPath,
  type CellYearDoc,
  type DeltaPicksCellYearResponse,
  type DeltaPicksErrorResponse,
} from '@shared/options';

import { authenticateRequestEither, createLogger, db } from '../utils/utils';
import { createOptionsEnabledChecker } from '../historical-options-corpus/services/options-enabled-gate';
import { HistoricalOptionsErrorCode } from './historical-options-request.utils';
import { parseDeltaPicksQuery } from './options-delta-picks-request.utils';
import {
  allowedServiceAccounts,
  expectedGoogleAudience,
} from './partner-handler-base';

const logger = createLogger('[partner-options-delta-picks]');

const functionOptions: HttpsOptions = {
  memory: '256MiB',
  maxInstances: 20,
  timeoutSeconds: 30,
  secrets: [allowedServiceAccounts, expectedGoogleAudience],
};

export interface PartnerDeltaPicksDependencies {
  authenticateRequest: typeof authenticateRequestEither;
  now: () => Date;
  /** Override for testing. Defaults to the Firestore optionsEnabled gate. */
  isOptionsEnabled?: (symbol: string) => Promise<boolean>;
  /** Override for testing. Defaults to reading the cell-year doc from Firestore. */
  readCellYearDoc?: (cellId: string, year: number) => Promise<CellYearDoc | undefined>;
}

const defaultDependencies: PartnerDeltaPicksDependencies = {
  authenticateRequest: authenticateRequestEither,
  now: () => new Date(),
};

function errorResponse(
  code: HistoricalOptionsErrorCode,
  message: string,
  timestamp: string,
): DeltaPicksErrorResponse {
  return { ok: false, error: message, code, timestamp };
}

/** Firestore Timestamp or TimestampLike → ISO-8601; null when absent. */
function serializeUpdatedAt(updatedAt: CellYearDoc['updatedAt'] | undefined): string | null {
  if (updatedAt == null) return null;
  const maybeTimestamp = updatedAt as { toDate?: () => Date; seconds?: number };
  if (typeof maybeTimestamp.toDate === 'function') return maybeTimestamp.toDate().toISOString();
  if (typeof maybeTimestamp.seconds === 'number') return new Date(maybeTimestamp.seconds * 1000).toISOString();
  return null;
}

const defaultReadCellYearDoc = async (cellId: string, year: number): Promise<CellYearDoc | undefined> => {
  const snap = await db.doc(cellYearDocPath(cellId, year)).get();
  return snap.exists ? (snap.data() as CellYearDoc) : undefined;
};

/**
 * HTTPS handler for `partnerOptionsDeltaPicksV1` (Task #225).
 *
 * One GET returning the year-sharded delta-pick cell doc —
 * `options-delta-picks/{SYM}-{type}-{deltaPct}-{dte}/years/{YYYY}` — the unit
 * a backtest reads (a full year of daily picks per call). Params are
 * validated against PICK_GRID so off-grid delta/DTE requests fail fast with
 * a 400 naming the component; auth, gate, and error envelope mirror
 * `partnerContractAvailabilityV1`.
 */
export async function partnerOptionsDeltaPicksHandler(
  req: Request,
  res: Response,
  dependencies: PartnerDeltaPicksDependencies = defaultDependencies,
): Promise<void> {
  const startedAt = dependencies.now().getTime();
  const requestId = randomUUID();

  try {
    if (req.method !== 'GET') {
      res.status(405).json(errorResponse(
        HistoricalOptionsErrorCode.METHOD_NOT_ALLOWED,
        'Method Not Allowed',
        dependencies.now().toISOString(),
      ));
      return;
    }

    const authResult = await dependencies.authenticateRequest(req, res);
    if (!authResult) return;

    if (!('serviceAccountEmail' in authResult)) {
      logger.warn('partnerOptionsDeltaPicks.forbidden', { requestId, status: 403 });
      res.status(403).json(errorResponse(
        HistoricalOptionsErrorCode.FORBIDDEN,
        'Service account authentication is required',
        dependencies.now().toISOString(),
      ));
      return;
    }

    const parsed = parseDeltaPicksQuery(req.query);
    if (!parsed.ok) {
      res.status(400).json(errorResponse(
        HistoricalOptionsErrorCode.BAD_REQUEST,
        parsed.error,
        dependencies.now().toISOString(),
      ));
      return;
    }
    const { params } = parsed;

    // Task #150 gate — the served universe is exactly the curated
    // options-enabled set (404 per this endpoint's contract).
    const isOptionsEnabled = dependencies.isOptionsEnabled ?? createOptionsEnabledChecker();
    if (!(await isOptionsEnabled(params.symbol))) {
      logger.warn('partnerOptionsDeltaPicks.symbol_not_enabled', { requestId, symbol: params.symbol });
      res.status(404).json(errorResponse(
        HistoricalOptionsErrorCode.OPTIONS_NOT_ENABLED,
        `Symbol ${params.symbol} is not supported (optionsEnabled not set)`,
        dependencies.now().toISOString(),
      ));
      return;
    }

    const cellId = buildCellId(params.symbol, params.type, params.deltaPct, params.dte);

    logger.info('partnerOptionsDeltaPicks.request', {
      requestId,
      requester: authResult.serviceAccountEmail,
      cellId,
      year: params.year,
    });

    const readCellYearDoc = dependencies.readCellYearDoc ?? defaultReadCellYearDoc;
    const doc = await readCellYearDoc(cellId, params.year);

    if (!doc) {
      res.status(404).json(errorResponse(
        HistoricalOptionsErrorCode.NOT_FOUND,
        `No pick doc for ${cellId} year ${params.year}`,
        dependencies.now().toISOString(),
      ));
      return;
    }

    // Explicit field list — the handler owns the response contract; stored
    // fields the wire type doesn't declare never reach the partner.
    const response: DeltaPicksCellYearResponse = {
      ok: true,
      symbol: doc.symbol,
      type: doc.type,
      targetDelta: doc.targetDelta,
      expiry: doc.expiry,
      gridVersion: doc.gridVersion,
      firstDate: doc.firstDate,
      lastDate: doc.lastDate,
      pickCount: doc.pickCount,
      missCount: doc.missCount,
      days: doc.days,
      updatedAt: serializeUpdatedAt(doc.updatedAt),
    };

    logger.info('partnerOptionsDeltaPicks.response', {
      requestId,
      cellId,
      year: params.year,
      pickCount: doc.pickCount,
      missCount: doc.missCount,
      processingTimeMs: dependencies.now().getTime() - startedAt,
    });

    res.status(200).json(response);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    logger.error('partnerOptionsDeltaPicks.error', {
      requestId,
      error: message,
      status: 500,
      processingTimeMs: dependencies.now().getTime() - startedAt,
    });
    res.status(500).json(errorResponse(
      HistoricalOptionsErrorCode.INTERNAL_ERROR,
      'Internal server error',
      dependencies.now().toISOString(),
    ));
  }
}

export const partnerOptionsDeltaPicksV1 = onRequest(
  functionOptions,
  partnerOptionsDeltaPicksHandler,
);
