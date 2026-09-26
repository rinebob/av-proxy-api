import type { TimeSeriesBuildReport } from '../services/time-series-builder.service';

/**
 * Testable seam for the ts-build Cloud Task body (Task #152). The
 * `onTaskDispatched` wrapper stays thin in ts-build.task.ts; this core is
 * side-effect-free and takes injected deps so no firebase-admin/GCS init
 * happens in jest.
 */
export interface TsBuildDeps {
  /** Curation gate (Task #150): disabled symbols never build time series. */
  isOptionsEnabled: (symbol: string) => Promise<boolean>;
  /** Builder call — (symbol, startDate, endDate). */
  buildSymbol: (symbol: string, startDate: string, endDate: string) => Promise<TimeSeriesBuildReport>;
  logger: (message: string, meta?: Record<string, unknown>) => void;
  warn?: (message: string, meta?: Record<string, unknown>) => void;
  error?: (message: string, meta?: Record<string, unknown>) => void;
}

export async function handleTsBuildTask(
  payload: { symbol: string; date: string },
  deps: TsBuildDeps,
): Promise<void> {
  const { symbol, date } = payload;

  deps.logger('start', { symbol, date });

  if (!(await deps.isOptionsEnabled(symbol))) {
    deps.logger('skip options-disabled', { symbol, date });
    return;
  }

  try {
    const report = await deps.buildSymbol(symbol, date, date);
    deps.logger('done', {
      symbol: report.symbol,
      foundDates: report.foundDates,
      missingDates: report.missingDates,
      processedContracts: report.processedContracts,
      failedContracts: report.failedContracts,
    });
    if (report.missingDates > 0) {
      (deps.warn ?? deps.logger)('missing dates — corpus may not be ready', {
        symbol,
        date,
        missingDates: report.missingDates,
      });
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    (deps.error ?? deps.logger)('failed', { symbol, date, error: message });
    throw err;
  }
}
