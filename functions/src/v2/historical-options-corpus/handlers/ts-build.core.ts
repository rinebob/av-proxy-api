import type { TimeSeriesBuildReport } from '../services/time-series-builder.service';
import { OPTIONS_CORPUS_FLOOR_DATE } from '../types';
import type { TsBuildPayload } from './ts-build.task';

/**
 * Testable seam for the ts-build Cloud Task body (Task #152). The
 * `onTaskDispatched` wrapper stays thin in ts-build.task.ts; this core is
 * side-effect-free and takes injected deps so no firebase-admin/GCS init
 * happens in jest.
 */
export interface TsBuildDeps {
  /** Curation gate (Task #150): disabled symbols never build time series. */
  isOptionsEnabled: (symbol: string) => Promise<boolean>;
  /** Builder call — (symbol, startDate, endDate, opts). */
  buildSymbol: (
    symbol: string,
    startDate: string,
    endDate: string,
    options?: { deadlineMs?: number },
  ) => Promise<TimeSeriesBuildReport>;
  /**
   * Per-symbol mutual exclusion. Returns false when another task holds the
   * symbol's lease — the payload is re-enqueued with a delay rather than
   * racing on the same contract JSONL files.
   */
  acquireLease?: (symbol: string) => Promise<boolean>;
  releaseLease?: (symbol: string) => Promise<void>;
  /** Enqueue a follow-up task (continuation or deferred retry). */
  enqueueTask?: (payload: TsBuildPayload, delaySeconds?: number) => Promise<void>;
  logger: (message: string, meta?: Record<string, unknown>) => void;
  warn?: (message: string, meta?: Record<string, unknown>) => void;
  error?: (message: string, meta?: Record<string, unknown>) => void;
}

/** Soft budget inside the 1200s function timeout — leaves margin to flush + re-enqueue. */
const TASK_BUDGET_MS = 15 * 60 * 1000;
const LEASE_DEFER_SECONDS = 300;

export async function handleTsBuildTask(
  payload: TsBuildPayload,
  deps: TsBuildDeps,
): Promise<void> {
  const { symbol } = payload;
  const startDate = payload.startDate ?? payload.date;
  const endDate = payload.endDate ?? payload.date;

  if (!startDate || !endDate) {
    (deps.error ?? deps.logger)('invalid payload — no date or range', { symbol });
    return;
  }

  if (endDate < OPTIONS_CORPUS_FLOOR_DATE) {
    deps.logger('skip pre-floor', { symbol, startDate, endDate, floor: OPTIONS_CORPUS_FLOOR_DATE });
    return;
  }
  const clampedStart = startDate < OPTIONS_CORPUS_FLOOR_DATE ? OPTIONS_CORPUS_FLOOR_DATE : startDate;

  deps.logger('start', { symbol, startDate: clampedStart, endDate });

  if (!(await deps.isOptionsEnabled(symbol))) {
    deps.logger('skip options-disabled', { symbol });
    return;
  }

  if (deps.acquireLease) {
    const acquired = await deps.acquireLease(symbol);
    if (!acquired) {
      deps.logger('lease busy — deferred', { symbol, startDate, endDate, delaySeconds: LEASE_DEFER_SECONDS });
      await deps.enqueueTask?.(payload, LEASE_DEFER_SECONDS);
      return;
    }
  }

  try {
    const report = await deps.buildSymbol(symbol, clampedStart, endDate, {
      deadlineMs: Date.now() + TASK_BUDGET_MS,
    });
    deps.logger('done', {
      symbol: report.symbol,
      foundDates: report.foundDates,
      missingDates: report.missingDates,
      processedContracts: report.processedContracts,
      failedContracts: report.failedContracts,
      resumeDate: report.resumeDate,
    });

    if (report.resumeDate) {
      deps.logger('continue', { symbol, resumeDate: report.resumeDate, endDate });
      await deps.enqueueTask?.({ symbol, startDate: report.resumeDate, endDate });
    }

    if (report.missingDates > 0) {
      (deps.warn ?? deps.logger)('missing dates — corpus may not be ready', {
        symbol,
        startDate: clampedStart,
        endDate,
        missingDates: report.missingDates,
      });
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    (deps.error ?? deps.logger)('failed', { symbol, startDate, endDate, error: message });
    throw err;
  } finally {
    await deps.releaseLease?.(symbol);
  }
}
