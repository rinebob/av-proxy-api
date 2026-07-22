# Cloud Functions Architecture Remediation Plan

**Status:** Phase 0/1 partially implemented; Workstream E (historical-options retrieval separation) complete; remaining workstreams pending
**Scope:** V2 Cloud Functions architecture
**Last updated:** 2026-07-21

---

## 1. Purpose

This document consolidates every remediation identified in the 2026-07-21 Cloud Functions architecture review. It turns the findings into a sequenced, testable plan without changing product behavior unless a later phase explicitly says otherwise.

The plan uses the following design terms:

- A **module** owns one cohesive behavior.
- An **interface** is all information callers need to use the module correctly.
- A **seam** is where callers cross that interface.
- An **adapter** satisfies an interface where infrastructure varies.
- A **deep module** provides substantial behavior behind a small interface, increasing caller leverage and maintainer locality.

## 2. Objectives and Non-Goals

### Objectives

- Reduce oversized and mixed-concern modules.
- Make schedules, tasks, workers, persistence, and publication cross stable directory seams.
- Preserve deployed HTTP contracts, Cloud Function names, schedules, Firestore data, and partner event schemas unless an approved migration says otherwise.
- Make behavior testable through module interfaces instead of implementation internals.
- Preserve the successful Firestore writer decomposition as the standard for future backend modules.

### Non-Goals

- Rewrite every provider handler.
- Change Alpha Vantage or Benzinga business behavior merely for structure.
- Introduce a repository-wide abstraction without two real adapters.
- Enable historical-options persistence, caching, or a new partner contract.
- Replace already working Cloud Tasks pipelines in a single migration.

## 3. Baseline Assessment

### Strong existing patterns to retain

| Pattern | Evidence | Rule to preserve |
|---|---|---|
| Deploy composition root | `functions/src/index.ts` exports trigger modules | Keep deployment exports declarative; do not place runtime logic in the entry file. |
| Provider factory | `AlphaVantageHandlerFactory` selects handlers from endpoint configuration | Keep endpoint selection centralized. |
| Task adapter | `onTaskDispatched` wrappers delegate to internal workers | Keep trigger wrappers thin. |
| Firestore writer modules | `alpha-vantage/firestore/` has dedicated writers and a barrel | New Firestore I/O must use one `{domain}-{concern}.writer.ts` concern per file. |
| Partner HTTP dependency injection | `historicalOptionsPartnerHandler` accepts dependencies at its outer seam | Preserve this style when HTTP modules need controlled tests. |

### Required remediation inventory

| ID | Remediation | Priority | Prerequisite |
|---|---|---:|---|
| A1 | Split the catch-all `utils/utils.ts` module | High | None |
| A2 | Restore barrel seams for `jobs/`, `data-refresher/`, and `handlers/` | High | A1 is independent; can proceed in parallel |
| A3 | Deepen time-series run orchestration | High | A2 |
| A4 | Deepen completed-run publication | High | A3 interface agreed |
| A5 | Make historical-options retrieval pure and explicit | Medium | None | ✅ Implemented |
| A6 | Complete writer-boundary cleanup for historical options | Medium | A5 | ✅ Legacy writer quarantined; future persistence workflow deferred |
| A7 | Add architecture tests and guardrails | High | Each completed remediation |

## 4. Workstream A — Split Shared Utilities

### Finding

`functions/src/v2/utils/utils.ts` is a catch-all module. It mixes structured logging, human logging and timers, US market calendar logic, CORS behavior, dual authentication, Alpha Vantage key handling and fetch support, HTTP error responses, and formatting.

The module has multiple independent reasons to change. Its broad interface creates unnecessary coupling: a caller looking for one concern must learn unrelated behavior, and tests must import a module with multiple infrastructure assumptions.

### Target seams

