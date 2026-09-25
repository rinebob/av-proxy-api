**Topic:** Swing-driven options corpus platform  
**Topic Slug:** swing-driven-options-corpus  
**Thread:** Symbol flags curation  
**Thread Slug:** symbol-flags-curation  
**Issue:** #115  
**Thread Parent:** #105  
**Topic Parent:** #102  
**Domain:** OPTIONS-DATA  
**Type:** Implementation Plan (BE)  
**Status:** Draft  
**Created:** 2026-09-24  
**Last Updated:** 2026-09-24  

# Implementation Plan (BE) — Symbol flags curation

## Scope

Backend lifecycle for `optionable` / `optionsEnabled` on `tracked-symbols` docs. The shared fields, constants, Symbol Manager columns, and the `backfill-optionable.ts` probe script already exist (landed under Topic #88 Task #101). This plan refactors the probe into a reusable service, adds the ingestion/on-add/enable paths, the batch-enable script, and list filtering.

## Components

### 1. `OptionableProbeService`

New service (`functions/src/v2/symbol-flags/services/optionable-probe.service.ts`) — the single seam for "does this symbol have options":

```typescript
export interface OptionableProbeResult {
  optionable: boolean;
  summary: OptionableProbeSummary;  // finite-only subset + expirations count
}

export class OptionableProbeService {
  constructor(retrieval: HistoricalOptionsRetrievalService, logger?: LoggerLike) {}
  /** Fetch latest chain; optionable = response.data.length > 0. */
  probe(symbol: string): Promise<OptionableProbeResult>;
  /** Probe + write optionable/optionableCheckedAt/optionableProbeSummary. */
  probeAndPersist(symbol: string): Promise<OptionableProbeResult>;
}
```

- `probe()` wraps `HistoricalOptionsRetrievalService.fetch({symbol})` — no date param → AV returns the most recent trading day's chain.
- `toSummaryFields` logic (finite-guard + `expirations` count) moves here verbatim from the script.
- `probeAndPersist` does the `update()` with `optionable`, `optionableCheckedAt: serverTimestamp`, `optionableProbeSummary` — and patches `optionsEnabled:false`/`optionsEnabledHistory:[]` when absent (§76 default everywhere the flag machinery touches a doc).
- On probe failure: mark `optionable=false` + `optionableProbeError` message (PRD §88 — never block ingestion). `optionableProbeError` needs adding to the shared type + `TRACKED_SYMBOL_V2_FIELDS`.
- **Refactor:** `backfill-optionable.ts` calls `probeAndPersist` per symbol, keeping its CLI surface (dry-run/symbols/delay/limit/force, RATE_LIMITED+quota abort, resumable skip).

### 2. Ingestion defaults — `saveTrackedSymbol`

`saveTrackedSymbol` (v2/common/functions) currently `set(merge:true)`s the payload. Add: read the doc first; when the doc is new or the fields are absent, include `optionsEnabled:false` + `optionsEnabledHistory:[]` in the saved document. One extra read per save — acceptable at symbol-add rates. Existing enqueue-on-`optionsEnabled===true` (#126) stays — that's the enable-at-ingestion path.

### 3. On-add probe — `onDocumentUpdated` trigger

New Firestore trigger (`functions/src/v2/symbol-flags/triggers/on-symbol-ready.function.ts`): `onDocumentUpdated('tracked-symbols/{symbol}')` fires when `_onboardingStatus` transitions to `READY` and `optionable` is still absent → calls `probeAndPersist`. Early-returns on every other update. Single seam covering both READY paths (direct equity+overview-ok / non-equity in `on-symbol-added`, and the overview-retry task) — probes exactly once per symbol. Probe failure → `optionable=false` + `optionableProbeError`, never throws (don't retry-flap the trigger).

### 4. `setOptionsEnabledV2` callable

New callable (`functions/src/v2/symbol-flags/functions/set-options-enabled.function.ts`):

- Auth required (`request.auth`), consistent with `saveTrackedSymbol`.
- Args `{symbol, enabled, reason?}`; read doc; `enabled=true` requires `optionable===true` → else `failed-precondition` (`OPTIONS_NOT_OPTIONABLE`).
- On transition: `update()` sets `optionsEnabled`, appends `optionsEnabledHistory` entry `{enabled, changedBy: uid, changedAt: serverTimestamp, reason?}` via `FieldValue.arrayUnion`, bumps `_lastUpdated`.
- On `false→true`: `enqueueSwingSetGeneration(db, symbol)` (existing helper re-checks the flag; enqueue failure → warn, don't fail the call — sweep covers misses).
- No-op when flag already equals `enabled` (idempotent, still returns success).

### 5. Batch-enable script

`functions/scripts/admin/enable-options.ts` — `--symbols A,B --reason "..." [--dry-run]`: per symbol reads doc, skips non-optionable (reports), appends history entry (`changedBy: 'admin-script'`), sets `optionsEnabled=true`, enqueues `generateSwingSetsTask`. Reports enabled/skipped/not-optionable/errors.

### 6. List filtering

`listSymbolsV2` + `partnerListTrackedSymbolsV2` accept `optionable` / `optionsEnabled` query params → equality filters on doc fields (no index needed — single-field equality on booleans). Response rows already carry the fields via `TrackedSymbolV2`.

### 7. Ops run

Full `backfill-optionable.ts` run on prod (~924 symbols, ~850ms spacing ≈ 15 min, resumable). Not code — an acceptance-gated ops task.

## Data contracts

Firestore doc additions (all landed in shared type except `optionableProbeError` — added by this Thread):

```
optionable?: boolean | null
optionsEnabled?: boolean            // default false
optionableCheckedAt?: Timestamp
optionableProbeSummary?: {totalContracts?, totalVolume?, totalOpenInterest?, uniqueStrikes?, expirations?}
optionableProbeError?: string       // set instead of summary on probe failure
optionsEnabledHistory?: {enabled, changedBy?, changedAt, reason?}[]
```

## Risks

- **Trigger loop**: the probe writes `optionable` → fires `onDocumentUpdated` again → early-return on `optionable` already set + no →READY transition. Verify the guard order (transition check first).
- **Quota**: on-add probes are 1 AV call per new symbol — negligible vs daily quota.
- **saveTrackedSymbol merge**: a re-save payload could clobber history if the caller echoes stale `optionsEnabledHistory` — defaults only apply when absent; the dedicated callable is the only governed toggle path (documented).
