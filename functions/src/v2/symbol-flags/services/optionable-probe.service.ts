/**
 * OptionableProbeService — the single seam for "does this symbol have a
 * listed options chain" (Thread #105 / PRD §80).
 *
 * `probe()` is pure retrieval: one HISTORICAL_OPTIONS call via the shared
 * retrieval service (no date → AV returns the most recent trading day's
 * chain). Non-empty `response.data` → optionable.
 *
 * `probeAndPersist()` additionally writes the flag fields to
 * tracked-symbols/{symbol} and applies the §76 defaults (optionsEnabled=false,
 * optionsEnabledHistory=[]) when absent — never clobbering an existing
 * optionsEnabled.
 *
 * Error policy (PRD §88 — never block ingestion on probe failure): quota /
 * rate-limit errors RETHROW so callers can abort without stamping a false
 * flag on ambiguous failures; all other errors persist optionable=false with
 * `optionableProbeError` recording why.
 *
 * Consumers: backfill-optionable.ts script (#138), on-add probe trigger
 * (#139), batch tooling.
 */
import { FieldValue, Timestamp } from 'firebase-admin/firestore';

import {
  AlphaVantageUpstreamError,
  AlphaVantageUpstreamErrorCategory,
} from '../../alpha-vantage/utils/av-upstream-error.utils';
import type { FirestoreLike } from '../../common/firestore/firestore-like';
import { FirestoreCollection } from '@shared/firestore';
import { TRACKED_SYMBOL_V2_FIELDS } from '@shared/alpha-vantage';

export interface OptionableProbeSummary {
  totalContracts?: number;
  totalVolume?: number;
  totalOpenInterest?: number;
  uniqueStrikes?: number;
  /** Count of distinct expiration dates in the probed chain. */
  expirations?: number;
}

export interface OptionableProbeResult {
  optionable: boolean;
  summary?: OptionableProbeSummary;
  /** Set (with optionable=false) when a non-quota probe failure was persisted. */
  error?: string;
}

/** Narrow seam over HistoricalOptionsRetrievalService.fetch. */
export interface OptionableRetrievalLike {
  fetch(params: { symbol: string }): Promise<{ response: { data?: unknown[] }; analysis: any }>;
}

export interface LoggerLike {
  info(message: string): void;
  warn(message: string): void;
}

export interface OptionableProbeDependencies {
  retrieval: OptionableRetrievalLike;
  db: FirestoreLike;
  logger?: LoggerLike;
}

/** AV returns 'Information' (not 'Note') for premium-gating and some quota messages. */
const QUOTA_MESSAGE = /rate limit|call frequency|premium|quota|daily (call|limit|quota)/i;

/**
 * True when an upstream failure means "stop the run", not "no options".
 * Duck-typed on `category` (not instanceof) so callers holding an error
 * serialized across module boundaries still abort correctly.
 */
export function isQuotaError(e: unknown): boolean {
  const cat = (e as AlphaVantageUpstreamError | undefined)?.category;
  if (cat === AlphaVantageUpstreamErrorCategory.RATE_LIMITED) return true;
  if (cat === AlphaVantageUpstreamErrorCategory.UPSTREAM_ERROR) {
    return QUOTA_MESSAGE.test((e as AlphaVantageUpstreamError).providerMessage ?? '');
  }
  return false;
}

function toSummaryFields(analysis: any): OptionableProbeSummary {
  const out: OptionableProbeSummary = {};
  const s = analysis?.summary;
  for (const k of ['totalContracts', 'totalVolume', 'totalOpenInterest', 'uniqueStrikes'] as const) {
    const v = s?.[k];
    if (typeof v === 'number' && Number.isFinite(v)) out[k] = v;
  }
  if (Array.isArray(analysis?.expirations)) out.expirations = analysis.expirations.length;
  return out;
}

export class OptionableProbeService {
  constructor(private readonly deps: OptionableProbeDependencies) {}

  /** Probe the latest options chain. Throws on provider failure. */
  async probe(symbol: string): Promise<OptionableProbeResult> {
    const normalized = symbol.trim().toUpperCase();
    if (!normalized) throw new Error('Symbol is required');
    const { response, analysis } = await this.deps.retrieval.fetch({ symbol: normalized });
    const data = Array.isArray(response?.data) ? response.data : [];
    return { optionable: data.length > 0, summary: toSummaryFields(analysis) };
  }

  /**
   * Probe + persist flag fields. Quota errors rethrow; other probe failures
   * persist optionable=false with the error message. Missing docs are not
   * created. persist() failures propagate unchanged — a db error is never
   * mislabeled as a probe failure.
   */
  async probeAndPersist(symbol: string): Promise<OptionableProbeResult> {
    const normalized = symbol.trim().toUpperCase();
    let result: OptionableProbeResult;
    try {
      result = await this.probe(normalized);
    } catch (e) {
      if (isQuotaError(e)) throw e;
      const error = e instanceof Error ? e.message : String(e);
      result = { optionable: false, error };
    }
    await this.persist(normalized, result);
    return result;
  }

  private async persist(symbol: string, result: OptionableProbeResult): Promise<void> {
    const F = TRACKED_SYMBOL_V2_FIELDS;
    const ref = this.deps.db.collection(FirestoreCollection.TRACKED_SYMBOLS).doc(symbol);
    const snap = await ref.get();
    if (!snap.exists) return;

    const payload: Record<string, unknown> = {
      [F.OPTIONABLE]: result.optionable,
      [F.OPTIONABLE_CHECKED_AT]: Timestamp.now(),
      // Clear the sibling field — a previous failure leaves a stale
      // optionableProbeError after success (and vice versa) otherwise.
      [F.OPTIONABLE_PROBE_ERROR]: result.error !== undefined ? result.error : FieldValue.delete(),
      [F.OPTIONABLE_PROBE_SUMMARY]: result.error !== undefined ? FieldValue.delete() : result.summary ?? {},
    };

    const data = snap.data() as Record<string, unknown> | undefined;
    if (data?.[F.OPTIONS_ENABLED] === undefined || data?.[F.OPTIONS_ENABLED] === null) {
      payload[F.OPTIONS_ENABLED] = false;
    }
    if (data?.[F.OPTIONS_ENABLED_HISTORY] === undefined || data?.[F.OPTIONS_ENABLED_HISTORY] === null) {
      payload[F.OPTIONS_ENABLED_HISTORY] = [];
    }

    // Read-modify-write: a curator flipping optionsEnabled between the get()
    // and this set() gets clobbered — narrow window, accepted (Documented in
    // IMPL §Risks); DocRefLike has no transaction surface.
    await ref.set(payload, { merge: true });
    this.deps.logger?.info(
      `optionable-probe: ${symbol} optionable=${result.optionable}` +
        (result.error ? ` error=${result.error}` : ` contracts=${result.summary?.totalContracts ?? 0}`),
    );
  }
}
