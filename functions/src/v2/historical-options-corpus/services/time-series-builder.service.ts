import { getStorage } from 'firebase-admin/storage';

import { createLogger } from '../../utils/utils';
import { GcsCorpusAdapter } from './gcs-corpus-adapter.service';
import { GcsTimeSeriesAdapter } from './gcs-time-series-adapter.service';
import { TradingCalendarService } from './trading-calendar.service';
import type { CorpusReadResult } from '../types';
import {
  parseStorageLine,
  toStorageLine,
  toStorageRecord,
  type TimeSeriesStorageRecord,
} from './time-series-contract.utils';

export interface TimeSeriesBuilderDependencies {
  sourceGcs: GcsCorpusAdapter;
  targetGcs: GcsTimeSeriesAdapter;
  calendar: TradingCalendarService;
  logger: (message: string, meta?: Record<string, unknown>) => void;
  /** Number of trading days to accumulate in memory before flushing per-contract files. */
  chunkDays?: number;
  /** Maximum concurrent GCS writes when flushing a chunk. */
  writeConcurrency?: number;
  /** Number of raw corpus dates to prefetch ahead while processing the current chunk. */
  readConcurrency?: number;
}

export interface TimeSeriesBuildReport {
  symbol: string;
  startDate: string;
  endDate: string;
  totalTradingDays: number;
  foundDates: number;
  missingDates: number;
  corruptDates: number;
  /** Number of successful per-chunk contract file writes (a contract may be flushed multiple times). */
  processedContracts: number;
  failedContracts: number;
  errors: Array<{ contractID: string; error: string }>;
}

interface ContractAccumulator {
  contractID: string;
  symbol: string;
  expiration: string;
  type: string;
  strike: string;
  records: TimeSeriesStorageRecord[];
}

const DEFAULT_CHUNK_DAYS = 90;
const DEFAULT_WRITE_CONCURRENCY = 20;
const DEFAULT_READ_CONCURRENCY = 5;

/**
 * Builds per-contract historical options time series from the raw daily
 * GCS corpus. It processes one symbol at a time, accumulating observations
 * in date chunks and flushing merged JSONL files to the time-series bucket.
 *
 * The builder is idempotent: re-running the same date range merges new
 * observations with existing lines and deduplicates by date.
 */
export class TimeSeriesBuilderService {
  private readonly chunkDays: number;
  private readonly writeConcurrency: number;

  constructor(private readonly deps: TimeSeriesBuilderDependencies) {
    this.chunkDays = deps.chunkDays ?? DEFAULT_CHUNK_DAYS;
    this.writeConcurrency = deps.writeConcurrency ?? DEFAULT_WRITE_CONCURRENCY;
  }

  async buildSymbol(symbol: string, startDate: string, endDate: string, contractID?: string): Promise<TimeSeriesBuildReport> {
    const upperSymbol = symbol.toUpperCase();
    const targetContractID = contractID?.trim().toUpperCase() || undefined;
    const tradingDates = this.deps.calendar.getTradingDates(startDate, endDate);

    this.deps.logger('builder.symbol.start', {
      symbol: upperSymbol,
      startDate,
      endDate,
      totalTradingDays: tradingDates.length,
      chunkDays: this.chunkDays,
    });

    const report: TimeSeriesBuildReport = {
      symbol: upperSymbol,
      startDate,
      endDate,
      totalTradingDays: tradingDates.length,
      foundDates: 0,
      missingDates: 0,
      corruptDates: 0,
      processedContracts: 0,
      failedContracts: 0,
      errors: [],
    };

    let chunk = new Map<string, ContractAccumulator>();
    let datesInChunk = 0;

    const readConcurrency = this.deps.readConcurrency ?? DEFAULT_READ_CONCURRENCY;
    const readQueue: Promise<CorpusReadResult>[] = [];
    const datesToPreload = Math.min(readConcurrency, tradingDates.length);
    for (let i = 0; i < datesToPreload; i++) {
      readQueue.push(this.deps.sourceGcs.readItem(upperSymbol, tradingDates[i]));
    }

    for (let i = 0; i < tradingDates.length; i++) {
      const date = tradingDates[i];
      const nextRead = readQueue.shift();
      if (!nextRead) {
        break;
      }
      const readResult = await nextRead;

      const nextIdx = i + readConcurrency;
      if (nextIdx < tradingDates.length) {
        readQueue.push(this.deps.sourceGcs.readItem(upperSymbol, tradingDates[nextIdx]));
      }

      if (readResult.status === 'NOT_FOUND') {
        report.missingDates += 1;
        this.deps.logger('builder.date.missing', { symbol: upperSymbol, date });
        continue;
      }

      if (readResult.status === 'CORRUPT') {
        report.corruptDates += 1;
        this.deps.logger('builder.date.corrupt', { symbol: upperSymbol, date, reason: readResult.reason });
        continue;
      }

      report.foundDates += 1;
      this.deps.logger('builder.date.found', {
        symbol: upperSymbol,
        date,
        contracts: readResult.response.data.length,
      });
      for (const contract of readResult.response.data) {
        if (!contract.contractID || !contract.date) {
          continue;
        }

        const currentContractID = contract.contractID.toUpperCase();
        if (targetContractID && currentContractID !== targetContractID) {
          continue;
        }

        const record = toStorageRecord(contract);
        if (!record) {
          continue;
        }

        let accumulator = chunk.get(currentContractID);
        if (!accumulator) {
          accumulator = {
            contractID: currentContractID,
            symbol: upperSymbol,
            expiration: contract.expiration ?? '',
            type: contract.type ?? '',
            strike: contract.strike ?? '',
            records: [],
          };
          chunk.set(currentContractID, accumulator);
        }
        accumulator.records.push(record);
      }

      datesInChunk += 1;
      const isLastDate = i === tradingDates.length - 1;
      if (datesInChunk >= this.chunkDays || isLastDate) {
        await this.flushChunk(upperSymbol, chunk, report);
        chunk = new Map();
        datesInChunk = 0;
      }
    }

    this.deps.logger('builder.symbol.done', { symbol: upperSymbol, report });

    return report;
  }

