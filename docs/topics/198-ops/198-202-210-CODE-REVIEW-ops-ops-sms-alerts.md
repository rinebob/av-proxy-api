# Code Review — Watchdogs Emit Canonical Alert Events

| Meta | Value |
|---|---|
| **Doc Type** | Code Review |
| **Blueprint** | [#202 — Backend — Ops SMS Alerts — Pipeline SMS Refresh](../../issues/202) |
| **Issue** | [#210 — Watchdogs emit canonical alert events](../../issues/210) |
| **Task** | #210 |
| **Topic** | [#198 — Ops SMS Alerts](../../issues/198) |
| **Topic Parent** | #198 |
| **Topic Slug** | ops-sms-alerts |
| **Type** | Code Review |
| **Status** | Complete |
| **Created** | 2026-10-31 |
| **Last Updated** | 2026-10-31 |

## Scope

Task #210 wires the intraday and POST (A/B/C) PDR watchdogs into the canonical
ops-alert seam so hard-down conditions emit exactly one `OpsAlertEvent` each.
A new shared helper `emitWatchdogException` (`ops-alert.exceptions.ts`) owns the
compose → claim → emit pipeline; both watchdogs detect conditions in their
existing check loops and emit after the health doc writes. Conditions:
`run_missing` (no run doc), `pdr_missing` (doc + jobs + no PDR),
`orchestrator_no_start` (doc + zero/absent `createdJobs` + no PDR). B/C
empty-retry `no_jobs` emits nothing. Alert keys are built via the new
`opsAlertKey` builders (`exception:intraday:{date}:{tick}:{condition}`,
`exception:post:{date}:{seq}:{interval}:{condition}`). Existing ERROR logs and
health-doc semantics are unchanged. The 209 verify script's cleanup was
extended — its pdr_missing probe now legitimately emits a canonical exception.

Review remediation added the POST scheduled-window clause to exception text,
a fail-open calendar gate on the intraday watchdog, shared
`exceptionConditionForRunDoc` classification, idempotent pre-cleaning in the
verify script, a dedicated helper test file, and `TimeSeriesRunStatus` enums
in touched fixtures.

## Axis results

| Axis | Verdict |
|---|---|
| Standards | **SHIP** — design contract matches the signoff precedent; 1 minor doc bug + enum-literal nit remediated |
| Spec | **PASS** — all 4 ACs met; one test-plan edge (expected window in B/C text) remediated; `orchestrator_no_start` mapping documented as interpretive |
| Thermo-nuclear | **REQUEST CHANGES → resolved** — 2 majors, 5 minors, 3 nits; all majors and all cheap minors remediated |

## Findings and dispositions

| Severity | Finding | Disposition |
|---|---|---|
| Major (TN) | **Verify script not rerunnable** — deterministic alertKeys mean leftovers from a crashed run leave claims: reruns pass vacuously on stale audit docs or fail on stale stamps | **Fixed** — `ALL_KEYS` pre-cleaned at the top of `try` before seeding; the same list drives `finally` cleanup |
| Major (TN) | **Intraday calendar gate unguarded** — `getIntradaySkipReason` throws for years outside the holiday table; the watchdog would crash before health doc AND exception emit — the failure mode the alert channel exists for would go invisible | **Fixed** — `safeIntradaySkipReason` fail-open wrapper mirrors `safePostSkipReason` (#209); new test asserts check proceeds with a `calendar_error` warn on an uncovered year |
| Minor (S/TN) | **alertKey scheme lived in 4+ places and docs already drifted** — new JSDoc said `WEEKLY` while keys emit `weekly`; `ops-alert.types.ts` example `signoff:post-a:...` never matched `signoff:post:...:A` | **Fixed** — `opsAlertKey` builders in `ops-alert.types.ts` are now the single source; used by both watchdogs + the verify script; both stale doc examples corrected |
| Minor (Spec) | **B/C exception text named the pass but not its expected window** (TEST §Edge Cases: "text says which pass and its expected window") | **Fixed** — `runLabel` appends `(scheduled {clockPt} PT)` on POST exceptions when clockPt is provided; post watchdog passes clockPt; backward compatible (omitted when absent) + 2 composer tests |
| Minor (TN) | **Condition classifier duplicated verbatim at both call sites** | **Fixed** — `exceptionConditionForRunDoc` exported from `ops-alert.exceptions.ts`; `?? 0` rationale documented once (absent field = malformed doc = "no jobs observed") |
| Minor (Spec) | **No dedicated unit test for `emitWatchdogException`** | **Fixed** — `ops-alert-exceptions.test.ts` (8 tests: classifier table, claim→emit, already-claimed, tx-failure fail-closed, condition-pinning, audit-write rejection) |
| Minor (S) | Raw `'COMPLETE'`/`'IN_PROGRESS'` literals in new fixtures vs. real enum standard | **Fixed** — `TimeSeriesRunStatus` enums throughout touched fixtures + verify seeds |
| Minor (TN/S) | Context asymmetry — intraday audit docs lacked structured `clockPt` | **Fixed** — intraday emit passes `context: { clockPt }` |
| Nit (TN) | Caller context could clobber `condition` in the audit doc | **Fixed** — spread first, `condition` pinned last |
| Nit (TN) | Emit-ordering comments oversold the guarantee | **Fixed** — comments now describe the health-doc-primary ordering accurately |
| Nit (S) | `exceptions` element typed `interval: string` | **Fixed** — `TimeSeriesInterval` |

## Accepted / documented (not blocking)

| Item | Rationale |
|---|---|
| `orchestrator_no_start` mapping is interpretive — run doc + `createdJobs===0` + no PDR | Neither PRD nor IMPL defines a predicate; "no jobs were created" is the truthful bucket and the composed text names the actual diagnosis. POST run docs initialize `createdJobs: 0` at creation, so doc-init-then-no-spawn also lands here correctly. A never-fired orchestrator surfaces as `run_missing`. Centralized in `exceptionConditionForRunDoc`. |
| Condition change on re-check emits a second text (e.g., `run_missing` → `pdr_missing` under a different key) | Consistent with AC3's literal "once per condition per run"; a single run can yield at most one text *per condition*. |
| Legacy run doc missing `createdJobs` entirely → `orchestrator_no_start` | Acceptable — "no jobs observed" is still accurate; documented in the classifier. |
| Test tx mocks don't enforce reads-before-writes or mirror per-doc existence | Guard-level ordering already covered by `ops-alert-guard.test.ts`'s store-backed tx; stamp-absence assertions cover the phantom-stamp case. |
| No emulator E2E for the exception-day journey | Consistent with the suite's harness — Jest + mocked Firestore for unit/integration plus the prod verify script for end-to-end (same split as #203–#209). |
| Post watchdog now ~345 lines | Over the 300 target, under the 400 strong-smell line; shared `checkPostPdrDelivery` core is cohesive — decomposition deferred. |
| `auditDocs(): any[]` in test helpers | Consistent with the file's pre-existing `setData(): any` pattern; flagged, not scored. |

## Test results

- Focused: **101/101** — both watchdog suites, all 4 ops-alerts suites (incl. `ops-alert-exceptions.test.ts`, composer window/budget tests, uncovered-year weekend skip)
- Full suite: **1097/1097**, 100 suites — `npx jest` (re-verified after pass-2 remediation)
- Typecheck: `npx tsc --noEmit` clean (functions) + `tsc -P scripts/tsconfig.json --noEmit` clean (scripts)
- Prod verify script `ops-sms-alerts-210-watchdog-exceptions.ts` written + registered (mutating; **not run** — requires user-authorized `GCLOUD_PROJECT=alpha-vantage-proxy-api`, deferred to QA)

## Second pass — re-review of remediated code

All three axes re-ran against the post-remediation diff. Spec: clean PASS, no
new gaps. Standards + TN each surfaced new minor findings; all were
investigated and either fixed or verified unreachable:

| Finding | Disposition |
|---|---|
| 209 verify script hand-built the `B:weekly:pdr_missing` alertKey and didn't pre-clean it — a SIGKILLed prior run's stale claim would silently suppress the emit the script exercises (the pass-1 vacuous-pass hazard, replicated) | **Fixed** — `B_PDR_KEY` built via `opsAlertKey.exceptionPost`; alert+claim docs pre-cleaned at the top of `try` alongside the existing `finally` cleanup; also swapped the raw `'COMPLETE'` literal for `TimeSeriesRunStatus.COMPLETE` |
| TN minor: `safeIntradaySkipReason` catch bypasses the weekend check → false `run_missing` on Sat/Sun | **Verified unreachable — no code change.** `MarketCalendarService.isTradingDay` short-circuits Sat/Sun via day-of-week *before* the holiday-table lookup that throws, so weekends can never enter the catch. Kept the fix's useful parts: `clockPt` added to the `calendar_error` payload + doc note that only weekdays can reach it. New test documents that a Saturday in an uncovered year skips *without* a warn |
| `opsAlertKey` doc overclaimed "single source of truth" (signoff sites still inline-build) | **Fixed** — comment scoped to exception keys; signoff builders noted as future work if a third site appears |
| `condition` params typed `string` instead of `OpsExceptionCondition` | **Fixed** — both builders + all call-site helper signatures now use the union type; a misspelled condition segment is a compile error |
| `runLabel` POST branch required `sequence && interval` — a POST input missing `interval` fell into the intraday label | **Fixed** — POST branch keys on `sequence` alone; interval clause conditional |
| SMS budget/ASCII tests didn't include the new longest variant (POST exception + scheduled window) | **Fixed** — added to both arrays; still ≤300 chars, ASCII-clean |
| `WatchdogExceptionInput.clockPt` doc stale | **Fixed** — matches `ExceptionInput.clockPt` |
| Stray `as Record<string, unknown>` cast in exceptions test | **Fixed** — removed |
| 210 verify `finally` not failure-atomic (one failed delete aborts the rest) | **Fixed** — `Promise.allSettled` over all deletes |
| B/C `zeroJobComplete` absent-field asymmetry (Spec observation) | **Fixed** — documented at the predicate |

| Design note (accepted) | Rationale |
|---|---|
| A fully-missed A run emits 3 separate SMS (one per interval) | Inherent to the per-interval key spec `exception:post:{date}:{seq}:{interval}:{condition}` — each interval is a distinct failed deliverable; dedupe is per interval per spec |

## Verdict

**PASS** — all acceptance criteria met; all major findings remediated; remaining
items are documented accepted risks/judgements. A second three-axis pass found
no further majors; every new finding was remediated or verified unreachable.
