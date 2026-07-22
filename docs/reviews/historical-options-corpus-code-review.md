# Holistic Code Review — Historical Options Corpus / Retrieval Boundary

**Review date:** 2026-07-21  
**Skills applied:**
- `.devin/skills/thermo-nuclear-code-review.md`
- `C:\aa\projects\rel-str\.devin\skills\thermo-nuclear-code-review.md`
- `C:\aa\projects\rel-str\.devin\skills\code-review\SKILL.md` (regular two-axis code review: Standards + Spec)  
**Scope:** The full working-branch change set, including the new `functions/src/v2/historical-options-corpus/` module, the `AvHistoricalOptionsHandler` / partner / gateway refactor, the `getAlphaVantageApiKey` consolidation, and all supporting tests/docs.

## 1. Change-set inventory

- New code
  - `functions/src/v2/historical-options-corpus/` — `types.ts`, `index.ts`, `services/*.ts`, `handlers/corpus-seed.task.ts`
  - `functions/src/v2/historical-options-corpus/services/` — `av-throttle.service.ts`, `corpus-metadata.service.ts`, `corpus-planner.service.ts`, `corpus-seed.worker.ts`, `gcs-corpus-adapter.service.ts`, `historical-options-retrieval.service.ts`, `pilot.service.ts`, `strategy-reader.service.ts`, `trading-calendar.service.ts`
  - `functions/src/v2/alpha-vantage/utils/av-options-contract.utils.ts`
  - `functions/src/v2/alpha-vantage/utils/av-api-key.utils.ts`
- Modified code
  - `functions/src/v2/alpha-vantage/handlers/av-historical-options.handler.ts`
  - `functions/src/v2/alpha-vantage/handlers/alpha-vantage-base.handler.ts`
  - `functions/src/v2/alpha-vantage/utils/index.ts`
  - `functions/src/v2/utils/utils.ts` (`getAlphaVantageApiKey`)
  - `functions/tests/v2/historical-options-corpus/*.test.ts` (9 new test files)
  - `functions/tests/v2/alpha-vantage/utils/av-historical-options.test.ts`
  - `functions/tests/v2/alpha-vantage/utils/av-intraday-aggregate.test.ts`
  - `functions/tests/v2/partner/historical-options-partner.test.ts`
  - `functions/tests/v2/partner/historical-options-request.utils.test.ts`
  - `functions/jest.config.ts`, `functions/tsconfig.jest.json`, `functions/package.json`
  - `docs/partner/options-data/historical-options-prd.md`, `docs/partner/options-data/historical-options-retrieval-architecture.md`, `docs/partner/options-data/qqq-tqqq-options-corpus-implementation-plan.md`, `docs/project-plan/cloud-functions-architecture-remediation-plan.md`
- Build / test gate
  - `npm run test:compile` ✅
  - `npm test` ✅ (13 suites / 67 tests)
  - `git diff --check` ❌ — 4 test files have blank lines at EOF; multiple files emit LF/CRLF warnings.

## 2. Executive summary

The corpus implementation is mostly well-layered: retrieval, GCS, metadata, planner, worker, and pilot are separated, and tests cover the happy path plus several edge cases. However, the change set introduces a **second, parallel historical-options retrieval and normalization stack** that is not being used by the existing partner or gateway consumers. This is the single largest structural risk: it duplicates the AV contract-normalization code, leaves the handler in a half-migrated state, and leaves the legacy Firestore raw-chain writer still importable. A few correctness bugs (UTC trading calendar, stale `isCorpusSeedRetryable`, double throttling, `generatedAt` inside the integrity checksum, run-id collisions) need fixing before any production seed. A deployment/operational gap also exists: the task worker is not exported and the pilot cannot enqueue anything.

## 3. Contract matrix

