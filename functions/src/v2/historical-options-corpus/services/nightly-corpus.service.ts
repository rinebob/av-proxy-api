import { getFunctions } from 'firebase-admin/functions';
import { getStorage } from 'firebase-admin/storage';

import type { CorpusSeedPayload } from '../types';
import { CorpusMetadataService, type CorpusRunPlan } from './corpus-metadata.service';
import { GcsCorpusAdapter } from './gcs-corpus-adapter.service';
import { planCorpusRun, type PlanCorpusRunOptions } from './corpus-planner.service';
import { TradingCalendarService } from './trading-calendar.service';
import { OPTIONS_CORPUS_SEED_TASK_QUEUE } from '../handlers/corpus-seed.task';

export const NIGHTLY_CORPUS_SYMBOLS = ['QQQ', 'TQQQ'] as const;

export interface NightlyCorpusDependencies {
  calendar: Pick<TradingCalendarService, 'isTradingDay'>;
  metadata: CorpusMetadataService;
  gcs: Pick<GcsCorpusAdapter, 'getMetadata'>;
  planRun: (options: PlanCorpusRunOptions) => Promise<CorpusRunPlan>;
  enqueueTask: (payload: CorpusSeedPayload) => Promise<void>;
  now?: () => Date;
}

export interface NightlyCorpusReport {
  targetDate: string;
  skippedMarketClosed: boolean;
  runId?: string;
  queuedItems: number;
  skippedExistingItems: number;
}

export class NightlyCorpusService {
  constructor(private readonly deps: NightlyCorpusDependencies) {}

  async run(): Promise<NightlyCorpusReport> {
    const targetDate = this.getPacificDate(this.deps.now?.() ?? new Date());
    if (!this.deps.calendar.isTradingDay(targetDate)) {
      return {
        targetDate,
        skippedMarketClosed: true,
        queuedItems: 0,
        skippedExistingItems: 0,
      };
    }

    const runPlan = await this.deps.planRun({
      symbols: [...NIGHTLY_CORPUS_SYMBOLS],
      startDate: targetDate,
      endDate: targetDate,
      dryRun: false,
      pilot: false,
      metadata: this.deps.metadata,
    });

    let queuedItems = 0;
    let skippedExistingItems = 0;

    for (const item of runPlan.items) {
      const itemKey = `${item.symbol}_${item.date}`;
      const existingItem = await this.deps.metadata.getItemDoc(runPlan.runId, itemKey);
      if (existingItem?.status === 'success') {
        skippedExistingItems += 1;
        continue;
      }

      const storedMetadata = await this.deps.gcs.getMetadata(item.symbol, item.date);
      if (storedMetadata) {
        await this.deps.metadata.setItemSuccess(runPlan.runId, itemKey, {
          gcsPath: storedMetadata.gcsPath,
          sha256: storedMetadata.sha256,
          bytes: storedMetadata.bytes,
          generation: storedMetadata.generation,
          apiCalls: 0,
        });
        await this.deps.metadata.incrementCompleted(runPlan.runId, 0);
        skippedExistingItems += 1;
        continue;
      }

      await this.deps.enqueueTask({
        runId: runPlan.runId,
        symbol: item.symbol,
        date: item.date,
        attempt: 1,
      });
      queuedItems += 1;
    }

    await this.deps.metadata.markRunStatus(runPlan.runId, queuedItems === 0 ? 'completed' : 'in_progress');

    return {
      targetDate,
      skippedMarketClosed: false,
      runId: runPlan.runId,
      queuedItems,
      skippedExistingItems,
    };
  }

  private getPacificDate(date: Date): string {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: 'America/Los_Angeles',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).formatToParts(date);
    const value = (type: 'year' | 'month' | 'day') => parts.find((part) => part.type === type)?.value ?? '';
    return `${value('year')}-${value('month')}-${value('day')}`;
  }
}

export function createNightlyCorpusService(bucketName?: string): NightlyCorpusService {
  const resolvedBucketName = bucketName ?? process.env.OPTIONS_CORPUS_BUCKET;
  if (!resolvedBucketName) {
    throw new Error('OPTIONS_CORPUS_BUCKET environment variable is not configured');
  }

  return new NightlyCorpusService({
    calendar: new TradingCalendarService(),
    metadata: new CorpusMetadataService(),
    gcs: new GcsCorpusAdapter(getStorage().bucket(resolvedBucketName)),
    planRun: planCorpusRun,
    enqueueTask: async (payload) => {
      await getFunctions().taskQueue(OPTIONS_CORPUS_SEED_TASK_QUEUE).enqueue(payload);
    },
  });
}