  private async flushChunk(
    symbol: string,
    chunk: Map<string, ContractAccumulator>,
    report: TimeSeriesBuildReport,
  ): Promise<void> {
    const contractIDs = Array.from(chunk.keys());
    this.deps.logger('builder.flush.start', { symbol, contracts: contractIDs.length });

    // Process write batches sequentially to keep GCS concurrency bounded and avoid
    // memory spikes from launching every per-contract write at once.
    for (let i = 0; i < contractIDs.length; i += this.writeConcurrency) {
      const batch = contractIDs.slice(i, i + this.writeConcurrency);
      await this.flushBatch(symbol, batch, chunk, report);
    }

    this.deps.logger('builder.flush.done', { symbol, contracts: contractIDs.length });
  }

  private async flushBatch(
    symbol: string,
    batch: string[],
    chunk: Map<string, ContractAccumulator>,
    report: TimeSeriesBuildReport,
  ): Promise<void> {
    const existingLines = await Promise.all(
      batch.map((contractID) => this.deps.targetGcs.readLines(symbol, contractID)),
    );

    let batchSuccesses = 0;
    const writePromises = batch.map((contractID, index) => {
      const accumulator = chunk.get(contractID);
      if (!accumulator) {
        return Promise.resolve();
      }
      return this.writeMerged(symbol, contractID, accumulator, existingLines[index])
        .then(() => {
          batchSuccesses += 1;
        })
        .catch((error) => {
          const message = error instanceof Error ? error.message : String(error);
          report.failedContracts += 1;
          report.errors.push({ contractID, error: message });
          this.deps.logger('builder.write.error', { symbol, contractID, error: message });
        });
    });

    await Promise.all(writePromises);
    report.processedContracts += batchSuccesses;
  }

  private async writeMerged(
    symbol: string,
    contractID: string,
    accumulator: ContractAccumulator,
    existingLines: string[] | undefined,
  ): Promise<void> {
    const existingRecords: TimeSeriesStorageRecord[] = [];
    for (const line of existingLines ?? []) {
      const record = parseStorageLine(line);
      if (record) {
        existingRecords.push(record);
      } else {
        this.deps.logger('builder.line.corrupt', {
          symbol,
          contractID,
          line: line.slice(0, 200),
        });
      }
    }

    const byDate = new Map<string, TimeSeriesStorageRecord>();
    for (const record of existingRecords) {
      byDate.set(record.d, record);
    }
    for (const record of accumulator.records) {
      if (!byDate.has(record.d)) {
        byDate.set(record.d, record);
      }
    }

    const sorted = Array.from(byDate.values()).sort((a, b) => a.d.localeCompare(b.d));
    const lines = sorted.map(toStorageLine);

    const customMetadata: Record<string, string> = {
      symbol,
      contractID,
      expiration: accumulator.expiration,
      type: accumulator.type,
      strike: accumulator.strike,
      firstObserved: sorted[0]?.d ?? '',
      lastObserved: sorted[sorted.length - 1]?.d ?? '',
      observationCount: String(sorted.length),
      schemaVersion: 'v1',
    };

    await this.deps.targetGcs.writeLines(symbol, contractID, lines, customMetadata);
  }
}

export function createTimeSeriesBuilderService(
  sourceBucketName?: string,
  targetBucketName?: string,
): TimeSeriesBuilderService {
  const resolvedSource = sourceBucketName ?? process.env.OPTIONS_CORPUS_BUCKET;
  if (!resolvedSource) {
    throw new Error('OPTIONS_CORPUS_BUCKET environment variable is not configured');
  }

  const resolvedTarget = targetBucketName ?? process.env.OPTIONS_TIME_SERIES_BUCKET;
  if (!resolvedTarget) {
    throw new Error('OPTIONS_TIME_SERIES_BUCKET environment variable is not configured');
  }

  const logger = createLogger('time-series-builder');

  return new TimeSeriesBuilderService({
    sourceGcs: new GcsCorpusAdapter(getStorage().bucket(resolvedSource)),
    targetGcs: new GcsTimeSeriesAdapter(getStorage().bucket(resolvedTarget)),
    calendar: new TradingCalendarService(),
    logger: (message, meta) => logger.info(message, meta ?? {}),
  });
}