| Concern | Retrieval service (`HistoricalOptionsRetrievalService`) | Handler (`AvHistoricalOptionsHandler`) | Partner handler | GCS corpus | Firestore metadata |
|---|---|---|---|---|---|
| **Input** | `{ symbol, date? }` | `Record<string, any>` via `fetch()` / `fetchWithoutPersistence()` | HTTP query `symbol`, `date` | `{ symbol, date, response, analysis }` / read `{ symbol, date }` | `{ runId, symbol, date, ... }` |
| **Authz** | None; caller supplies `apiKey` | None; handler reads secret | OIDC SA + audience | Admin SDK / runtime SA | Admin SDK |
| **Errors** | `AlphaVantageUpstreamError` (RATE_LIMITED, TIMEOUT, UPSTREAM_ERROR) | Raw `Error` from `fetch()`; `AlphaVantageUpstreamError` from `fetchWithoutPersistence()` | `HistoricalOptionsErrorCode` + HTTP status | `GcsCorpusWriteError`; read returns `CORRUPT`/`NOT_FOUND` | Throws Firestore errors |
| **Response schema** | `{ response: AvHistoricalOptionsResponse, analysis: SvtOptionsAnalysis }` | `ApiResponse<AvHistoricalOptionsResponse>` or raw `AvHistoricalOptionsResponse` | `{ ok, symbol, date, source, endpoint, data, analysis, ... }` | `GcsWriteResult` / `CorpusReadResult` | n/a |
| **Side effects** | None (pure retrieval) | `fetch()` no longer writes (legacy call removed) | None | Conditional write to GCS | Writes run/item metadata |
| **Observability** | None | `console.log` heavy | Structured JSON logs | Worker `console.log` | n/a |

**Mismatch:** the retrieval service and the handler normalize the same contract shape differently; partner/gateway do **not** consume the retrieval service, so there are in fact two normalization paths and no guarantee of parity.

## 4. Findings (prioritized)

### 4.1 Structural / architectural regressions

#### 1. Two parallel retrieval/normalization stacks (highest priority)
- `historical-options-retrieval.service.ts` builds its own AV request, has its own `normalizeContract()` private method, and calls `analyzeOptions()`.
- `av-options-contract.utils.ts` exports an identical `normalizeAvOptionContract()` helper.
- `AvHistoricalOptionsHandler` still has `fetch()` and `fetchWithoutPersistence()` that do the same request assembly and normalization themselves.
- The partner handler and the browser gateway still go through the handler, while the corpus uses the new retrieval service. The two paths can drift.
- **Required fix:** Make `HistoricalOptionsRetrievalService` the canonical retrieval seam. Have the handler delegate to it (or delete the handler entirely after migrating callers). Have `historical-options-retrieval.service.ts` reuse the shared `normalizeAvOptionContract()` from `av-options-contract.utils.ts` so normalization lives in one place.
- **Impact:** Eliminates duplication, guarantees partner/gateway/corpus parity, and finally fulfills the PRD/architecture requirement of one retrieval module.

#### 2. Handler still exposes `fetch()` / `fetchWithoutPersistence()` ambiguity
- `av-historical-options.handler.ts` retains two public methods. `fetch()` returns `ApiResponse`, `fetchWithoutPersistence()` returns raw data and converts errors to `AlphaVantageUpstreamError`.
- The partner handler depends on `fetchWithoutPersistence()`; the gateway uses `fetch()`. The legacy `saveAvHistoricalOptions` call is gone from `fetch()`, but the method split remains.
- **Required fix:** Collapse to a single retrieval call. If backward compatibility is needed temporarily, make `fetch()` and `fetchWithoutPersistence()` thin delegates to `HistoricalOptionsRetrievalService.fetch()`. Do not keep divergent request/transport code.

#### 3. Legacy Firestore raw-chain writer is still exported and reachable
- `functions/src/v2/alpha-vantage/firestore/av-options-firestore-helper.ts` (filename also violates the writer naming rule) still exports `saveAvHistoricalOptions`/`saveOptionsData` and is re-exported from `firestore/index.ts`.
- Nothing in this change set should be writing raw option chains to Firestore, but the code remains a single import away.
- **Required fix:** Remove the public re-export from `firestore/index.ts` and/or move the legacy writer to an `_obsolete/` or `_disabled/` path. If it must stay temporarily, place it behind an explicit feature flag that defaults to off and add a comment with the removal milestone.

### 4.2 Correctness bugs

