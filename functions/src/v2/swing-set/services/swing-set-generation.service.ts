/**
 * SwingSetGenerationService — generates canonical swing sets for a symbol.
 *
 * For each config: read daily-adjusted bars → map to PriceBar →
 * computeZigZagPivots + deriveSwings + computeSwingStats → upsert a
 * SwingSetDoc at options-swing-sets/{symbol}_{paramsId}. Idempotent —
 * repeated runs overwrite the same docs with equivalent payloads.
 * Consumers: generateSwingSetsTask (#126), sweep/backfill (#127).
 */
import { Timestamp } from 'firebase-admin/firestore';
import {
  CANONICAL_ZIGZAG_CONFIGS,
  computeZigZagPivots,
  deriveParamsId,
  deriveSwings,
  computeSwingStats,
} from '@shared/zigzag';
import type {
  DailyAdjustedBar,
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

  /** Generate all four canonical swing sets for a symbol. */
  async generateForSymbol(symbol: string): Promise<SwingSetGenerationResult> {
    const normalized = symbol.trim().toUpperCase();
    const priceBars = await this.loadPriceBars(normalized);
    if (!priceBars) {
      return { symbol: normalized, generated: [], skipped: true, reason: 'no-daily-adjusted-data' };
    }

    const generated: string[] = [];
    for (const config of CANONICAL_ZIGZAG_CONFIGS) {
      const doc = await this.persistDoc(normalized, config, priceBars);
      generated.push(doc.paramsId);
    }
    this.logger.info(`swing-set: generated ${generated.length} sets for ${normalized}`);
    return { symbol: normalized, generated, skipped: false };
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
    const swings = deriveSwings(result.pivots, priceBars, result.projection);
    const stats = computeSwingStats(swings);
    const generatedAt: TimestampLike = Timestamp.now();
    return {
      symbol,
      paramsId: deriveParamsId(config),
      config,
      pivots: result.pivots,
      projection: result.projection ?? null,
      swings,
      stats,
      generatedAt,
      source: 'sa',
    };
  }
}
