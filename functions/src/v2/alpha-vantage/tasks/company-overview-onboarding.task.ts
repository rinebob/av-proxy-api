import { onTaskDispatched } from 'firebase-functions/v2/tasks';
import { getFunctions } from 'firebase-admin/functions';

import { db, FieldValue } from '../../../firebase-admin-init';
import {
  AlphaVantageEndpoint,
  TRACKED_SYMBOL_V2_FIELDS,
  TrackedSymbolOnboardingStatus,
} from '@shared/alpha-vantage';
import { FirestoreCollection } from '@shared/firestore';

import { CloudTask } from '../../common/constants';
import { CLOUD_TASKS_RATE_LIMITS } from '../jobs/job-config';
import { AlphaVantageHandlerFactory } from '../alpha-vantage-factory';
import { HealthMetricsService } from '../../health-metrics/health-metrics.service';
import { RefreshStatus, RefreshTrigger } from '@shared/firestore';
import { publishSymbolAddedBatch } from '../../partner/symbol-added.publisher';
import { AVAILABLE_INTERVALS } from '../../partner/schemas/symbol-added.schema';
import { betterLogger, type BetterLogPayload } from '../../utils/utils';

const logger = betterLogger('av.companyOverviewOnboarding');

/**
 * Maximum number of times we will manually re-enqueue an overview retry
 * before giving up and marking the symbol as failed.
 */
const MAX_OVERVIEW_ONBOARDING_ATTEMPTS = 5;

export interface CompanyOverviewOnboardingPayload {
  symbol: string;
  /** 1-based attempt counter used to bound retries. */
  attempt: number;
}

async function publishReadyNotification(symbol: string): Promise<void> {
  const payload = {
    version: 'v1' as const,
    symbols: [symbol],
    addedAtUTC: new Date().toISOString(),
    status: 'ready' as const,
    availableIntervals: AVAILABLE_INTERVALS,
    companyInfoAvailable: true,
  };

  await publishSymbolAddedBatch(payload, { symbol });
}

/**
 * Cloud Task worker that retries fetching Company Overview for a newly tracked
 * equity symbol after D/W/M time-series are already in place.
 *
 * On success it marks the symbol as `ready` and publishes `partner-symbol-added`.
 * On failure it re-enqueues itself with an incremented attempt counter until the
 * maximum number of attempts is reached, at which point it marks the symbol as
 * `onboarding_failed`.
 */
export const processCompanyOverviewOnboardingTask = onTaskDispatched<CompanyOverviewOnboardingPayload>(
  {
    retryConfig: { maxAttempts: 1 },
    rateLimits: CLOUD_TASKS_RATE_LIMITS,
    memory: '512MiB',
    secrets: ['ALPHAVANTAGE_API_KEY'],
  },
  async (req) => {
    const { symbol, attempt = 1 } = req.data;
    const symbolUpper = symbol.toUpperCase();
    const trackedRef = db.collection(FirestoreCollection.TRACKED_SYMBOLS).doc(symbolUpper);

    const baseLog: BetterLogPayload = {
      function: 'pCOOT',
      symbol: symbolUpper,
      endpoint: AlphaVantageEndpoint.OVERVIEW,
    };

    logger.info('companyOverviewOnboarding.start', { ...baseLog, attempt } as BetterLogPayload);

    // Idempotency: do not reprocess if the symbol is already ready.
    const currentDoc = await trackedRef.get();
    const currentData = currentDoc.data();
    if (currentData?.[TRACKED_SYMBOL_V2_FIELDS.ONBOARDING_STATUS] === TrackedSymbolOnboardingStatus.READY) {
      logger.info('companyOverviewOnboarding.already_ready', { ...baseLog, attempt } as BetterLogPayload);
      return;
    }

    const hms = new HealthMetricsService();
    const startedAt = Date.now();

    try {
      const handler = AlphaVantageHandlerFactory.createHandler(AlphaVantageEndpoint.OVERVIEW);
      const response = await handler.fetch({ symbol: symbolUpper, datatype: 'json' });
      const hasData = response?.data && Object.keys(response.data).length > 0;

      await hms.recordSymbolRefresh(
        AlphaVantageEndpoint.OVERVIEW,
        symbolUpper,
        hasData ? RefreshStatus.SUCCESS : RefreshStatus.FAILURE,
        Date.now() - startedAt,
        hasData ? undefined : 'Empty company overview response',
        { trigger: RefreshTrigger.SYMBOL_ADDED }
      );

      if (!hasData) {
        throw new Error(`Company Overview returned no data for ${symbolUpper}`);
      }

      await trackedRef.set(
        {
          [TRACKED_SYMBOL_V2_FIELDS.ONBOARDING_STATUS]: TrackedSymbolOnboardingStatus.READY,
          [TRACKED_SYMBOL_V2_FIELDS.READY_AT]: FieldValue.serverTimestamp(),
        },
        { merge: true }
      );

      await publishReadyNotification(symbolUpper);

      logger.info('companyOverviewOnboarding.success', baseLog);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error('companyOverviewOnboarding.error', { ...baseLog, attempt, error: errorMessage } as BetterLogPayload);

      if (attempt >= MAX_OVERVIEW_ONBOARDING_ATTEMPTS) {
        await trackedRef.set(
          {
            [TRACKED_SYMBOL_V2_FIELDS.ONBOARDING_STATUS]: TrackedSymbolOnboardingStatus.ONBOARDING_FAILED,
            [TRACKED_SYMBOL_V2_FIELDS.ONBOARDING_FAILED_AT]: FieldValue.serverTimestamp(),
            [TRACKED_SYMBOL_V2_FIELDS.ONBOARDING_FAILURE_REASON]: errorMessage,
          },
          { merge: true }
        );
        logger.error('companyOverviewOnboarding.max_attempts_reached', { ...baseLog, attempt } as BetterLogPayload);
        return;
      }

      try {
        const queue = getFunctions().taskQueue(CloudTask.FETCH_COMPANY_OVERVIEW_ONBOARDING);
        await queue.enqueue({ symbol: symbolUpper, attempt: attempt + 1 });
        logger.info('companyOverviewOnboarding.retry_enqueued', { ...baseLog, nextAttempt: attempt + 1 } as BetterLogPayload);
      } catch (enqueueErr) {
        const enqueueErrMessage = enqueueErr instanceof Error ? enqueueErr.message : String(enqueueErr);
        logger.error('companyOverviewOnboarding.retry_enqueue_failed', { ...baseLog, attempt, error: enqueueErrMessage } as BetterLogPayload);
        // Surface the failure so Cloud Tasks can retry the whole task, giving us
        // another chance to enqueue the next attempt.
        throw enqueueErr;
      }
    }
  }
);
