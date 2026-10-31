import { randomUUID } from 'node:crypto';

import { onRequest, type HttpsOptions } from 'firebase-functions/v2/https';
import { getStorage } from 'firebase-admin/storage';
import type { Request, Response } from 'express';

import { ContractAvailabilityQueryService } from '../historical-options-corpus/services/contract-availability-query.service';
import { CorpusDatesService } from '../historical-options-corpus/services/corpus-dates.service';
import { optionsCorpusBucket } from '../historical-options-corpus/types';
import { authenticateRequestEither, createLogger, db } from '../utils/utils';
import { HistoricalOptionsErrorCode } from './historical-options-request.utils';
import { parseContractAvailabilityQuery } from './contract-availability-request.utils';
import {
  allowedServiceAccounts,
  expectedGoogleAudience,
} from './partner-handler-base';
import { createOptionsEnabledChecker } from '../historical-options-corpus/services/options-enabled-gate';

import type {
  ContractAvailabilityErrorResponse,
  ContractAvailabilityResponse,
  ContractCatalogEntry,
} from '@shared/options';

const logger = createLogger('[partner-contract-availability]');

const functionOptions: HttpsOptions = {
  memory: '512MiB',
  maxInstances: 20,
  timeoutSeconds: 60,
  secrets: [allowedServiceAccounts, expectedGoogleAudience],
};

export interface PartnerContractAvailabilityDependencies {
  authenticateRequest: typeof authenticateRequestEither;
  now: () => Date;
  /** Override for testing. Defaults to `new ContractAvailabilityQueryService(db)`. */
  queryServiceFactory?: () => ContractAvailabilityQueryService;
  /** Override for testing. Defaults to a `CorpusDatesService` over the corpus bucket. */
  datesServiceFactory?: () => CorpusDatesService;
  /** Override for testing. Defaults to the Firestore optionsEnabled gate. */
  isOptionsEnabled?: (symbol: string) => Promise<boolean>;
}

const defaultDependencies: PartnerContractAvailabilityDependencies = {
  authenticateRequest: authenticateRequestEither,
  now: () => new Date(),
};

function errorResponse(
  code: HistoricalOptionsErrorCode,
  message: string,
  timestamp: string,
): ContractAvailabilityErrorResponse {
  return { ok: false, error: message, code, timestamp };
}

/**
 * HTTPS handler for `partnerContractAvailabilityV1`.
 *
 * One GET returning both the filtered `ts-contracts` catalog entries and the
 * symbol's corpus-object dates — a discovery endpoint for "which contracts
 * and which days actually have time-series data". Auth, gate, and error
 * envelope are identical to `partnerContractCatalogV2`; param parsing lives
 * in `contract-availability-request.utils` (#243).
 */
export async function partnerContractAvailabilityHandler(
  req: Request,
  res: Response,
  dependencies: PartnerContractAvailabilityDependencies = defaultDependencies,
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
      logger.warn('partnerContractAvailability.forbidden', { requestId, status: 403 });
      res.status(403).json(errorResponse(
        HistoricalOptionsErrorCode.FORBIDDEN,
        'Service account authentication is required',
        dependencies.now().toISOString(),
      ));
      return;
    }

    const parsed = parseContractAvailabilityQuery(req.query);
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
      logger.warn('partnerContractAvailability.symbol_not_enabled', { requestId, symbol: params.symbol });
      res.status(404).json(errorResponse(
        HistoricalOptionsErrorCode.OPTIONS_NOT_ENABLED,
        `Symbol ${params.symbol} is not supported (optionsEnabled not set)`,
        dependencies.now().toISOString(),
      ));
      return;
    }

    logger.info('partnerContractAvailability.request', {
      requestId,
      requester: authResult.serviceAccountEmail,
      symbol: params.symbol,
      expirations: params.expirations?.length ?? 'none',
      type: params.type ?? 'none',
    });

    const queryService = (dependencies.queryServiceFactory
      ?? (() => new ContractAvailabilityQueryService(db)))();
    const datesService = (dependencies.datesServiceFactory
      ?? (() => new CorpusDatesService(getStorage().bucket(optionsCorpusBucket()))))();

    const [availability, corpusDates] = await Promise.all([
      queryService.queryAvailability(params),
      datesService.listCorpusDates(params.symbol),
    ]);

    const response: ContractAvailabilityResponse = {
      ok: true,
      symbol: params.symbol,
      // Defensive strip mirroring V2 — the query service already strips
      // `lastUpdated`, but the handler owns the response contract.
      contracts: availability.contracts.map(
        ({ lastUpdated: _lastUpdated, ...entry }: ContractCatalogEntry & { lastUpdated?: string }) => entry,
      ),
      count: availability.contracts.length,
      truncated: availability.truncated,
      corpusDates,
      corpusDateCount: corpusDates.length,
    };

    logger.info('partnerContractAvailability.response', {
      requestId,
      symbol: params.symbol,
      count: availability.contracts.length,
      truncated: availability.truncated,
      corpusDateCount: corpusDates.length,
      processingTimeMs: dependencies.now().getTime() - startedAt,
    });

    res.status(200).json(response);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    logger.error('partnerContractAvailability.error', {
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

export const partnerContractAvailabilityV1 = onRequest(
  functionOptions,
  partnerContractAvailabilityHandler,
);

