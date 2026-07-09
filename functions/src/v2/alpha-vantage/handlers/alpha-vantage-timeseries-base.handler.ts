import { AlphaVantageBaseHandler } from './alpha-vantage-base.handler';
import {
  computeDowFromDateString,
  mergeMonthlyCompactWindowIntoAllDocs,
  mergeWeeklyCompactWindowIntoShards,
  saveAvTimeSeriesData,
  todayEtDate,
  upsertAvDailyBar,
} from '../firestore';
import { ApiResponse } from '@shared/core';
import { AlphaVantageEndpoint, DayOfWeek, TimeSeriesEndpointConfig, TimeSeriesInterval } from '@shared/alpha-vantage';
import type { CompactBar } from '@shared/alpha-vantage';
import { betterLogger, createLogger, hr } from '../../utils/utils';
import { fetchAndStoreDailyIntradayBar } from '../services/av-intraday-daily.service';
import { HealthMetricsService } from '../../health-metrics/health-metrics.service';
import { RefreshStatus, RefreshTrigger } from '@shared/firestore';
import { TradingPhase } from '@shared/health-metrics';

const log = createLogger('av.handler.ts-base'); // Abbrev: aVTS.H (structured JSON)
const tsLogger = betterLogger('aVTS.H'); // Human-readable Logs Explorer lines

/**
 * Compact bar shape produced by AV time-series handlers prior to persistence.
 *
 * Lifecycle:
 * 1) Subclasses implement getBarsForStorage() to return StorageBar[] from the transformed AV payload.
 * 2) fetch() optionally reduces to the latest bar when outputsize=compact and computes deltas from previous adjusted close.
 * 3) Firestore persistence occurs via upsert helpers (daily/weekly/monthly) or saveAvTimeSeriesData() for full/backfill.
 *
 * This is an intermediate representation. The persisted schema is the shared CompactBar
 * (short-key form) defined in `shared/alpha-vantage/av-time-series.types.ts`.
 */
export interface StorageBar {
  date: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  // Optional fields preserved when available (adjusted endpoints / global quote)
  adjustedClose?: number;
  dividendAmount?: number;
  splitCoefficient?: number;
  // Optional intraday snapshot fields (captured pre-close for REL-STR use cases)
  intradayPrice?: number;        // intraday mark price
  intradayObservedAt?: number;   // epoch ms when the intraday price was observed
  intradayTime?: string;         // human-readable HH:mm (derived from intradayObservedAt)
  // Intraday deltas (pre-close only)
  intradayChange?: number;       // ip - previous day's close
  intradayPercentChange?: number; // (intradayChange / previous day's close) * 100
  // Derived fields for deltas (computed from previous adjusted close)
  previousClose?: number;
  change?: number;
  changePercent?: number;
}

/**
 * Abstract base handler for Alpha Vantage time series endpoints.
 *
 * Responsibilities:
 * - Validate params and prepare AV request params.
 * - Transform raw provider payload into a typed shape (T) consumable by clients.
 * - Produce StorageBar[] for persistence via `getBarsForStorage()`.
 * - Persist bars to Firestore using:
 *   - Daily compact: `upsertAvDailyBar()` (single-bar upsert by date).
 *   - Weekly compact: `mergeWeeklyCompactWindowIntoShards()` (overwrite latest-year and rollover shards from compact window).
 *   - Monthly compact: `mergeMonthlyCompactWindowIntoAllDocs()` (merge compact window by date into monthly `all` doc).
 *   - Full/backfill (all intervals): `saveAvTimeSeriesData()` (normalized dual-write to raw + split-adjusted series).
 *
 * Notes:
 * - When `outputsize=compact`, only the most recent bar is considered for persistence.
 *   - DAILY: single-bar patch into the year shard.
 *   - WEEKLY/MONTHLY: compact window is treated as the source of truth for the latest-year shards / monthly `all` doc.
 * - Derived deltas (pc/ch/cp) are computed from the previous **raw** close when available.
 */
export abstract class AlphaVantageTimeSeriesHandlerBase<T = any> extends AlphaVantageBaseHandler<T> {
  protected readonly config: TimeSeriesEndpointConfig;

  constructor(config: TimeSeriesEndpointConfig) {
    super(config);
    this.config = config;
  }

  /**
   * Ensure required fields are present (e.g., symbol) prior to calling AV.
   * @throws Error when required params are missing.
   */
  protected validateParams(params: Record<string, any>): void {
    if (!params.symbol) {
      throw new Error('Missing required parameter: symbol');
    }
  }

  protected prepareRequestParams(params: any): any {
    return { ...params, ...this.baseParams };
  }