#### 4. `TradingCalendarService` computes US holidays in UTC, producing wrong observed dates
- `getHolidayDatesForYear` builds holiday dates with `new Date(Date.UTC(year, month-1, day))` and then uses `getUTCDay()` for Saturday/Sunday observed shifts and for `getNthWeekdayOfMonth`/`getLastWeekdayOfMonth`.
- US market holidays are defined in America/New_York. For dates near the year boundary or the 1st of a month, UTC day-of-week can differ from ET day-of-week (e.g., 2026-03-01 00:00 UTC is a Saturday in UTC but a Sunday in ET). This will shift holiday calculations and produce incorrect trading calendars.
- **Required fix:** Perform all calendar arithmetic in `America/New_York` (use `date-fns-tz`/`luxon` or a stable rule library), or at least compute weekday from the ET local date string.
- **Impact:** Wrong holiday closure dates mean the corpus will attempt to fetch data on market holidays or skip valid trading days.

#### 5. `isCorpusSeedRetryable` is defined but never used
- `corpus-seed.worker.ts` exports `isCorpusSeedRetryable()` but the `seedCorpusItem` catch block retries **every** error up to `MAX_CORPUS_SEED_ATTEMPTS`.
- Malformed payloads, client errors (e.g. invalid symbol), and permanent GCS write failures will be retried 3 times, wasting quota and delaying the final failure state.
- **Required fix:** Call `isCorpusSeedRetryable(error)` in the catch block. If not retryable, immediately mark `permanent_failure` and increment failed count. Add tests for `isCorpusSeedRetryable` and for non-retryable errors becoming permanent failures.

#### 6. Double throttling in the seed worker
- `corpus-seed.task.ts` creates a `HistoricalOptionsRetrievalService` with `throttle: getDefaultAvThrottle()`.
- `HistoricalOptionsRetrievalService.fetch()` calls `this.deps.throttle.wait()`.
- `seedCorpusItem()` also calls `await deps.throttle.wait()` before `retrieval.fetch()`.
- The two throttle objects are **independent instances** of `FixedIntervalAvThrottle`, so each call waits twice (≈2 seconds at 60 req/min), and the two instances do not share state, breaking the rate-limit goal.
- **Required fix:** Remove the worker-level `throttle` wait and let the retrieval service own the single throttle. Alternatively inject one shared `AvThrottle` instance into both, but the simplest fix is to make `seedCorpusItem` not throttle and rely on the retrieval service it already calls. Update tests accordingly.

#### 7. GCS `writeItem` returns local checksum on `alreadyExists`, and does not record object generation
- On `error?.code === 412`, `writeItem` returns `{ gcsPath, bytes, sha256, alreadyExists: true }` where `bytes` and `sha256` are from the *local* payload that was **not** written. If a different payload somehow existed, the metadata would record the wrong checksum.
- The `GcsWriteResult` does not include the GCS generation number, and `setItemSuccess` does not persist it, contrary to the implementation plan.
- **Required fix:** On `alreadyExists`, read the existing object's metadata to obtain the actual `sha256` (stored in custom metadata) and `generation`, and return those. Include `generation` in `GcsWriteResult` and store it in Firestore metadata.

#### 8. `generatedAt` is included in the checksum payload
- `gcs-corpus-adapter.service.ts` `buildEnvelope` adds `generatedAt: new Date().toISOString()` before computing `sha256`. Two semantically identical fetches at different times will have different checksums.
- For immutable historical data, the integrity value should be over the immutable provider/normalized content, symbol, date, and schema version — not the wall-clock write time.
- **Required fix:** Move `generatedAt` outside the integrity payload, or compute the checksum on a canonical object that excludes it. Update `verifyEnvelope` accordingly.

#### 9. Planner `runId` is not stable across `maxTradingDatesPerSymbol` or `dryRun` changes
- `generateRunId` uses `symbols`, `startDate`, `endDate`, `pilot`. It omits `maxTradingDatesPerSymbol` and `dryRun`.
- Calling `planCorpusRun` with `maxTradingDatesPerSymbol=20` then `maxTradingDatesPerSymbol=40` (without an explicit `runId`) will return the first plan due to `getRunDoc` idempotency, even though the second request asked for a different manifest.
- **Required fix:** Include `maxTradingDatesPerSymbol` in the generated `runId`. Also consider including `dryRun` so dry-run and live runs do not collide. Or reject/conflict when an existing plan differs from requested parameters.

### 4.3 Boundary / abstraction issues

