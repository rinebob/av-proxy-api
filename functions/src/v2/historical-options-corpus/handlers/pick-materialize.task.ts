import { onTaskDispatched } from 'firebase-functions/v2/tasks';

import type { AvOptionContract } from '@shared/alpha-vantage';

import { admin } from '../../../firebase-admin-init';
import { isValidIsoDate } from '../../common/utils/date-time.utils';
import { optionsCorpusBucket } from '../types';
import { GcsCorpusAdapter } from '../services/gcs-corpus-adapter.service';
import { createOptionsEnabledChecker } from '../services/options-enabled-gate';
import { materializeSymbolPicks } from '../services/pick-materialize.service';
import { DailyAdjustedReader } from '../../swing-set/services/daily-adjusted-reader.service';

/**
 * Payload for the delta-pick materialization task. `date` bounds the run
 * to a single stored date (nightly append / single-date repair, Task
 * #224); omitting it walks every stored corpus date for the symbol.
 */
export interface PickMaterializePayload {
  symbol: string;
  date?: string;
}

export const OPTIONS_PICK_MATERIALIZE_TASK_QUEUE = 'processOptionsDeltaPickMaterializeTask';

/**
 * Cloud Task worker that materializes a symbol's option-delta picks.
 *
 * For each stored corpus date the worker loads the chain once, runs
 * `pickCellsForDate`, and merges the 380 cell entries through
 * `mergeDayEntries`. All reads are GCS — zero AV calls.
 *
 * Per-symbol serialization gives zero write contention: a symbol's cell
 * docs are only ever written by one task at a time. Retries are safe —
 * the writer skips picked dates and repairs miss-status dates, so a
 * re-dispatched task resumes as a no-op over already-written days.
 */
export const processOptionsDeltaPickMaterializeTask = onTaskDispatched<PickMaterializePayload>(
  {
    retryConfig: { maxAttempts: 3 },
    rateLimits: {
      maxConcurrentDispatches: 5,
      maxDispatchesPerSecond: 2.0,
    },
    memory: '1GiB',
    timeoutSeconds: 540,
  },
  async (req) => {
    const { symbol: rawSymbol, date } = req.data;
    const symbol = String(rawSymbol ?? '').trim().toUpperCase();
    if (!symbol) {
      console.error('[pick-materialize] missing symbol in payload');
      return;
    }
    if (date !== undefined && !isValidIsoDate(date)) {
      console.error('[pick-materialize] malformed date in payload', { symbol, date });
      return;
    }

    // Curation gate — direct enqueues must not write picks for disabled symbols.
    if (!(await createOptionsEnabledChecker()(symbol))) {
      console.log('[pick-materialize] skipped — options-disabled', { symbol });
      return;
    }

    const db = admin.firestore();
    const gcs = new GcsCorpusAdapter(admin.storage().bucket(optionsCorpusBucket()));
    const bars = new DailyAdjustedReader(db);

    const report = await materializeSymbolPicks(
      { symbol, dates: date === undefined ? undefined : [date] },
      {
        db,
        listCorpusDates: async (s) => (await gcs.listItems(s)).map((r) => r.date),
        loadChain: async (s, d): Promise<AvOptionContract[] | undefined> => {
          const result = await gcs.readItem(s, d);
          if (result.status === 'NOT_FOUND') return undefined;
          if (result.status === 'CORRUPT') {
            throw new Error(`corrupt corpus object ${s}/${d}: ${result.reason ?? 'unknown'}`);
          }
          return result.response.data;
        },
        loadCloses: async (s) => {
          // Single-date bound: one year-shard read instead of the full history.
          if (date !== undefined) {
            const bar = await bars.readDate(s, date);
            return bar === null ? new Map() : new Map([[bar.date, bar.adjustedClose]]);
          }
          const list = await bars.read(s);
          return new Map(list.map((b) => [b.date, b.adjustedClose]));
        },
        logger: {
          info: (m, meta) => console.log(`[pick-materialize] ${m}`, meta ?? {}),
          warn: (m, meta) => console.warn(`[pick-materialize] ${m}`, meta ?? {}),
        },
      },
    );

    console.log('[pick-materialize] done', report);
  },
);