  /**
   * Hook for subclasses to map the transformed payload into StorageBar[] used for persistence.
   * Return null/empty array when there are no bars to persist.
   */
  protected abstract getBarsForStorage(transformed: T): StorageBar[] | null;

  /**
   * Transform raw AV response payload into the public/typed shape T.
   * Implementations should not perform Firestore writes directly; persistence is orchestrated by fetch().
   */
  protected abstract transformResponse(data: any): T;

  /**
   * Fetches AV time series, transforms, prepares StorageBar[], and persists to Firestore.
   *
   * Behavior:
   * - Strips internal params before calling AV.
   * - If outputsize=compact, reduces to the most recent bar and computes deltas from the previous bar.
   * - Uses upsert helpers for compact updates; uses saveAvTimeSeriesData() for full/backfill writes.
   * - Respects manual write toggle unless caller passes `__checkWriteToggle: false`.
   *
   * @param params symbol, outputsize=('compact'|'full'), and internal flags like __checkWriteToggle
   * @returns ApiResponse<T> containing transformed data and TTL metadata
   * @throws Normalized provider or network errors
   */
  public async fetch(params: any = {}): Promise<ApiResponse<T>> {
    const startTime = Date.now();
    const endpoint = this.config.id;
    const symbol = params?.symbol;
    const phase: TradingPhase | undefined = (params as any)?.__phase;
    const runCtx: any | undefined = (params as any)?.__run; // propagated by scheduler for grouping
    tsLogger.info('ts.handler.fetch.start', {
      function: 'tsBase',
      symbol: symbol ?? 'n/a',
      marketDate: 'n/a',
      interval: this.config.interval ?? 'n/a',
      endpoint: String(endpoint),
    });
    this.validateParams(params);

    // Strip internal params before sending to AV
    const { __checkWriteToggle, __phase, __run, __skipSave, ...publicParams } = params || {};
    const requestParams = this.prepareRequestParams(publicParams);

    try {
      // Measure raw Alpha Vantage HTTP latency separately from transform + Firestore.
      tsLogger.timeStart('av_http', {
        function: 'tsBase',
        symbol: symbol ?? 'n/a',
        marketDate: 'n/a',
        interval: this.config.interval ?? 'n/a',
        endpoint: String(endpoint),
      });
      const response = await this.apiClient.get('', { params: requestParams });
      tsLogger.timeEnd('av_http', {
        function: 'tsBase',
        symbol: symbol ?? 'n/a',
        marketDate: 'n/a',
        interval: this.config.interval ?? 'n/a',
        endpoint: String(endpoint),
      });
      log.debug('fetch.response.raw', { endpointId: endpoint, hasData: !!response?.data, requestId: (this as any).requestId });
      const responseData = response.data;
      const transformedData = this.transformResponse(responseData);

      // Persist bars if provided by subclass
      let bars = this.getBarsForStorage(transformedData);

      // Return early if saving is skipped
      if (__skipSave) {
        hr('aVTS.H', `fetch ok (skipSave) ${endpoint} ${symbol ?? ''} ${(Date.now() - startTime)}ms [${(this as any).requestId}]`);
        return this.createSuccessResponse(transformedData, this.config.ttl, startTime);
      }

      // For compact updates, keep scheduler/job cadence lightweight:
      // - DAILY: persist only the most recent bar.
      // - WEEKLY/MONTHLY: keep the compact window; merge helpers are
      //   responsible for appropriately overwriting latest shards/docs.
      const outputSize = (requestParams as any)?.outputsize as string | undefined;
      if (outputSize === 'compact' && Array.isArray(bars) && bars.length > 1) {
        // Choose the bar with the maximum date (YYYY-MM-DD)
        let latestIdx = 0;
        let latestTs = Number.NEGATIVE_INFINITY;
        for (let i = 0; i < bars.length; i++) {
          const t = new Date(`${bars[i].date}T00:00:00.000Z`).getTime();
          if (Number.isFinite(t) && t > latestTs) {
            latestTs = t;
            latestIdx = i;
          }
        }
        // Compute derived deltas from the next-most-recent bar if available
        let prevClose: number | undefined = undefined;
        if (bars.length > 1) {
          // Find the previous bar by date
          let prevTs = Number.NEGATIVE_INFINITY;
          let prevIdx = -1;
          for (let i = 0; i < bars.length; i++) {
            if (i === latestIdx) continue;
            const t = new Date(`${bars[i].date}T00:00:00.000Z`).getTime();
            if (Number.isFinite(t) && t > prevTs && t < latestTs) {
              prevTs = t;
              prevIdx = i;
            }
          }
          if (prevIdx >= 0) {
            const prev = bars[prevIdx];
            // Always use RAW close from provider as baseline
            prevClose = typeof prev.close === 'number' ? prev.close : undefined;
          }
        }
        const latest = bars[latestIdx];

        // Branch: if DAILY + pre-close, write intraday-only snapshot and skip OHLC changes
        if (this.config.interval === TimeSeriesInterval.DAILY && phase === TradingPhase.PRE) {
          // 1) Determine today’s ET date (YYYY-MM-DD) and guard weekends.
          const todayEt = todayEtDate();
          const dowEt = computeDowFromDateString(todayEt);
          if (dowEt === DayOfWeek.Sat || dowEt === DayOfWeek.Sun) {
            hr('aVTS.H', `pre-close skip weekend ${endpoint} ${symbol} date=${todayEt} [${(this as any).requestId}]`);
            log.info('preclose.skip_weekend', { endpointId: endpoint, symbol, date: todayEt });
            return this.createSuccessResponse(transformedData, this.config.ttl, startTime);
          }

          // 2) Fetch 15-min RTH intraday data and aggregate today's OHLCV bar
          const MAX_RETRIES = Number(process.env.AV_INTRADAY_RETRIES ?? 5);
          const BASE_DELAY_MS = Number(process.env.AV_INTRADAY_RETRY_DELAY_MS ?? 2000);
          let captured = false;
          for (let attempt = 1; attempt <= MAX_RETRIES && !captured; attempt++) {
            const result = await fetchAndStoreDailyIntradayBar({
              symbol: symbol!,
              marketDate: todayEt,
              clockPt: runCtx?.clockPt,
            });
            if (!result) {
              hr('aVTS.H', `pre-close intraday attempt ${attempt}/${MAX_RETRIES}: no RTH bars ${endpoint} ${symbol}`);
              if (attempt < MAX_RETRIES) await new Promise(r => setTimeout(r, BASE_DELAY_MS * attempt));
              continue;
            }

            hr('aVTS.H', `pre-close intraday bar upsert (attempt ${attempt}) ${endpoint} ${symbol} date=${todayEt} [${(this as any).requestId}]`);
            log.info('firestore.preclose_intraday_bar', { endpointId: endpoint, symbol, date: todayEt, attempt });
            try {
              const hms = new HealthMetricsService();
              await hms.recordSymbolRefresh(
                AlphaVantageEndpoint.TIME_SERIES_INTRADAY as any,
                symbol!,
                RefreshStatus.SUCCESS,
                Date.now() - startTime,
                undefined,
                { trigger: RefreshTrigger.SCHEDULER, runId: runCtx?.id, run: runCtx }
              );
            } catch (e) {
              // Best effort; do not fail the handler if health recording fails
              hr('aVTS.H', `pre-close intraday health-record failed ${endpoint} ${symbol} ${(e as any)?.message || e}`);
            }
            captured = true;
          }
          if (!captured) {
            hr('aVTS.H', `pre-close intraday give-up ${endpoint} ${symbol} todayEt=${todayEt} [${(this as any).requestId}]`);
            return this.createSuccessResponse(transformedData, this.config.ttl, startTime);
          }
          // Success response without further persistence
          hr('aVTS.H', `fetch ok ${endpoint} ${symbol ?? ''} ${(Date.now() - startTime)}ms [${(this as any).requestId}]`);
          return this.createSuccessResponse(transformedData, this.config.ttl, startTime);
        }

        // Default compact (post-close or non-daily): enrich with pc/ch/cp using RAW close baseline
        if (prevClose != null) {
          const pc = prevClose;
          const ch = latest.close - pc;
          const cp = pc !== 0 ? (ch / pc) * 100 : 0;
          latest.previousClose = pc as any;
          (latest as any).change = ch;
          (latest as any).changePercent = cp;
        }
        // Only reduce to latest bar for DAILY. WEEKLY/MONTHLY keep the compact
        // window so their merge helpers can handle shard/doc updates.
        if (this.config.interval === TimeSeriesInterval.DAILY) {
          bars = [latest];
        }
      }

      if (
        symbol &&
        bars &&
        bars.length > 0 &&
        Object.values(AlphaVantageEndpoint).includes(endpoint as AlphaVantageEndpoint)
      ) {
        // Measure Firestore persistence (all compact/full branches) as a single region.
        tsLogger.timeStart('firestore_save', {
          function: 'tsBase',
          symbol: symbol ?? 'n/a',
          marketDate: 'n/a',
          interval: this.config.interval ?? 'n/a',
          endpoint: String(endpoint),
        });
        const outputSize = (requestParams as any)?.outputsize as string | undefined;
        if (outputSize === 'compact') {
          // Compact path
          const latest = bars[0];
          tsLogger.info('ts.handler.firestore.compact', {
            function: 'tsBase',
            symbol: symbol ?? 'n/a',
            marketDate: latest.date ?? 'n/a',
            interval: this.config.interval ?? 'n/a',
            endpoint: String(endpoint),
          });

          if (this.config.interval === TimeSeriesInterval.DAILY) {
            // DAILY: preserve existing single-bar upsert semantics
            const o = Number(latest.open), h = Number(latest.high), l = Number(latest.low), c = Number(latest.close);
            const invalid = !Number.isFinite(o) || !Number.isFinite(h) || !Number.isFinite(l) || !Number.isFinite(c) || ((o === 0) && (h === 0) && (l === 0) && (c === 0));
            // Apply invalid-bar guard only during POST finalization flows. PRE may still upsert intraday snapshots.
            if (invalid && (__phase === TradingPhase.POST)) {
              return this.createSuccessResponse(transformedData, this.config.ttl, startTime);
            }

            /**
             * Map handler StorageBar → persisted CompactBar patch
             *
             * StorageBar fields:
             * - open/high/low/close/volume
             * - adjustedClose?, dividendAmount?, splitCoefficient?
             * - previousClose?/change?/changePercent? (enriched above for compact path)
             * - intradayPrice?/intradayObservedAt?/intradayTime? (optional)
             *
             * CompactBar short keys:
             * - o/h/l/c/v, ac (adjusted close), dv (dividend), sc (split coeff)
             * - pc/ch/cp for derived deltas
             * - ip/io/it for intraday snapshot fields
             *
             * Note: Daily upsert helper derives `it` (HH:mm America/New_York) from `io` when provided.
             * We intentionally omit intraday fields here unless provided by the handler payload.
             */
            const patch: Partial<CompactBar> = {
              o: latest.open,
              h: latest.high,
              l: latest.low,
              c: latest.close,
              v: latest.volume,
              ac: latest.adjustedClose,
              dv: latest.dividendAmount,
              sc: latest.splitCoefficient,
              // include derived fields when available
              pc: (latest as any).previousClose,
              ch: (latest as any).change,
              cp: (latest as any).changePercent,
            };
            const finalizedAtMs = (this.config.interval === TimeSeriesInterval.DAILY && (__phase === TradingPhase.POST))
              ? Date.now()
              : undefined;
            await upsertAvDailyBar({ symbol, date: latest.date, patch, finalizedAtMs });
          } else if (this.config.interval === TimeSeriesInterval.WEEKLY) {
            // WEEKLY: compact cadence → rebuild latest-year (and rollover) shards from compact window
            await mergeWeeklyCompactWindowIntoShards({
              symbol: symbol!,
              endpoint: endpoint as AlphaVantageEndpoint,
              storageBars: bars,
            });
          } else if (this.config.interval === TimeSeriesInterval.MONTHLY) {
            // MONTHLY: compact cadence → merge compact window by date into monthly all-docs (raw + sa)
            await mergeMonthlyCompactWindowIntoAllDocs({
              symbol: symbol!,
              endpoint: endpoint as AlphaVantageEndpoint,
              storageBars: bars,
            });
          } else {
            // Any other intervals: fall back to full save behavior
            await saveAvTimeSeriesData(
              bars,
              symbol!,
              endpoint as AlphaVantageEndpoint,
              this.config.interval as TimeSeriesInterval,
            );
          }
        } else {
          // Full/backfill writes
          hr('aVTS.H', `save ${endpoint} ${symbol} bars=${bars.length} [${(this as any).requestId}]`);
          await saveAvTimeSeriesData(
            bars,
            symbol!,
            endpoint as AlphaVantageEndpoint,
            this.config.interval as TimeSeriesInterval,
          );
        }
        tsLogger.timeEnd('firestore_save', {
          function: 'tsBase',
          symbol: symbol ?? 'n/a',
          marketDate: 'n/a',
          interval: this.config.interval ?? 'n/a',
          endpoint: String(endpoint),
        });
      } else {
        tsLogger.info('ts.handlerfirestore.skip_or_empty', {
        function: 'fetch',
        symbol: symbol ?? 'n/a',
        marketDate: 'n/a',
        interval: this.config.interval ?? 'n/a',
        endpoint: String(endpoint),
      });
      }

      tsLogger.info('ts.handler.fetch.success', {
        function: 'fetch',
        symbol: symbol ?? 'n/a',
        marketDate: 'n/a',
        interval: this.config.interval ?? 'n/a',
        endpoint: String(endpoint),
      });
      return this.createSuccessResponse(transformedData, this.config.ttl, startTime);
    } catch (error) {
      tsLogger.error('ts.handler fetch error', {
        function: 'fetch',
        symbol: symbol ?? 'n/a',
        marketDate: 'n/a',
        interval: this.config.interval ?? 'n/a',
        endpoint: String(endpoint),
        error: error as string,
      });
      throw super.normalizeError(error);
    }
  }
}