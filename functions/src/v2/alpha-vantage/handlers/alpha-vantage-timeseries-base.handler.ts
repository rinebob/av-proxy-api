import { AlphaVantageBaseHandler } from './alpha-vantage-base.handler';
import { saveAvTimeSeriesData, upsertAvDailyBar, upsertAvWeeklyBar, upsertAvMonthlyBar, upsertAvDailyIntradaySnapshot } from '../firestore/av-firestore-helper';
import { ApiResponse } from '@shared/core';
import { AlphaVantageEndpoint, TimeSeriesEndpointConfig, TimeSeriesInterval } from '@shared/alpha-vantage';
import type { CompactBar } from '@shared/alpha-vantage';
import { createLogger, hr } from '../../utils/utils';
import { DayOfWeek } from '@shared/alpha-vantage';
import { AlphaVantageHandlerFactory } from '../alpha-vantage-factory';
import { HealthMetricsService } from '../../health-metrics/health-metrics.service';
import { RefreshStatus, RefreshTrigger } from '@shared/firestore';
import { TradingPhase } from '@shared/health-metrics';
import { parseAvEtTimestampMs } from '../utils/date-utils';

const log = createLogger('av.handler.ts-base'); // Abbrev: aVTS.H

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
 *   - Daily: upsertAvDailyBar()
 *   - Weekly: upsertAvWeeklyBar()
 *   - Monthly: upsertAvMonthlyBar()
 *   - Full/backfill: saveAvTimeSeriesData()
 *
 * Notes:
 * - When `outputsize=compact`, only the most recent bar is upserted to minimize writes.
 * - Derived deltas (pc/ch/cp) are computed from the previous adjusted close when available.
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
    super.logRequest(params, 'AVTimeSeriesHandlerBase.fetch');
    const startTime = Date.now();
    const endpoint = this.config.id;
    const symbol = params?.symbol;
    const phase: TradingPhase | undefined = (params as any)?.__phase;
    const runCtx: any | undefined = (params as any)?.__run; // propagated by scheduler for grouping
    hr('aVTS.H', `fetch start ${endpoint} ${symbol ?? ''} [${(this as any).requestId}]`);
    log.info('fetch.start', { endpointId: endpoint, symbol, requestId: (this as any).requestId });
    this.validateParams(params);

    // Strip internal params before sending to AV
    const { __checkWriteToggle, __phase, __run, __fromMs, __toMs, ...publicParams } = params || {};
    const requestParams = this.prepareRequestParams(publicParams);

    try {
      const response = await this.apiClient.get('', { params: requestParams });
      log.debug('fetch.response.raw', { endpointId: endpoint, hasData: !!response?.data, requestId: (this as any).requestId });
      const responseData = response.data;
      const transformedData = this.transformResponse(responseData);

      // Persist bars if provided by subclass
      let bars = this.getBarsForStorage(transformedData);

      // For compact updates, persist only the most recent element
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
          // 1) Determine today’s ET date (YYYY-MM-DD)
          const now = Date.now();
          const etPartsNow = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date(now));
          const etYNow = etPartsNow.find(p => p.type === 'year')?.value;
          const etMNow = etPartsNow.find(p => p.type === 'month')?.value;
          const etDNow = etPartsNow.find(p => p.type === 'day')?.value;
          const todayEt = `${etYNow}-${etMNow}-${etDNow}`;
          // Weekend guard: skip entirely on Sat/Sun (no requests, no writes)
          const dowEt = Number(new Date(new Date(now).toLocaleString('en-US', { timeZone: 'America/New_York' })).getDay());
          if (dowEt === 0 || dowEt === 6) {
            hr('aVTS.H', `pre-close skip weekend ${endpoint} ${symbol} date=${todayEt} [${(this as any).requestId}]`);
            log.info('preclose.skip_weekend', { endpointId: endpoint, symbol, date: todayEt });
            return this.createSuccessResponse(transformedData, this.config.ttl, startTime);
          }

          // 2) Fetch latest intraday (1min) and pick the most recent bar
          const MAX_RETRIES = Number(process.env.AV_INTRADAY_RETRIES ?? 5);
          const BASE_DELAY_MS = Number(process.env.AV_INTRADAY_RETRY_DELAY_MS ?? 2000);
          let captured = false;
          for (let attempt = 1; attempt <= MAX_RETRIES && !captured; attempt++) {
            const intradayHandler: any = AlphaVantageHandlerFactory.createHandler(AlphaVantageEndpoint.TIME_SERIES_INTRADAY);
            const intradayApiResp: any = await intradayHandler.fetch({ symbol, interval: '1min' });
            const intradayRaw = intradayApiResp?.data;
            const rawKeys = Object.keys(intradayRaw || {});
            // Prefer using provider metadata to determine interval and series key
            const meta = intradayRaw?.['Meta Data'] || intradayRaw?.['MetaData'] || {};
            const intervalStr: string | undefined = meta?.['4. Interval'] || meta?.['Interval'];
            const expectedSeriesKey = intervalStr ? `Time Series (${intervalStr})` : undefined;
            const seriesKey = (expectedSeriesKey && rawKeys.includes(expectedSeriesKey))
              ? expectedSeriesKey
              : rawKeys.find(k => k.toLowerCase().includes('time series'));
            const tsObj = seriesKey ? intradayRaw[seriesKey] : undefined;
            if (!tsObj || typeof tsObj !== 'object') {
              hr('aVTS.H', `pre-close intraday attempt ${attempt}/${MAX_RETRIES}: missing series ${endpoint} ${symbol}`);
              if (attempt < MAX_RETRIES) await new Promise(r => setTimeout(r, BASE_DELAY_MS * attempt));
              continue;
            }
            // entries: [ET-local timestamp string => provider bar]
            const entries = Object.entries<any>(tsObj);
            // sort descending by timestamp (provider often returns newest first but enforce)
            entries.sort((a, b) => parseAvEtTimestampMs(a[0]) < parseAvEtTimestampMs(b[0]) ? 1 : -1);

            // Scan top few bars for first matching today ET (guards against rare ordering / clock skew)
            const scanCount = Math.min(entries.length, 10);
            for (let i = 0; i < scanCount && !captured; i++) {
              const [tsStr, vals] = entries[i] as [string, any];
              const close = Number(vals?.['4. close'] ?? vals?.close);
              const ioMs = parseAvEtTimestampMs(tsStr);
              if (!Number.isFinite(close) || !Number.isFinite(ioMs)) continue;

              const partsBar = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date(ioMs));
              const y = partsBar.find(p => p.type === 'year')?.value;
              const m = partsBar.find(p => p.type === 'month')?.value;
              const d = partsBar.find(p => p.type === 'day')?.value;
              const barEtDate = `${y}-${m}-${d}`;
              if (barEtDate !== todayEt) continue;
              // Persist intraday-only snapshot for today’s ET date (no OHLC finalize)
              const etDowNum = new Date(new Date(ioMs).toLocaleString('en-US', { timeZone: 'America/New_York' })).getDay();
              const dowMap: DayOfWeek[] = [DayOfWeek.Sun, DayOfWeek.Mon, DayOfWeek.Tue, DayOfWeek.Wed, DayOfWeek.Thu, DayOfWeek.Fri, DayOfWeek.Sat];
              await upsertAvDailyIntradaySnapshot({ symbol: symbol!, date: barEtDate, ip: close, io: ioMs, dow: dowMap[etDowNum] });
              hr('aVTS.H', `pre-close intraday snapshot upsert (attempt ${attempt}; idx ${i}) ${endpoint} ${symbol} date=${barEtDate} [${(this as any).requestId}]`);
              log.info('firestore.preclose_intraday_snapshot', { endpointId: endpoint, symbol, date: barEtDate, attempt, index: i });
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
                log.warn?.('preclose.intraday_health_record_failed', { endpointId: AlphaVantageEndpoint.TIME_SERIES_INTRADAY, symbol, error: String((e as any)?.message || e) } as any);
              }
              captured = true;
            }
            if (!captured) {
              hr('aVTS.H', `pre-close intraday give-up ${endpoint} ${symbol} todayEt=${todayEt} [${(this as any).requestId}]`);
              log.warn?.('preclose.intraday_giveup', { endpointId: endpoint, symbol, todayEt, maxRetries: MAX_RETRIES } as any);
              return this.createSuccessResponse(transformedData, this.config.ttl, startTime);
            }
          }
          // Success response without further persistence
          hr('aVTS.H', `fetch ok ${endpoint} ${symbol ?? ''} ${(Date.now() - startTime)}ms [${(this as any).requestId}]`);
          log.info('fetch.success', { endpointId: endpoint, symbol, durationMs: Date.now() - startTime, requestId: (this as any).requestId });
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
        bars = [latest];
      }

      if (
        symbol &&
        bars &&
        bars.length > 0 &&
        Object.values(AlphaVantageEndpoint).includes(endpoint as AlphaVantageEndpoint)
      ) {
        const outputSize = (requestParams as any)?.outputsize as string | undefined;
        if (outputSize === 'compact') {
          // Upsert only the latest bar to avoid rewriting larger arrays
          const latest = bars[0];
          hr('aVTS.H', `upsert ${endpoint} ${symbol} date=${latest.date} [${(this as any).requestId}]`);
          log.info('firestore.upsert', { endpointId: endpoint, symbol, date: latest.date, requestId: (this as any).requestId });
          if (this.config.interval === TimeSeriesInterval.DAILY) {
            const o = Number(latest.open), h = Number(latest.high), l = Number(latest.low), c = Number(latest.close);
            const invalid = !Number.isFinite(o) || !Number.isFinite(h) || !Number.isFinite(l) || !Number.isFinite(c) || ((o === 0) && (h === 0) && (l === 0) && (c === 0));
            // Apply invalid-bar guard only during POST finalization flows. PRE may still upsert intraday snapshots.
            if (invalid && (__phase === TradingPhase.POST)) {
              return this.createSuccessResponse(transformedData, this.config.ttl, startTime);
            }
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
          // Intraday mapping semantics (documented, optional):
          // If the handler provides intradayPrice/ObservedAt, they can be forwarded as ip/io on the patch.
          // The daily upsert helper will derive `it` from `io`.
          // Example (left commented to avoid behavior change):
          // if ((latest as any).intradayPrice != null) (patch as any).ip = (latest as any).intradayPrice;
          // if ((latest as any).intradayObservedAt != null) (patch as any).io = (latest as any).intradayObservedAt;
          const finalizedAtMs = (this.config.interval === TimeSeriesInterval.DAILY && (__phase === TradingPhase.POST))
            ? Date.now()
            : undefined;
          switch (this.config.interval) {
            case TimeSeriesInterval.DAILY:
              await upsertAvDailyBar({ symbol, date: latest.date, patch, finalizedAtMs });
              break;
            case TimeSeriesInterval.WEEKLY:
              await upsertAvWeeklyBar({ symbol, date: latest.date, patch });
              break;
            case TimeSeriesInterval.MONTHLY:
              await upsertAvMonthlyBar({ symbol, date: latest.date, patch });
              break;
            default:
              await saveAvTimeSeriesData(
                bars,
                symbol,
                endpoint as AlphaVantageEndpoint,
                this.config.interval as TimeSeriesInterval,
                { fromMs: __fromMs, toMs: __toMs },
              );
          }
        } else {
          // Full/backfill writes
          hr('aVTS.H', `save ${endpoint} ${symbol} bars=${bars.length} [${(this as any).requestId}]`);
          log.info('firestore.save', { endpointId: endpoint, symbol, bars: bars.length, requestId: (this as any).requestId });
          await saveAvTimeSeriesData(
            bars,
            symbol,
            endpoint as AlphaVantageEndpoint,
            this.config.interval as TimeSeriesInterval,
            { fromMs: __fromMs, toMs: __toMs },
          );
        }
      } else {
        hr('aVTS.H', `skip save (empty|noBars) ${endpoint} ${symbol ?? ''} [${(this as any).requestId}]`);
        log.info('firestore.skip_or_empty', { endpointId: endpoint, symbol, hasBars: !!bars && bars.length > 0, requestId: (this as any).requestId });
      }

      hr('aVTS.H', `fetch ok ${endpoint} ${symbol ?? ''} ${(Date.now() - startTime)}ms [${(this as any).requestId}]`);
      log.info('fetch.success', { endpointId: endpoint, symbol, durationMs: Date.now() - startTime, requestId: (this as any).requestId });
      return this.createSuccessResponse(transformedData, this.config.ttl, startTime);
    } catch (error) {
      hr('aVTS.H', `fetch error ${endpoint} ${symbol ?? ''} ${String((error as any)?.message || error)} [${(this as any).requestId}]`);
      log.error('fetch.error', { endpointId: endpoint, symbol, error: String((error as any)?.message || error), requestId: (this as any).requestId });
      throw super.normalizeError(error);
    }
  }
}