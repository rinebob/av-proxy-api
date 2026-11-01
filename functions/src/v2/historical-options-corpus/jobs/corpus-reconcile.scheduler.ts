/**
 * reconcileOptionsCorpusCoverage — standing coverage reconciler (Task #220).
 *
 * Runs ~90 min after the 21:00 PT corpus sweep (sweepHistoricalOptionsCorpus)
 * so that sweep's freshly dispatched seeds have landed before this diff runs. For every
 * options-enabled symbol: expected trading days
 * [OPTIONS_CORPUS_DAILY_FLOOR_DATE .. yesterday ET] vs stored corpus
 * objects → seed tasks for uncovered, un-queued gaps + one run doc
 * recording the sweep. Thin wrapper — logic lives in corpus-reconcile.core.ts.
 */
import { onSchedule } from 'firebase-functions/v2/scheduler';
import { getFunctions } from 'firebase-admin/functions';
import { getStorage } from 'firebase-admin/storage';

import { OPTIONS_CORPUS_RECONCILE_SCHEDULE } from '../../common/function-schedules';
import { getYesterdayEt } from '../../common/utils/date-time.utils';
import {
  OPTIONS_CORPUS_DAILY_FLOOR_DATE,
  OPTIONS_CORPUS_SEED_TASK_QUEUE,
  optionsCorpusBucket,
  type CorpusSeedPayload,
} from '../types';
import { runCorpusReconcile } from '../services/corpus-reconcile.core';
import { CorpusMetadataService } from '../services/corpus-metadata.service';
import { GcsCorpusAdapter } from '../services/gcs-corpus-adapter.service';
import { planCorpusRun } from '../services/corpus-planner.service';
import { TradingCalendarService } from '../services/trading-calendar.service';
import { listOptionsEnabledSymbols } from '../services/options-enabled-gate';
import { toCoverageRunItems } from '../services/corpus-coverage.service';

export const reconcileOptionsCorpusCoverage = onSchedule(
  {
    schedule: OPTIONS_CORPUS_RECONCILE_SCHEDULE,
    timeZone: 'America/Los_Angeles',
    timeoutSeconds: 540,
    memory: '512MiB',
    maxInstances: 1,
  },
  async () => {
    const metadata = new CorpusMetadataService();
    const gcs = new GcsCorpusAdapter(getStorage().bucket(optionsCorpusBucket()));
    const calendar = new TradingCalendarService();
    const queue = getFunctions().taskQueue(OPTIONS_CORPUS_SEED_TASK_QUEUE);

    const report = await runCorpusReconcile(
      {
        listEnabledSymbols: listOptionsEnabledSymbols,
        listExpectedDates: async (startDate, endDate) =>
          calendar.getTradingDates(startDate, endDate),
        listObjectDates: async (symbol) =>
          (await gcs.listItems(symbol)).map((o) => o.date),
        listRunItems: async (symbol) =>
          toCoverageRunItems(await metadata.listItemsForSymbol(symbol)),
        planRun: (options) => planCorpusRun({ ...options, calendar, metadata }),
        markRunStatus: (runId, status) => metadata.markRunStatus(runId, status),
        updateRunSummary: (runId, perSymbol) => metadata.updateRunSummary(runId, perSymbol),
        enqueueSeed: async (payload: CorpusSeedPayload) => {
          await queue.enqueue(payload);
        },
        logger: console,
      },
      { startDate: OPTIONS_CORPUS_DAILY_FLOOR_DATE, endDate: getYesterdayEt() },
    );
    console.log('[reconcileOptionsCorpusCoverage]', JSON.stringify(report));
  },
);