| Target module | Interface responsibility | Adapter or implementation responsibility |
|---|---|---|
| `utils/logging.service.ts` | Create structured and human-readable loggers | JSON formatting, log-level filtering, timer state |
| `common/market-calendar.service.ts` | Determine market closure and date/holiday facts | NYSE holiday calendar and time-zone calculations |
| `utils/partner-auth.service.ts` | Authenticate partner callers and return normalized identity | Secret parsing, OIDC/Firebase verification, allowlist checks |
| `utils/http-response.utils.ts` | Apply shared HTTP response mechanics | CORS headers, OPTIONS handling, standard error envelopes where appropriate |
| `alpha-vantage/alpha-vantage-provider.service.ts` | Obtain AV credentials and perform shared provider transport only if more than one real caller needs it | API-key resolution, Axios transport, safe request logging |

Do not create a seam for a concern that has only one genuine implementation and no testing or replacement need. In that case, keep it local to its owning module.

### Prescribed fixes

1. Inventory imports from `utils/utils.ts` and assign each export to exactly one target module.
2. Move pure market-calendar logic first; retain compatibility re-exports only during migration.
3. Move logger construction and timer state as one cohesive logging module.
4. Move partner authentication with its secret/configuration dependencies as one module.
5. Move HTTP-specific behavior only after separating partner endpoint semantics from browser gateway semantics.
6. Remove compatibility re-exports after every caller imports the owning module directly.
7. Delete `utils/utils.ts`; do not rename it into another catch-all barrel.

### Acceptance criteria

- No replacement module exceeds one concern or imports unrelated runtime infrastructure.
- Auth, logging, market-calendar, and HTTP behavior have focused unit coverage.
- No callers import a generic `utils` catch-all module.
- Existing authentication and CORS behavior remains unchanged unless separately approved.

## 5. Workstream B — Restore Directory Seams

### Finding

The `firestore/` directory has an `index.ts` barrel and follows the project writer rules. Larger `jobs/`, `data-refresher/`, and `handlers/` directories lack equivalent directory interfaces, so callers import implementation files directly.

### Prescribed fixes

1. Add zero-logic `index.ts` barrels to `alpha-vantage/jobs/`, `alpha-vantage/data-refresher/`, and `alpha-vantage/handlers/`.
2. Re-export only supported public symbols. Do not export private helpers solely for convenience.
3. Update external consumers to import from the directory barrel.
4. Keep internal files within the same directory free to use relative imports when necessary to avoid circular dependency pressure.
5. Use a barrel only as a seam, not as an accumulation point for business logic.

### Acceptance criteria

- Every affected directory with more than two files has a barrel containing re-exports only.
- Consumers outside the directory no longer import individual writer, job, refresher, or handler files.
- TypeScript detects no circular imports or changed exports.

## 6. Workstream C — Deepen Time-Series Run Orchestration

### Finding

`av-refresh-manager.ts` and `av-time-series-refresh-manager.ts` are both over 1,500 lines and are recent change hot spots. Together they own schedule timing, market-date calculation, tracked-symbol ordering, run IDs, Firestore run documents, task enqueueing, provider refreshes, freshness decisions, retries, validation, remediation, health metrics, and partner publication.

The current module boundary is shallow: callers and maintainers need implementation knowledge to understand which manager owns a run lifecycle.

### Target module

Create a **time-series run module** with one request interface for a run:

- requested intervals;
- phase and trigger;
- market date and optional symbol subset;
- run mode such as scheduled, retry, or full backfill.

The module owns run creation, job planning, enqueueing policy, terminal aggregation input, and run completion decision. It returns a run outcome suitable for the next adapter. Schedules and HTTP/dev triggers become thin adapters that construct a request and invoke this interface.

### Internal modules behind the seam