#### 10. `HistoricalOptionsPilotService` requires a `retrieval` dependency it never uses
- `PilotDependencies` and `createHistoricalOptionsPilotService` instantiate `createHistoricalOptionsRetrievalService()`, which calls `getAlphaVantageApiKey()` at construction.
- `pilot.service.ts` `run()` never calls `deps.retrieval.fetch()`; dry-run pilots can therefore fail at construction due to a missing AV key even though no AV call is made.
- **Required fix:** Make `retrieval` optional in `PilotDependencies` and do not instantiate it in `createHistoricalOptionsPilotService` unless it will be used.

#### 11. The corpus task worker is not exported and the pilot cannot enqueue tasks
- `corpus-seed.task.ts` exports `processHistoricalOptionsCorpusSeedTask` but it is not re-exported from `functions/src/index.ts`.
- `createHistoricalOptionsPilotService` sets `enqueueTask` to a function that always throws (`Pilot execute not wired to a Cloud Tasks queue in this context`).
- **Required fix:** Add the task queue export and a real `enqueueTask` implementation (or a temporary admin HTTP trigger) before the pilot `execute` mode can run. Document the decision in the implementation plan.

#### 12. `GcsCorpusAdapter.readItem` downloads full objects just to check existence
- `seedCorpusItem` uses `readItem` to decide whether to skip. `readItem` downloads, gunzips, parses, and verifies the envelope for every present item.
- For an idempotency check, `getMetadata()` with the stored `sha256` in custom metadata is cheaper and sufficient. Full validation can happen only when the object is actually read for strategy use.
- **Required fix:** Add a `getMetadata` path to `GcsCorpusAdapter` and use it for skip checks. Reserve `readItem` for strategy reads.

### 4.4 Smaller but material issues

#### 13. `AvHistoricalOptionsHandler.normalizeContract` is an unnecessary wrapper
- `normalizeContract(contract) { return normalizeAvOptionContract(contract); }` adds no value. If retrieval is centralized, this disappears.

#### 14. Missing environment documentation
- `env.functions-sample` does not mention `OPTIONS_CORPUS_BUCKET` or `ALPHAVANTAGE_MIN_INTERVAL_MS`.
- **Required fix:** Add both to `env.functions-sample` with comments explaining that `OPTIONS_CORPUS_BUCKET` is required for corpus workers and `ALPHAVANTAGE_MIN_INTERVAL_MS` overrides the default 1000 ms throttle.

#### 15. `git diff --check` failures
- Four converted test files have trailing blank lines at EOF.
- Several files will have LF replaced by CRLF; configure `.gitattributes` or normalize line endings.
- **Required fix:** Remove trailing blank lines and run `git diff --check` to clean.

#### 16. `AvHistoricalOptionsHandler.fetch()` returns `ApiResponse` but sets `endpoint` to `AlphaVantageEndpoint.HISTORICAL_OPTIONS` (value `"Historical Options"`) while `HistoricalOptionsRetrievalService` sets `endpoint: 'HISTORICAL_OPTIONS'`. This is a contract drift between the two paths.
- **Required fix:** Centralize response construction so the `endpoint`/`message` values are identical.

## 5. Consolidated task list for fixes

