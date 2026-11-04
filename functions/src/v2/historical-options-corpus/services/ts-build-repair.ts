import type { TsBuildPayload } from '../handlers/ts-build.task';

/**
 * Pure helpers for the ts-build repair pass (Task #229).
 *
 * During the 2026 backfill drain, per-contract GCS failures were caught and
 * counted (`failedContracts`) but the task still succeeded, so nothing
 * re-ran them. The audit trail lives in `builder.symbol.done` log entries
 * (structured `createLogger` output → Cloud Logging `jsonPayload`), which
 * carry the full `TimeSeriesBuildReport` including the per-contract
 * `errors` list. These helpers turn parsed log entries into the failed
 * (symbol, range) tasks to re-enqueue and the explicit unhealed report.
 */

/** A `builder.symbol.done` log entry whose report has failures worth repairing. */
export interface FailedTsBuild {
  symbol: string;
  startDate: string;
  endDate: string;
  /** Highest `failedContracts` seen for this (symbol, range) — errors may be truncated in logs. */
  failedContracts: number;
  /** Per-contract errors, unioned across duplicate events for the same range. */
  errors: Array<{ contractID: string; error: string }>;
}

const DONE_EVENT = 'builder.symbol.done';

interface ReportShape {
  symbol?: unknown;
  startDate?: unknown;
  endDate?: unknown;
  failedContracts?: unknown;
  errors?: unknown;
}

function asErrorList(raw: unknown): Array<{ contractID: string; error: string }> {
  if (!Array.isArray(raw)) return [];
  const out: Array<{ contractID: string; error: string }> = [];
  for (const e of raw) {
    if (e && typeof e === 'object') {
      const { contractID, error } = e as { contractID?: unknown; error?: unknown };
      if (typeof contractID === 'string' && contractID) {
        out.push({ contractID, error: typeof error === 'string' ? error : String(error ?? '') });
      }
    }
  }
  return out;
}

/**
 * Extracts failed (symbol, range) build tasks from parsed
 * `builder.symbol.done` log entries. The same range can appear multiple
 * times (continuation tasks overlap; a task may retry) — duplicates merge
 * into one entry keyed on (symbol, startDate, endDate): `failedContracts`
 * keeps the max observed and `errors` unions by contractID (later wins).
 */
export function extractFailedBuilds(entries: unknown[]): FailedTsBuild[] {
  const byKey = new Map<string, FailedTsBuild>();

  for (const entry of entries) {
    if (!entry || typeof entry !== 'object') continue;
    const { event, report } = entry as { event?: unknown; report?: unknown };
    if (event !== DONE_EVENT || !report || typeof report !== 'object') continue;

    const r = report as ReportShape;
    const failedContracts = typeof r.failedContracts === 'number' ? r.failedContracts : 0;
    const symbol = typeof r.symbol === 'string' ? r.symbol.trim().toUpperCase() : '';
    const startDate = typeof r.startDate === 'string' ? r.startDate : '';
    const endDate = typeof r.endDate === 'string' ? r.endDate : '';
    if (failedContracts <= 0 || !symbol || !startDate || !endDate) continue;

    const key = `${symbol}|${startDate}|${endDate}`;
    const existing = byKey.get(key);
    if (!existing) {
      byKey.set(key, { symbol, startDate, endDate, failedContracts, errors: asErrorList(r.errors) });
      continue;
    }
    existing.failedContracts = Math.max(existing.failedContracts, failedContracts);
    for (const err of asErrorList(r.errors)) {
      const idx = existing.errors.findIndex((e) => e.contractID === err.contractID);
      if (idx >= 0) existing.errors[idx] = err;
      else existing.errors.push(err);
    }
  }

  return Array.from(byKey.values());
}

/**
 * Sorted, deduped payloads for `processHistoricalOptionsTsBuildTask`.
 * Re-enqueueing replays the task's full range; the builder's writeMerged
 * dedupes already-covered dates so the repair is idempotent and reads
 * GCS only — no AV calls.
 */
export function toRepairPayloads(builds: FailedTsBuild[]): TsBuildPayload[] {
  return builds
    .map((b) => ({ symbol: b.symbol, startDate: b.startDate, endDate: b.endDate }))
    .sort((a, b) => a.symbol.localeCompare(b.symbol) || a.startDate.localeCompare(b.startDate));
}

/**
 * The explicit post-pass triage list (AC4): every (symbol, contract, error)
 * that still needs healing, sorted for a stable report.
 */
export function flattenUnhealed(
  builds: FailedTsBuild[],
): Array<{ symbol: string; contractID: string; error: string }> {
  return builds
    .flatMap((b) => b.errors.map((e) => ({ symbol: b.symbol, contractID: e.contractID, error: e.error })))
    .sort((a, b) => a.symbol.localeCompare(b.symbol) || a.contractID.localeCompare(b.contractID));
}