| Module | Responsibility |
|---|---|
| Run planner | Resolve trading date, symbol set, order, intervals, and job definitions. |
| Run repository | Create/read/update run and job documents. |
| Task dispatcher | Enqueue known job payloads and enforce dispatch policy. |
| Freshness evaluator | Determine whether a job result is fresh, stale, or unknown. |
| Completion policy | Decide whether a run is complete, retryable, failed, or requires reconciliation. |
| Validation/remediation workflow | Execute daily validation and approved remediation after completion eligibility. |

### Prescribed fixes

1. Define the run request and outcome types before moving implementation.
2. Extract pure functions first: trading-date calculation, interval mapping, ordering, run ID construction, and job planning.
3. Extract Firestore run/job document access behind a repository module.
4. Move task enqueueing to a dispatcher module with no refresh or publication decisions.
5. Refactor schedule exports one at a time to call the run module.
6. Move post-run validation/remediation behind a completion-policy workflow.
7. Delete duplicate orchestration only after each existing schedule has migrated and behavior parity is verified.

### Acceptance criteria

- Each schedule wrapper states only its schedule configuration and run request.
- One module owns the state transition rules for a run.
- A test can plan a run, simulate job outcomes, and assert completion without Firestore, Cloud Tasks, or Alpha Vantage.
- Existing run IDs, job paths, schedule timing, and partner payloads remain compatible during migration.

## 7. Workstream D — Deepen Completed-Run Publication

### Finding

The intraday aggregator combines terminal-job accounting with local Pub/Sub delivery, cross-project delivery, credential diagnostics, debug-document persistence, and partner run state updates. These are separate reasons to change.

The system has multiple real delivery adapters: Firestore run state, local partner topic, and cross-project partner topic. This justifies a publication seam.

### Target module

Create a **completed-run publication module** that accepts one completed-run fact and owns:

- idempotency rules;
- payload construction;
- run status persistence;
- local delivery;
- optional cross-project delivery;
- durable failure reporting and retry policy.

Job aggregators remain responsible only for deriving a terminal run outcome.

### Prescribed fixes

1. Define a normalized completed-run event type that covers intraday, realtime, backfill, and partner completion cases where their semantics match.
2. Extract payload construction and run-state upsert from job aggregators.
3. Implement explicit local and cross-project publication adapters.
4. Replace inline cross-project credential diagnostics and debug writes with bounded, structured failure handling owned by the publication module.
5. Specify idempotency and partial-delivery behavior before changing production publishing.
6. Migrate intraday first, then realtime and backfill only after confirming their event semantics fit the same interface.

### Acceptance criteria

- Aggregators do not import Pub/Sub client libraries or construct partner payloads.
- A publication test proves the behavior for local success, cross-project failure, duplicate completion, and persistence failure.
- Each published event has a stable run ID and correlation information.
- A cross-project delivery failure does not falsely mark the entire run as successfully delivered.

## 8. Workstream E — Historical-Options Retrieval and Persistence Separation ✅ Complete

### Finding

`AvHistoricalOptionsHandler` historically had two public behaviors: `fetch()` retrieved, analyzed, and started an unawaited best-effort Firestore write, while `fetchWithoutPersistence()` retrieved and normalized only. A caller had to know which method avoided persistence.

### Prescribed fixes

1. Extract one historical-options retrieval module that returns normalized provider data and analysis without persistence — done (`HistoricalOptionsRetrievalService`).
2. Route the partner path through that retrieval interface — done.
3. Replace `fetch()` and `fetchWithoutPersistence()` with temporary compatibility adapters only while known callers migrate — `fetchWithoutPersistence()` removed; `AvHistoricalOptionsHandler.fetch()` is now a thin adapter for the browser gateway.
4. Move the legacy write behind an explicit persistence workflow that receives an existing retrieval result and returns an observable outcome — deferred to Phase 4 product decision.
5. Rename the legacy options Firestore file to conform to the writer convention — deferred with the persistence workflow.
6. Do not re-enable raw-chain Firestore storage; future cache/archive work needs a separately approved GCS-oriented adapter — enforced.

### Acceptance criteria