| # | Task | Owner module(s) | Verification |
|---|---|---|---|
| 1 | Consolidate retrieval: make `HistoricalOptionsRetrievalService` the canonical seam; have handler/partner/gateway delegate to it. | `historical-options-retrieval.service.ts`, `av-historical-options.handler.ts`, `historical-options-partner.ts`, `alpha-vantage-gateway.ts` | Partner + gateway tests pass unchanged; corpus tests pass; no `fetch()`/`fetchWithoutPersistence()` duplication |
| 2 | Remove duplication between `normalizeAvOptionContract` and `normalizeContract` in retrieval service; use the shared utility. | `historical-options-retrieval.service.ts`, `av-options-contract.utils.ts` | Retrieval tests pass; no duplicated normalization logic |
| 3 | Remove or quarantine legacy `saveAvHistoricalOptions` re-export. | `firestore/index.ts`, `av-options-firestore-helper.ts` | `grep -R saveAvHistoricalOptions` only shows the definition and `_obsolete`/`_disabled` references |
| 4 | Rewrite `TradingCalendarService` to compute holidays in `America/New_York`. | `trading-calendar.service.ts` | Tests cover year-boundary and 1st-of-month cases that previously failed in UTC |
| 5 | Wire `isCorpusSeedRetryable` into `seedCorpusItem` and add non-retryable failure tests. | `corpus-seed.worker.ts`, `corpus-seed.worker.test.ts` | Non-retryable errors become `permanent_failure` immediately |
| 6 | Remove double throttle in seed worker; use one shared `AvThrottle` instance. | `corpus-seed.task.ts`, `corpus-seed.worker.ts`, `av-throttle.service.ts` | Worker test still passes; a single `wait()` occurs per AV request |
| 7 | On GCS 412, read actual stored metadata/generation and include `generation` in `GcsWriteResult`; store generation in Firestore. | `gcs-corpus-adapter.service.ts`, `corpus-metadata.service.ts`, `corpus-seed.worker.ts` | GCS adapter test asserts `generation` is returned and stored |
| 8 | Move `generatedAt` out of the integrity checksum payload. | `gcs-corpus-adapter.service.ts` | Round-trip and tamper tests pass; same AV payload always has same checksum regardless of write time |
| 9 | Include `maxTradingDatesPerSymbol` (and `dryRun`) in generated `runId`. | `corpus-planner.service.ts`, `pilot.service.ts` | Planner tests show distinct IDs for different max-date values |
| 10 | Make `retrieval` optional in `PilotDependencies`; do not instantiate it for dry-run. | `pilot.service.ts` | Pilot dry-run test runs without `ALPHAVANTAGE_API_KEY` set |
| 11 | Export `processHistoricalOptionsCorpusSeedTask` and wire pilot `enqueueTask` to the Cloud Tasks queue. | `functions/src/index.ts`, `corpus-seed.task.ts`, `pilot.service.ts` | A pilot `execute` run dispatches tasks; task worker is deployed |
| 12 | Add `GcsCorpusAdapter.getMetadata` and use it for existence/skip checks. | `gcs-corpus-adapter.service.ts`, `corpus-seed.worker.ts` | Skip check does not download full object |
| 13 | Add `OPTIONS_CORPUS_BUCKET` and `ALPHAVANTAGE_MIN_INTERVAL_MS` to `env.functions-sample`. | `env.functions-sample` | Sample env is up to date |
| 14 | Fix `git diff --check` EOF blank lines and line-ending warnings. | affected test files, `.gitattributes` | `git diff --check` passes with no errors |
| 15 | Align `endpoint` / `message` values between handler and retrieval service. | `historical-options-retrieval.service.ts` | Partner/gateway response contracts unchanged |
| 16 | Delete `AvHistoricalOptionsHandler.normalizeContract` wrapper if handler is retained. | `av-historical-options.handler.ts` | n/a |

## 6. Two-axis review (regular code-review skill)

**Fixed point:** `origin/prod` (remote default branch; `remotes/origin/HEAD -> origin/prod`).
**Diff command:** `git diff origin/prod...HEAD` for the committed changes, plus working-tree and untracked files in `functions/src/v2/historical-options-corpus/`.
**Commits since fixed point:**
- `f26e266` DOCS-PARTNER-HISTORICAL-OPTIONS: document contract, review, and deployment
- `b48a125` BE-TEST-PARTNER-HISTORICAL-OPTIONS: cover endpoint and provider behavior
- `96b8800` BE-FEAT-PARTNER-HISTORICAL-OPTIONS: add authenticated no-persistence proxy

### 6.1 Standards axis

**Standards sources:** `.devin/rules/project-rules.md`, `docs/project-plan/cloud-functions-architecture-remediation-plan.md`.

