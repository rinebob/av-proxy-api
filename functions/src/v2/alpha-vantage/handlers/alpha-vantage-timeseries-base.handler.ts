import { AlphaVantageBaseHandler } from './alpha-vantage-base.handler';
import { saveAvTimeSeriesData, upsertAvDailyBar, upsertAvWeeklyBar, upsertAvMonthlyBar, getPreviousAdjustedClose } from '../firestore/av-firestore-helper';
import { TradingPhase } from '../../common/function-schedules';
import { ApiResponse } from '@shared/core';
import { AlphaVantageEndpoint, TimeSeriesEndpointConfig, TimeSeriesInterval } from '@shared/alpha-vantage';
import type { CompactBar } from '@shared/alpha-vantage';
import { createLogger, hr } from '../../utils/utils';

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
    const intradayPriceFromParam: number | undefined = (params as any)?.__intradayPrice != null ? Number((params as any).__intradayPrice) : undefined;
    const intradayObservedAtFromParam: number | undefined = (params as any)?.__intradayObservedAt != null ? Number((params as any).__intradayObservedAt) : undefined;
    const gqPrevClose: number | undefined = (params as any)?.__gqPrevClose != null ? Number((params as any).__gqPrevClose) : undefined;
    const gqChange: number | undefined = (params as any)?.__gqChange != null ? Number((params as any).__gqChange) : undefined;
    const gqChangePercent: number | undefined = (params as any)?.__gqChangePercent != null ? Number((params as any).__gqChangePercent) : undefined;
    hr('aVTS.H', `fetch start ${endpoint} ${symbol ?? ''} [${(this as any).requestId}]`);
    log.info('fetch.start', { endpointId: endpoint, symbol, requestId: (this as any).requestId });
    this.validateParams(params);

    // Strip internal params before sending to AV
    const { __checkWriteToggle, __phase, __intradayPrice, __intradayObservedAt, __gqPrevClose, __gqChange, __gqChangePercent, ...publicParams } = params || {};
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
        let prevAdjClose: number | undefined = undefined;
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
            // Prefer adjustedClose when present
            prevAdjClose = typeof prev.adjustedClose === 'number' ? prev.adjustedClose : prev.close;
          }
        }
        const latest = bars[latestIdx];

        // Branch: if DAILY + pre-close, write intraday-only snapshot and skip OHLC changes
        if (this.config.interval === TimeSeriesInterval.DAILY && phase === TradingPhase.PRE) {
          // Determine ip/io: prefer scheduler-provided snapshot, else fall back to transformed latest.intradayPrice if provided
          const ip = Number.isFinite(intradayPriceFromParam as any) ? (intradayPriceFromParam as number) : (typeof (latest as any).intradayPrice === 'number' ? (latest as any).intradayPrice : undefined);
          const io = Number.isFinite(intradayObservedAtFromParam as any) ? (intradayObservedAtFromParam as number) : (typeof (latest as any).intradayObservedAt === 'number' ? (latest as any).intradayObservedAt : Date.now());
          // Determine the target trading date (today in ET) for the snapshot
          const etParts = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date(io));
          const etY = etParts.find(p => p.type === 'year')?.value;
          const etM = etParts.find(p => p.type === 'month')?.value;
          const etD = etParts.find(p => p.type === 'day')?.value;
          const targetEtDate = `${etY}-${etM}-${etD}`; // YYYY-MM-DD in ET
          // Compute ic/ipc: prefer provider deltas from GLOBAL_QUOTE when available; fallback to most recent prior bar
          let ic: number | null = null;
          let ipc: number | null = null;
          if (gqPrevClose != null && Number.isFinite(gqPrevClose) && ip != null) {
            // Provider prevClose + intraday price ⇒ compute ic/ipc
            const ch = gqChange != null && Number.isFinite(gqChange) ? gqChange : (ip - gqPrevClose);
            ic = ch;
            if (gqChangePercent != null && Number.isFinite(gqChangePercent)) {
              ipc = gqChangePercent;
            } else {
              ipc = gqPrevClose !== 0 ? (ch / gqPrevClose) * 100 : 0;
            }
          } else if (ip != null) {
            try {
              const prevClose = await getPreviousAdjustedClose({ symbol: symbol!, date: targetEtDate });
              if (prevClose != null && Number.isFinite(prevClose)) {
                ic = ip - prevClose;
                ipc = prevClose !== 0 ? (ic / prevClose) * 100 : 0;
              }
            } catch (e) {
              log.warn('pre_close.prev_close_fetch_failed', { symbol, date: targetEtDate, error: String((e as any)?.message || e) });
            }
          }
          // Derive human-readable intraday time in America/New_York from io
          const it = io != null && Number.isFinite(io)
            ? new Intl.DateTimeFormat('en-US', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'America/New_York' }).format(new Date(io))
            : undefined;
          const patchIntraday: Partial<CompactBar> = {
            ip: ip != null ? Number(ip) : undefined,
            io: io != null ? Number(io) : undefined,
            it,
            ic, // required nullable
            ipc, // required nullable
          };
          await upsertAvDailyBar({ symbol: symbol!, date: targetEtDate, patch: patchIntraday, skipParentMetaBump: true });
          // Return early to avoid general OHLC patch on pre-close
          hr('aVTS.H', `pre-close intraday-only upsert ${endpoint} ${symbol} date=${targetEtDate} [${(this as any).requestId}]`);
          log.info('firestore.preclose_intraday_only', { endpointId: endpoint, symbol, date: targetEtDate });
          // Success response without further persistence
          hr('aVTS.H', `fetch ok ${endpoint} ${symbol ?? ''} ${(Date.now() - startTime)}ms [${(this as any).requestId}]`);
          log.info('fetch.success', { endpointId: endpoint, symbol, durationMs: Date.now() - startTime, requestId: (this as any).requestId });
          return this.createSuccessResponse(transformedData, this.config.ttl, startTime);
        }

        // Default compact (post-close or non-daily): enrich with pc/ch/cp and continue
        if (prevAdjClose != null) {
          const pc = prevAdjClose;
          const ch = latest.close - pc;
          const cp = pc !== 0 ? (ch / pc) * 100 : 0;
          latest.previousClose = pc as any;
          (latest as any).change = ch;
          (latest as any).changePercent = cp;
        }
        bars = [latest];
      }

      // Default: check write toggle (UI/gateway). Backend callers should pass __checkWriteToggle: false
      const checkWriteToggle: boolean = __checkWriteToggle !== false;

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
          switch (this.config.interval) {
            case TimeSeriesInterval.DAILY:
              await upsertAvDailyBar({ symbol, date: latest.date, patch });
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
                checkWriteToggle
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
            checkWriteToggle
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