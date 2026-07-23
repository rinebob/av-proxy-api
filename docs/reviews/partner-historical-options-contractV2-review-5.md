# Historical Options Time-Series Builder — Review #5 Report

**Date:** 2026-07-23  
**Base:** `prod` @ `4b47de1`  
**Working tree changes:** builder/trigger code updates, partner docs, `TASK.md`  
**Reviews run:** `thermo-nuclear-code-review` + `/code-review` (Standards + Spec) via `.devin/skills/code-review/SKILL.md`

---

## 1. Scope / change inventory

| File | Status | Notes |
|---|---|---|
| `functions/src/v2/historical-options-corpus/services/time-series-builder.service.ts` | modified | Adds optional `contractID` filter, structured logging, `DEFAULT_WRITE_CONCURRENCY` reduced to 20 |
| `functions/src/v2/historical-options-corpus/handlers/trigger-historical-options-time-series-build.http.ts` | modified | Adds `contractID` body param, `timeoutSeconds` 1200s, JSDoc update |
| `docs/partner/options-data/historical-options-contract-v2-discovery.md` | new | Consumer discovery doc for `partnerHistoricalOptionsContractV2` |
| `docs/partner/options-data/historical-options-contract-v2-usage.md` | new | Consumer usage doc for `partnerHistoricalOptionsContractV2` |
| `docs/partner/options-data/historical-options-discovery.md` | modified | Status updated for QQQ 2019-2024/2025 progress |
| `docs/partner/options-data/rs-historical-options-usage.md` | modified | Pointer to contract V2 usage doc |
| `docs/partner/partner-discovery.md` | modified | New "Partner Historical Options APIs" section |
| `TASK.md` | modified | Backfill progress entries added |
| `.devin/skills/code-review/` | untracked | **Not part of these changes; do not delete** |

---

## 2. `/code-review` — Standards

### Remaining

1. **Duplicated `isValidIsoDate` logic.** `trigger-historical-options-time-series-build.http.ts` defines a local `isValidIsoDate` regex-only guard while a shared, calendar-validated version exists in `functions/src/v2/common/utils/date-time.utils.ts`. Replace the local function with the shared import.
   - Hunk:
     ```ts
     function isValidIsoDate(value: unknown): value is string {
       return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value);
     }
     ```
   - The local version accepts non-existent dates such as `2023-02-30`.
2. **Missing test coverage for new builder behavior.** `functions/tests/v2/historical-options-corpus/time-series-builder.service.test.ts` does not exercise the new `contractID` parameter, the `builder.symbol.start`, `builder.date.found`, or `builder.symbol.done` structured log events. Add focused tests.
3. **No tests for the admin trigger.** `trigger-historical-options-time-series-build.http.ts` has no Jest coverage.
4. **Variable shadowing.** `time-series-builder.service.ts` loop body declares `const contractID = contract.contractID.toUpperCase();`, shadowing the `contractID` parameter. Rename to `currentContractID` or `upperContractID`.

### Resolved

- `time-series-builder.service.ts` remains under 500 lines and continues to respect the single-responsibility-per-file rule.
- The builder's file-flush and merge logic is still cleanly split into private methods.

---

## 3. `/code-review` — Spec

### Remaining / deviations

1. **Synchronous HTTP builder vs. queued task model.** PRD §8.2 Phase 1b describes a planner that enqueues builder tasks on a new `OPTIONS_TIME_SERIES_BUILD_TASK_QUEUE`. `triggerHistoricalOptionsTimeSeriesBuild` currently runs `TimeSeriesBuilderService` synchronously inside the HTTP handler. The 1200s timeout makes this practical for backfills, but the spec text still describes a task queue. Document the intentional simplification or implement the queue.
2. **Firestore time-series ledgers not implemented.** PRD §9 lists `options_time_series_build` and `options_time_series_append` operational ledgers. These are not written by the current `TimeSeriesBuilderService` or trigger.
3. **`buildPlan` ignores `contractID`.** When `execute=false` and a `contractID` is supplied, the returned plan does not mention the contract filter, so a caller cannot verify the intended scope before running it.
4. **Silent no-op on non-matching `contractID`.** If `contractID` is supplied but does not match any contract in the date range, the builder returns `processedContracts: 0` with no error. Consider validating `contractID` starts with the symbol or returning a clearer signal.

### Resolved

- Optional `startDate`/`endDate` defaults and symbol uppercasing in the trigger match the admin-backfill spec.
- `DEFAULT_WRITE_CONCURRENCY` 20 and 1200s timeout match the operational fixes noted in `qqq-tqqq-options-corpus-implementation-plan.md` §13.
- `contractID` is passed from the trigger into the builder and filtered correctly at contract ingestion time.

---

## 4. Thermo-nuclear review

### Blockers

None. The code is syntactically valid, dependency-injected, and the existing focused test suite still passes. The `contractID` filter and observability additions are the right shape.

### Structural opportunities

1. **Replace the trigger's local `isValidIsoDate` with the shared utility.** This is the highest-value hygiene item because it removes duplication and strengthens validation.
2. **Add `contractID` unit tests to `time-series-builder.service.test.ts`.** Cases:
   - Filter returns only the requested contract.
   - Unknown `contractID` returns zero processed contracts.
   - Logging events fire for `builder.symbol.start`, `builder.date.found`, `builder.symbol.done`.
3. **Trigger `contractID` edge cases.** Trim to `undefined` when an empty/whitespace string is supplied; currently `''` becomes `''` and the builder treats it as no filter.
4. **Rename shadowed `contractID` variable** in the builder loop to avoid confusion.
5. **Consider validating `contractID` starts with `upperSymbol`** inside `buildSymbol` and/or the trigger, matching the partner endpoint validation pattern.

### Doc / consumer surface notes

1. `docs/partner/options-data/historical-options-contract-v2-usage.md` still opens with `# RS Usage Guide: Historical Options Contract V2 Partner API` and `**Audience:** Relative Strength (RS) backend engineers`, but the filename is now generic (`historical-options-contract-v2-usage.md`). Reconcile the title/audience with the generic filename if this doc is meant for multiple consumer sites.
2. `docs/partner/partner-discovery.md` correctly cross-references both the raw-chain and contract endpoints.

### Clean-up / side notes

- Untracked `.devin/skills/code-review/` is still present and should not be deleted.
- The `historical-options-discovery.md` and `historical-options-contract-v2-discovery.md` status updates accurately reflect the 2019-2024 QQQ completion and 2025 in-progress state.

---

## 5. Verdict

The new `contractID` filter and builder observability are solid additions, and the partner docs are now in place. Before approval:

1. Replace the duplicated `isValidIsoDate` in the trigger with the shared import.
2. Add focused tests for the `contractID` filter path and the new builder log events.
3. Fix the `contractID` variable shadowing in the builder loop.
4. Decide whether `historical-options-contract-v2-usage.md` should remain RS-specific or be retitled for generic partner use.
5. (Optional) Document or reconcile the synchronous trigger vs. queued-builder task model from PRD §8.2.

No hard blockers. After the hygiene items above, the changes are safe to commit and continue the 2025 QQQ backfill.
