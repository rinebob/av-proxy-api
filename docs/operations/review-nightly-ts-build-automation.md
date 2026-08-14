# Code Review: Nightly Time-Series Build Automation

**Date:** 2026-07-30  
**Fixed point:** `HEAD` (commit `981fe25`)  
**Scope:** Automated time-series build triggered after corpus seed success

## Changed Files

| File | Status | Lines |
|------|--------|-------|
| `functions/src/v2/historical-options-corpus/handlers/ts-build.task.ts` | New | 61 |
| `functions/src/v2/historical-options-corpus/services/corpus-seed.worker.ts` | Edited | 137 → 160 |
| `functions/src/v2/historical-options-corpus/handlers/corpus-seed.task.ts` | Edited | 73 → 79 |
| `functions/src/index.ts` | Edited | 142 → 143 |

## Spec Source

User request: "tie it to when the corpus doc download finishes" — trigger time-series build automatically after a successful corpus seed, rather than via a separate nightly scheduler.

---

## Standards

### S1 — Missing unit tests for `onSeedSuccess` callback (hard violation)

**File:** `corpus-seed.worker.ts`  
**Standard:** Project rules require unit tests for all new features with at least 1 expected use, 1 edge case, and 1 failure case.  
**Finding:** The `onSeedSuccess` callback and `notifySeedSuccess` helper have no test coverage. The existing test file `corpus-seed.worker.test.ts` was not updated.  
**Required:** Add tests for: (a) callback fires on `stored`, (b) callback fires on `gcs-hit`, (c) callback error is swallowed and logged, (d) callback not fired on `already-recorded` skip, (e) callback not fired on failure/retry.

### S2 — Missing unit tests for `ts-build.task.ts` (hard violation)

**File:** `ts-build.task.ts`  
**Standard:** Same as S1.  
**Finding:** No test file exists for the new task handler.  
**Required:** Add tests for: (a) successful build, (b) missing dates warning, (c) build error handling.

### S3 — Handler-to-handler import (judgement call)

**File:** `corpus-seed.task.ts:15`  
**Standard:** Project rules state "A writer file must not import from another writer file in the same directory."  
**Finding:** `corpus-seed.task.ts` imports `OPTIONS_TS_BUILD_TASK_QUEUE` and `TsBuildPayload` from `./ts-build.task`. These are task handlers, not writers, so the rule doesn't strictly apply. The import is only for a constant and a type — no logic coupling.  
**Verdict:** Acceptable. The queue name constant and payload type are shared contracts that naturally live with the handler that defines them.

---

## Spec

### P1 — `already-recorded` skip does not trigger TS build (judgement call)

**Spec line:** "tie it to when the corpus doc download finishes"  
**Finding:** When the Firestore metadata already shows `status: 'success'` (the `already-recorded` path at line 49-51), `onSeedSuccess` is NOT called. This means if a corpus item was seeded successfully in a previous run but the TS build failed (exhausting all 3 retries), the TS build will not be retried automatically on subsequent nightly runs.  
**Impact:** Low — the `gcs-hit` path (which fires the callback) covers the case where GCS has the object but Firestore metadata is stale. The `already-recorded` path only triggers when both Firestore and GCS agree the item is done. If the TS build failed 3 times, manual intervention is already required.  
**Recommendation:** Document this as a known gap. If it becomes a problem, add a "TS build retry" admin endpoint or have the nightly corpus service check for stale TS builds.

### P2 — No backpressure mechanism between seed and TS build (judgement call)

**Spec line:** "tie it to when the corpus doc download finishes"  
**Finding:** Every successful seed immediately enqueues a TS build task. The TS build task queue is rate-limited to 1 concurrent dispatch, 1/sec. For the nightly run (2 symbols × 1 date = 2 items), this is fine. But if a pilot/backfill enqueues many seed tasks, each successful seed will enqueue a TS build, potentially flooding the queue.  
**Impact:** Low for nightly use. The queue's rate limiting handles it. For backfills, the existing manual HTTP trigger is used instead.  
**Verdict:** Acceptable for the current use case.

---

## Thermo-Nuclear

### T1 — Same as S1: Missing test coverage for `onSeedSuccess` (structural)

The `onSeedSuccess` callback is the core of this change — it's the coupling point between the corpus pipeline and the time-series pipeline. It has zero test coverage. The `notifySeedSuccess` helper's error-swallowing behavior is the safety net that prevents seed failures from TS enqueue issues, and that behavior must be verified by a test. This is a structural gap, not a nit.

### T2 — Same as S2: Missing test coverage for `ts-build.task.ts` (structural)

The new task handler is the automated replacement for a manual HTTP trigger. Its success/failure behavior, logging, and missing-dates warning are untested. This is the function that will run every night unattended — it needs test coverage before it can be trusted.

### T3 — `console.log` instead of `createLogger` (legibility)

**File:** `ts-build.task.ts:39,44,53`  
**Finding:** The new task handler uses raw `console.log` / `console.warn` instead of the project's `createLogger` utility. The existing `corpus-seed.task.ts` also uses `console.log` directly, so this follows the existing handler pattern. However, `time-series-builder.service.ts` uses `createLogger('time-series-builder')`.  
**Impact:** Logs from the task handler will appear as `[ts-build-task]` prefix in `textPayload`, which is searchable but not structured. The builder service logs will appear with the `time-series-builder` component tag.  
**Verdict:** Acceptable — consistent with existing task handler pattern. Not worth changing unless all task handlers are migrated to `createLogger`.

### T4 — Clean callback design (positive finding)

The `onSeedSuccess` optional callback is a well-designed extension point. It:
- Keeps the seed worker decoupled from the TS build concern
- Defaults to no-op when not provided
- Has a dedicated `notifySeedSuccess` helper that encapsulates error handling
- Doesn't add branching complexity to the seed worker — just a single function call at two exit points
- Errors are caught and logged, never propagated to the seed result

This is the right abstraction for piggybacking a downstream task onto an existing pipeline without coupling them.

### T5 — File sizes and decomposition (positive finding)

All files are well within the 500-line limit. The new file is 61 lines. The edited files grew minimally (corpus-seed.worker.ts: +23 lines, corpus-seed.task.ts: +6 lines, index.ts: +1 line). No decomposition concerns.

---

## Summary

| Axis | Findings | Worst Issue |
|------|----------|-------------|
| Standards | 3 (2 hard, 1 judgement) | S1/S2: Missing unit tests (hard violation) |
| Spec | 2 (both judgement) | P1: `already-recorded` skip doesn't trigger TS build |
| Thermo-Nuclear | 5 (2 structural, 1 legibility, 2 positive) | T1/T2: Same as S1/S2 — missing test coverage for the core change |

**Presumptive blockers:** S1, S2 (hard standard violations — missing tests for new feature)
