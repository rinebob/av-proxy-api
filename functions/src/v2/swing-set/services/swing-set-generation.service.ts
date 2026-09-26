/**
 * SwingSetGenerationService — generates the corpus swing set for a symbol.
 *
 * Read daily-adjusted bars → map to PriceBar → computeZigZagPivots → reduce
 * to pivot dates + current extreme → upsert a SwingSetDoc at
 * options-swing-sets/{symbol}_{paramsId}. Idempotent — repeated runs
 * overwrite the same doc with equivalent payloads.
 * Consumers: generateSwingSetsTask (#126), sweep/backfill (#127).
 */
import { Timestamp } from 'firebase-admin/firestore';
import {
  CORPUS_ZIGZAG_CONFIG,
  computeZigZagPivots,
  deriveParamsId,
} from '@shared/zigzag';
import type {
  DailyAdjustedBar,
  Pivot,
  PriceBar,
  SwingSetDoc,
  ZigZagConfig,
} from '@shared/zigzag';
import type { TimestampLike } from '@shared/firestore';
import type { SwingSetRepository } from './swing-set.repository';
import { DailyAdjustedReader } from './daily-adjusted-reader.service';
import type { SwingSetGenerationResult } from '../types';

/** Narrow seam so tests can stub the reader without Firestore. */
export interface DailyAdjustedReaderLike {
  read(symbol: string): Promise<DailyAdjustedBar[]>;
}

export interface LoggerLike {
  info(message: string): void;
  warn(message: string): void;
  error(message: string): void;
}

export class SwingSetGenerationService {
  constructor(
    private readonly reader: DailyAdjustedReaderLike,
    private readonly repository: SwingSetRepository,
    private readonly logger: LoggerLike = console,
  ) {}

  /** Generate the corpus swing set for a symbol. */
  async generateForSymbol(symbol: string): Promise<SwingSetGenerationResult> {
    const normalized = symbol.trim().toUpperCase();
    const priceBars = await this.loadPriceBars(normalized);
    if (!priceBars) {
      return { symbol: normalized, generated: [], skipped: true, reason: 'no-daily-adjusted-data' };
    }

    const doc = await this.persistDoc(normalized, CORPUS_ZIGZAG_CONFIG, priceBars);
    this.logger.info(`swing-set: generated ${normalized} (${doc.paramsId})`);
    return { symbol: normalized, generated: [doc.paramsId], skipped: false };
  }

  /** Generate a single swing set for a symbol/config pair. */
  async generateForConfig(symbol: string, config: ZigZagConfig): Promise<SwingSetDoc | null> {
    const normalized = symbol.trim().toUpperCase();
    const priceBars = await this.loadPriceBars(normalized);
    if (!priceBars) return null;
    return this.persistDoc(normalized, config, priceBars);
  }

  private async persistDoc(symbol: string, config: ZigZagConfig, priceBars: PriceBar[]): Promise<SwingSetDoc> {
    const doc = this.buildDoc(symbol, config, priceBars);
    await this.repository.upsert(doc);
    return doc;
  }

  private async loadPriceBars(symbol: string): Promise<PriceBar[] | null> {
    const bars = await this.reader.read(symbol);
    if (bars.length === 0) {
      this.logger.warn(`swing-set: no daily-adjusted data for ${symbol} — skipped`);
      return null;
    }
    return bars.map(DailyAdjustedReader.toPriceBar);
  }

  private buildDoc(symbol: string, config: ZigZagConfig, priceBars: PriceBar[]): SwingSetDoc {
    const result = computeZigZagPivots(priceBars, config);
    const generatedAt: TimestampLike = Timestamp.now();
    return {
      symbol,
      paramsId: deriveParamsId(config),
      config,
      pivotDates: result.pivots.map((p) => toDay(p)),
      ...currentExtreme(result.pivots, result.projection),
      generatedAt,
      source: 'sa',
    };
  }
}

const toDay = (p: Pivot): string => new Date(p.time).toISOString().slice(0, 10);

/**
 * The developing swing's extreme, matching the old getCurrentSwing
 * derivation: projection (unconfirmed) when present — direction isHigh→'up';
 * otherwise the last confirmed pivot itself, direction pointing away from it.
 */
function currentExtreme(
  pivots: Pivot[],
  projection: Pivot | undefined,
): Pick<SwingSetDoc, 'currentExtremeDate' | 'currentDirection'> {
  if (projection) {
    return { currentExtremeDate: toDay(projection), currentDirection: projection.isHigh ? 'up' : 'down' };
  }
  const last = pivots[pivots.length - 1];
  if (!last) return { currentExtremeDate: null, currentDirection: null };
  return { currentExtremeDate: toDay(last), currentDirection: last.isHigh ? 'down' : 'up' };
}