- Partner behavior, response contract, error mapping, and 10 MiB limit remain unchanged ✅
- Retrieval performs no Firestore or object-storage writes ✅
- Any persistence attempt is awaited and reports stored, skipped, or failed — deferred to future persistence workflow
- Tests prove retrieval parity and the partner route invokes no storage adapter ✅

See `docs/partner/options-data/historical-options-retrieval-architecture.md` for the detailed design and storage-specific criteria.

## 9. Workstream F — Guardrails and Verification

### Prescribed fixes

1. Add an architecture checklist to pull-request review for new Cloud Function modules:
   - one concern per file;
   - pre-implementation line-count check;
   - writer file naming;
   - barrel requirement for directories over two files;
   - no business logic in `index.ts`;
   - no external direct imports into a directory that provides a barrel.
2. Add module-level tests before moving behavior, then use them to verify no functional regression after extraction.
3. Add focused integration tests for each trigger seam: scheduler/request construction, task payload routing, and HTTP contract.
4. Run TypeScript compilation and the affected focused tests after each migration slice.
5. Use a one-module-at-a-time rollout; do not combine unrelated architectural migrations in one deployment.

### Required verification

```powershell
npx tsc --noEmit -p functions/tsconfig.json
npx tsc --noEmit -p functions/tests/tsconfig.json
```

Run the focused tests associated with the migrated module in addition to compilation. Do not mark a phase complete solely because the source tree compiles.

## 10. Sequencing

### Phase 0 — Stabilize interfaces

- Approve this plan.
- Add barrels for `jobs/`, `data-refresher/`, and `handlers/`.
- Create focused tests around current public behavior before moving it.

### Phase 1 — Low-risk locality improvements

- Split pure market-calendar and logging utilities — pending.
- Finish historical-options retrieval separation — complete.
- Rename/quarantine the options legacy writer without enabling a new storage target — complete; no ordinary retrieval can trigger the legacy Firestore write.

### Phase 2 — Run lifecycle extraction

- Extract time-series run planning and repository behavior.
- Extract task dispatching.
- Migrate one schedule wrapper at a time to the time-series run module.

### Phase 3 — Completion and publication

- Extract completion policy from job aggregators.
- Create the completed-run publication module.
- Migrate intraday publication first, then other compatible run types.

### Phase 4 — Deferred product decisions

- Approve or reject historical-options GCS caching/archive.
- Design and implement shared Alpha Vantage provider throttling.
- Remove compatibility adapters and legacy exports after callers have migrated.

## 11. Risks and Controls

| Risk | Control |
|---|---|
| Large refactor changes trading-day behavior | Move pure date logic first and test representative EST/EDT, holiday, weekend, and boundary cases. |
| Duplicate task enqueueing during migration | Preserve run IDs and introduce idempotent repository checks before moving scheduler wrappers. |
| Duplicate or missing partner events | Define publication idempotency before migrating aggregators; test repeated completion events. |
| Firestore schema drift | Preserve document paths and fields until a separately approved schema migration exists. |
| Storage regression for options chains | Keep raw-chain persistence disabled; do not introduce Firestore writes in retrieval. |
| Architecture churn without product benefit | Require each module move to state its external interface, change isolation, and verification plan. |

## 12. Completion Definition

This remediation plan is complete only when:

- No catch-all `utils/utils.ts` module remains.
- The specified directory barrels are the external import seams.
- Time-series schedules delegate to one run-lifecycle interface.
- Job aggregators derive outcomes but do not own partner delivery mechanics.
- Historical-options retrieval is pure, and persistence is explicit and separately governed ✅ (partner path complete; browser gateway wrapper remains until migrated).
- Compatibility wrappers have a recorded removal milestone or have been removed ✅ `fetchWithoutPersistence` removed; `AvHistoricalOptionsHandler` wrapper has a recorded removal milestone (browser gateway migration).
- The affected compilation and focused test suites pass after each phase.