| Smell / standard | Location | Finding |
|---|---|---|
| **Duplicated Code** | `historical-options-retrieval.service.ts` vs `av-options-contract.utils.ts` | `normalizeContract()` duplicates `normalizeAvOptionContract()`. Request assembly also duplicates `AvHistoricalOptionsHandler.prepareRequestParams()`. |
| **Middle Man** | `av-historical-options.handler.ts`, `av-api-key.utils.ts` | `normalizeContract()` just forwards to the shared utility. `av-api-key.utils.ts` is a one-line re-export of `utils.ts`. |
| **Speculative Generality** | `pilot.service.ts`, `gcs-corpus-adapter.service.ts`, `corpus-seed.worker.ts` | `PilotDependencies.retrieval` is required but `run()` never uses it. `GcsCorpusAdapter.exists()` is defined but unused. `isCorpusSeedRetryable()` is exported but not called. |
| **Primitive Obsession** | `types.ts`, `corpus-planner.service.ts` | `CorpusRunDoc.manifest: Record<string, unknown>` is empty/untyped. `runId` is built by ad-hoc string concatenation and omits `maxTradingDatesPerSymbol`/`dryRun`. |
| **Naming convention** | `av-options-firestore-helper.ts` | The `-helper.ts` filename violates the `Never name a file {domain}-helper.ts` rule; it is also still re-exported from `firestore/index.ts`. |
| **File-size rule** | all new files | New files are under 500 lines; compliant. |

### 6.2 Spec axis

**Spec sources:** `docs/partner/options-data/historical-options-prd.md`, `docs/partner/options-data/qqq-tqqq-options-corpus-implementation-plan.md`, `docs/partner/options-data/historical-options-retrieval-architecture.md`, `docs/project-plan/cloud-functions-architecture-remediation-plan.md`.

| Spec requirement | Source | Finding |
|---|---|---|
| One canonical retrieval module used by partner and gateway | `historical-options-retrieval-architecture.md` §5, `cloud-functions-architecture-remediation-plan.md` Workstream E | **Missing** — `HistoricalOptionsRetrievalService` is used only by the corpus; partner/gateway still call `AvHistoricalOptionsHandler.fetch()` / `fetchWithoutPersistence()`. |
| GCS metadata record includes generation, compressed/uncompressed bytes, schema version | `qqq-tqqq-options-corpus-implementation-plan.md` §5.3, §6.2 | **Partial** — `CorpusItemDoc` stores `gcsPath`, `sha256`, `bytes`, `apiCalls`; it does not store `generation`, uncompressed bytes, or `schemaVersion`. |
| Classify outcomes as retryable/terminal | `qqq-tqqq-options-corpus-implementation-plan.md` §4.4, §10 | **Partial** — `isCorpusSeedRetryable()` exists but `seedCorpusItem()` retries every error. |
| Explicit repair mode for overwriting validated objects | `qqq-tqqq-options-corpus-implementation-plan.md` §5.3 | **Missing** — no repair mode exists; normal writes use `ifGenerationMatch: 0` only. |
| Exported Cloud Tasks worker and a pilot that can dispatch tasks | `qqq-tqqq-options-corpus-implementation-plan.md` §4.4, §7 | **Missing** — `processHistoricalOptionsCorpusSeedTask` is not exported and `createHistoricalOptionsPilotService` `enqueueTask` throws. |
| Shared provider throttle used by the seed | `qqq-tqqq-options-corpus-implementation-plan.md` §3, §4.4 | **Partial** — a shared `AvThrottle` exists, but the worker and retrieval service each call independent `FixedIntervalAvThrottle` instances, causing double waits. |
| No raw options chain written to Firestore | `historical-options-prd.md` §4 | **Pass** — the handler no longer calls `saveAvHistoricalOptions`; the retrieval service has no Firestore dependency. |
| Throttle rate at or below 50% of the contracted limit | `qqq-tqqq-options-corpus-implementation-plan.md` §8.2 | **Override** — PRD suggests 50 req/min; user explicitly set `DEFAULT_ALPHAVANTAGE_INTERVAL_MS` to 1000ms (60 req/min) because the account limit is 75 req/min. Documented as an approved user decision. |

## 7. Approval gate

Do not consider this change set ready to merge until:

- Tasks **1, 4, 5, 6, 7, 8, 9** are resolved (structural correctness and data integrity).
- `git diff --check` is clean.
- `npm run test:compile` and `npm test` pass after fixes.
- The legacy Firestore raw-chain writer is no longer reachable from public exports.
- The task queue is exported/wired so the pilot `execute` mode can actually run.

Deployment-only prerequisites (can be tracked separately but should not be deferred silently):

- Alpha Vantage plan confirmation for ~3,800 `HISTORICAL_OPTIONS` calls, retention, and intended use.
- `OPTIONS_CORPUS_BUCKET` exists with private access, retention/lifecycle rules, and IAM bound to the worker SA.
- Cloud Tasks queue `processHistoricalOptionsCorpusSeedTask` is deployed with the intended region and rate limits.

## 8. Re-review findings (2026-07-21)

A second pass was run after the original 16 fixes were applied. Fixed point: `origin/prod` plus all current working-tree changes.

### 8.1 Gate status

- `npm run test:compile` ✅
- `npm test` ✅ (13 suites / 71 tests)
- `git diff --check` ✅

### 8.2 Original 16 findings — current status

| # | Finding | Status | Notes |
|---|---|---|---|
| 1 | Canonical retrieval seam | ✅ Partially | `AvHistoricalOptionsHandler` delegates to `HistoricalOptionsRetrievalService`; partner/gateway still go through the handler. |
| 2 | Remove normalization duplication | ✅ | `normalizeContract` wrapper gone; retrieval uses `normalizeAvOptionContract`. |
| 3 | Quarantine legacy writer | ✅ | `firestore/index.ts` no longer re-exports `saveAvHistoricalOptions`; file still exists but is unreachable. |
| 4 | ET holiday calendar | ✅ Mostly | `TradingCalendarService` computes day-of-week in ET; DST spot check passed. |
| 5 | Wire `isCorpusSeedRetryable` | ✅ | Used in `seedCorpusItem`; tests cover non-retryable failures. |
| 6 | Remove double throttle | ✅ | Worker no longer throttles; retrieval in `corpus-seed.task.ts` owns `getDefaultAvThrottle()`. |
| 7 | GCS 412 reads stored metadata | ✅ | `loadStoredWriteResult` returns stored `generation`/`sha256`; stored in Firestore. |
| 8 | `generatedAt` out of checksum | ✅ | Checksum computed on payload; `verifyEnvelope` strips `generatedAt`. |
| 9 | `runId` includes params | ✅ | `generateRunId` adds `md<N>`, `dry`, and `-pilot`. |
| 10 | Optional `retrieval` in pilot | ✅ | `PilotDependencies.retrieval` is optional; factory omits it. |
| 11 | Export seed task / wire pilot | ✅ | `index.ts` exports `processHistoricalOptionsCorpusSeedTask`; pilot dispatches to the queue. |
| 12 | `getMetadata` for skip checks | ✅ | Used by `seedCorpusItem` and `pilot.service.ts`. |
| 13 | Env sample | ✅ | `OPTIONS_CORPUS_BUCKET` and `ALPHAVANTAGE_MIN_INTERVAL_MS` documented. |
| 14 | `git diff --check` | ✅ | Clean. |
| 15 | Endpoint/message alignment | ⚠️ Partial | `data.endpoint` falls back to `''` if AV omits it, while `metadata.endpoint` is `HISTORICAL_OPTIONS`. |
| 16 | Delete handler `normalizeContract` | ✅ | Removed. |

### 8.3 New missed opportunities / issues

#### High-priority correctness

1. **`pilot.service.ts` `yesterday()` uses UTC instead of America/New_York**  
   `functions/src/v2/historical-options-corpus/services/pilot.service.ts` lines 154-158. After 9pm ET, UTC is already tomorrow, so the default reference date can be one ET trading day off.  
   **Fix:** Compute yesterday in `America/New_York`.

2. **`HistoricalOptionsRetrievalService.transformResponse` defaults `endpoint` to `''`**  
   `functions/src/v2/historical-options-corpus/services/historical-options-retrieval.service.ts` line 95. If the AV payload omits `endpoint`, `data.endpoint` becomes `''`, diverging from `metadata.endpoint` and the partner top-level `endpoint`.  
   **Fix:** Default to `'HISTORICAL_OPTIONS'`.

3. **Partner routes through `AvHistoricalOptionsHandler` and recomputes analysis**  
   `functions/src/v2/partner/historical-options-partner.ts` calls `AlphaVantageHandlerFactory.createHandler(...).fetchWithoutPersistence()` and then `analyzeOptions(data.data)`. The retrieval service already returns `{ response, analysis }`, so the handler wrapper adds no value and forces a second analysis pass.  
   **Fix:** Have `fetchOptions` create `HistoricalOptionsRetrievalService` directly and reuse the returned `analysis`.

#### Medium-priority code-quality

4. **Stale comment in `corpus-seed.task.ts`**  
   Lines 43-45 claim the task worker is "intentionally not exported," but `functions/src/index.ts` line 131 exports it. Update or remove the comment.

5. **`AvHistoricalOptionsHandler` raw `console.log` banners**  
   `functions/src/v2/alpha-vantage/handlers/av-historical-options.handler.ts` lines 39 and 58 emit `========== START/END ...` via `console.log`. Replace with the base handler's structured logger or remove.

6. **`av-api-key.utils.ts` is a one-line re-export**  
   `functions/src/v2/alpha-vantage/utils/av-api-key.utils.ts` re-exports `getAlphaVantageApiKey` from `v2/utils/utils.ts`. It is a middleman; import from the canonical location instead and drop the file from the barrel.

7. **`strategy-reader.service.ts` is a pass-through wrapper**  
   It adds no behavior beyond `gcs.readItem`. Remove it and call `readItem` directly.

8. **`GcsCorpusAdapter.exists` is dead code**  
   `exists()` is never called; `getMetadata` already covers the use case. Remove to reduce surface area.

9. **`CorpusRunDoc.manifest` is untyped and always empty**  
   `functions/src/v2/historical-options-corpus/types.ts` and `corpus-metadata.service.ts` set `manifest: {}` typed as `Record<string, unknown>`. Either remove the field or give it a real type.

#### Lower-priority / test gaps

10. `corpus-seed.task.ts` uses a `console.log` logger instead of `createLogger`.
11. `corpus-planner.service.test.ts` does not assert `runId` includes `maxTradingDatesPerSymbol`/`dryRun`.
12. `gcs-corpus-adapter.service.test.ts` does not directly test `getMetadata`.
13. `pilot.service.test.ts` does not cover `yesterday()` ET behavior or factory's omission of `retrieval`.

### 8.4 Updated contract matrix

| Concern | Retrieval service | Handler | Partner | GCS corpus | Firestore metadata |
|---|---|---|---|---|---|
| **Input** | `{ symbol, date? }` | `Record<string, any>` | HTTP `symbol`, `date` | `{ symbol, date, response, analysis }` | `{ runId, symbol, date, ... }` |
| **Throttle** | `AvThrottle` (configurable) | none | none | n/a | n/a |
| **Errors** | `AlphaVantageUpstreamError` | rethrows / re-converts | `HistoricalOptionsErrorCode` + status | `GcsCorpusWriteError` | Firestore errors |
| **Response schema** | `{ response, analysis }` | `ApiResponse<AvHistoricalOptionsResponse>` | `{ ok, symbol, date, source, endpoint, data, analysis, ... }` | `GcsWriteResult` / `CorpusReadResult` | n/a |
| **Side effects** | None | None | None | Conditional GCS write | Metadata writes |
| **Observability** | None | `console.log` | Structured JSON logs | `console.log` | n/a |

### 8.5 Readiness assessment

The original 16 fixes are implemented and the gate checks pass. The remaining high-priority items (UTC `yesterday()`, `data.endpoint` normalization, partner using retrieval directly) are real correctness/quality gaps that should be addressed before the pilot is run or the partner path is considered final. Medium-priority clean-up removes middlemen and dead code.

### 8.6 Recommended next actions

1. Fix `pilot.service.ts` `yesterday()` to use `America/New_York`.
2. Default `endpoint` to `'HISTORICAL_OPTIONS'` in `HistoricalOptionsRetrievalService.transformResponse`.
3. Route partner directly through `HistoricalOptionsRetrievalService` and reuse `analysis`.
4. Update/remove the stale `corpus-seed.task.ts` comment.
5. Replace handler `console.log` banners with structured logging.
6. Remove `av-api-key.utils.ts` and import `getAlphaVantageApiKey` from `v2/utils/utils.ts`.
7. Remove `GcsCorpusAdapter.exists` and `strategy-reader.service.ts` (or keep with explicit justification).
8. Remove or type `CorpusRunDoc.manifest`.
9. Add tests for DST/year-boundary calendar, `runId` generation, `getMetadata`, and `yesterday()`.

Re-verify with `npm run test:compile`, `npm test`, and `git diff --check`.
