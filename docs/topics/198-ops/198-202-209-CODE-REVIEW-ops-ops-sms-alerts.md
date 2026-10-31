# Code Review — POST B/C Watchdog Coverage + POST Calendar Gate

| Meta | Value |
|---|---|
| **Doc Type** | Code Review |
| **Blueprint** | [#202 — Backend — Ops SMS Alerts — Pipeline SMS Refresh](../../issues/202) |
| **Issue** | [#209 — B/C watchdog coverage + POST calendar gate](../../issues/209) |
| **Task** | #209 |
| **Topic** | [#198 — Ops SMS Alerts](../../issues/198) |
| **Topic Parent** | #198 |
| **Topic Slug** | ops-sms-alerts |
| **Type** | Code Review |
| **Status** | Complete |
| **Created** | 2026-10-30 |
| **Last Updated** | 2026-10-30 |

## Scope

Task #209 adds hard-down coverage for the POST B (18:00 PT) and C (04:00 PT next-morning catch-up) passes plus a POST calendar gate. `postPdrWatchdogB` (19:15 PT) and `postPdrWatchdogC` (05:15 PT) reuse the shared `checkPostPdrDelivery` core; B/C zero-job retry intervals report `no_jobs` instead of `pdr_missing`; health docs are per-sequence (`{date}`, `{date}-B`, `{date}-C`); the C check resolves its target via `getLatestRetryRunMarketDateForInterval` — extracted to `post-retry-target.ts` and shared with the 04:00 orchestrator so both sides agree. `getPostSkipReason` (new `post-calendar-gate.ts`, intraday parity minus the early-close leg) suppresses checks on market-closed days, fail-open when the calendar throws.

Review remediation extended the calendar gate to the POST **orchestrators** (A/B/C scheduled handlers — manual/emulator invocations ungated), added a matching today-gate to the C watchdog, and raised `RUN_DOC_TTL_MS` 48h → 96h so Friday's retry docs survive holiday weekends to the next trading day's C pass (Bug #248).

## Axis results

| Axis | Verdict |
|---|---|
| Standards | **SHIP** — conventions verified against intraday siblings; 1 major (verify-script project guard), 2 minors remediated |
| Spec | **PASS** — all 4 ACs MET; AC4 carries a deliberate, spec-mandated deviation (A check now skips on holidays, per AC2) |
| Thermo-nuclear | **REQUEST CHANGES → resolved** — 2 majors, 4 minors, 3 nits; both majors remediated at the user's direction |

## Findings and dispositions

| Severity | Finding | Disposition |
|---|---|---|
| Major (TN-M1) | **Calendar gate premise was false** — POST orchestrators have no calendar gate, so holiday runs create real docs; the gate suppressed checks of real work (A regression; C run the morning after every holiday systematically unchecked forever — docs TTL'd before recheck) | **Fixed at the root** — orchestrators (A/B/C scheduled handlers) now gate on `getPostSkipReason`, so closed-day runs no longer happen; manual/emulator invocations stay ungated by design. C watchdog gained a matching today-gate: when today is closed the orchestrator defers, so the watchdog skips before resolving the target (a stale holiday-dated retry doc can't produce a false `run_missing`). User direction: "we should only be checking on market days and the C run has to happen properly on the next trading day." |
| Major (TN-M2, pre-existing) | **Friday→Monday C chain severed by 48h TTL** — Friday's B docs (53h old Sunday night) were deleted before Monday's 04:00 C orchestrator query → Friday's permanent failures never got a deadline retry, every week | **Fixed** — `RUN_DOC_TTL_MS` 48h → 96h (covers Friday→Tuesday ~82h across holiday Mondays). Filed as Bug #248. Pre-existing defect; the watchdog merely mirrored the blind spot. |
| Major (S1) | Verify script had no runtime project guard — all PASS lines print against the wrong project if `GCLOUD_PROJECT` is unset (local ADC resolves dev `rel-str`), plus stranded probes | **Fixed** — fail-fast check refuses to run without `GCLOUD_PROJECT=alpha-vantage-proxy-api`; probe lifecycle wrapped in try/finally so a crash can't leave docs that poison the real C-target query |
| Minor (TN) | C watchdog re-resolves target ~75 min after the orchestrator — a manual retry run landing in between shifts the target → false `run_missing` | Accepted — mirrors orchestrator semantics faithfully; requires a manual run inside a narrow window; documented |
| Minor (TN/S) | Watchdog slack ~15 min past the 60-min run window — worst-case task retry chains on mass-failure days can produce a false `pdr_missing` while jobs still drain | Accepted — fails toward alerting (alert > silence); documented |
| Minor (TN) | Retry-target query args unasserted in tests; no holiday-C-target test; no C `no_jobs` test | **Fixed** — C test asserts collection + where/orderBy args; added holiday-C-target and closed-today (deferred-pass) tests |
| Minor (S2) | `post-retry-target.ts` hardcoded the retry runType literal | **Fixed** — `POST_ALL_INTERVALS_RETRY_RUN_TYPE` from job-config |
| Minor (S3) | `'COMPLETE'` string literal | **Fixed** — `TimeSeriesRunStatus.COMPLETE` enum |
| Nit | `checkPostPdrDelivery` docstring led with "POST A run"; `postPdrWatchdog` comment stale | **Fixed** |
| Nit | `no_jobs` is a new interval-status vocabulary member | Documented — `tickStatus`/`alertState` unaffected; dashboard (Topic #61) is future work |
| Nit | `(createdJobs ?? 0)` classifies a COMPLETE doc missing the field as `no_jobs` | Accepted — no code path produces that shape; suppresses rather than invents alerts |
| Nit | Hand-built runIds duplicate `RunIdFactory` format | Accepted — matches committed intraday-watchdog convention |
| Nit | Malformed `marketDate` → `UNDEFINED`-DOW runIds + health doc | Accepted — surfaces poisoned data without crashing; calendar fail-open already covers the throw path |

## Test results

- Focused: 22/22 post-pdr-watchdog + post-calendar-gate tests, 28/28 incl. refresh-manager suite — green post-remediation
- Full suite: **1036/1036, 97 suites**; `tsc --noEmit` clean
- Prod verify (real `alpha-vantage-proxy-api` project): **13/13** — B health doc + `no_jobs`, B `pdr_missing` alert, C target resolution via the real retry query, holiday zero-writes, probe cleanup

## Verdict

**PASS** — after remediation. The gate's semantics are now end-to-end consistent: scheduled POST work only happens on market days (orchestrators gated), checks only happen on market days (watchdog gated), deferred C passes are not false-alarmed (today-gate), and Friday's retry chain survives the weekend (96h TTL, Bug #248).

## Second pass — remediation delta review

A focused adversarial pass over the post-review changes (orchestrator gates, C today-gate, TTL, verify-script hardening) found two more majors, both fixed:

| Severity | Finding | Disposition |
|---|---|---|
| Major | **`assert()` → `process.exit(1)` bypassed `try/finally`** — a failed check left retry-type probes (future `marketDate`, no `runCreatedAt`) that would win the C-target query forever and silently starve the real retry chain | **Fixed** — `assert` now throws (unwinds through finally); probes carry `runCreatedAt` so TTL cleanup reclaims strays |
| Major | **Unvalidated C-target** — blind `max(marketDate)` let any closed-day/future-dated retry doc hijack the C pass (leaked probes, midnight-ET-crossing docs, pre-gate holiday docs) while the watchdog looked away | **Fixed** — `getLatestRetryRunMarketDateForInterval` now walks ≤5 candidates and returns the newest well-formed, non-future, trading-day date (orchestrator + watchdog share it, so both sides agree). Side benefit: future-dated verify probes can no longer collide with the real C pass at all |
| Minor | Zero handler-level coverage of the gate wiring | Accepted — gate logic is unit-tested; handler wiring is thin delegation |
| Minor | `runMode: 'manual'` event override may be inert via `gcloud functions call` (Pub/Sub-shaped payload) | Uncertain — fails toward gated (safe); flag for empirical verification |
| Minor | >4-day trading gaps (none in 2025–26 table) would re-sever the C chain | Documented — revisit when the holiday table is extended |
| Minor | Unguarded `getPostSkipReason` in handlers throws for uncovered years (e.g., Jan 2027 before table update) | Accepted — matches existing intraday-gate behavior; watchdogs fail-open so it fails loud, not silent |
| Minor | B/C handlers lack the A pass's `runMode` manual override | Noted — asymmetric escape hatch; scheduled paths are the gated ones regardless |
| Nit | `reason:` payload dropped by betterLogger in C skip log | **Fixed** — routed through `message` |
| Nit | `docs/pipeline/time-series-post-pipeline-monitoring.md` still documented 2-day TTL | **Fixed** — all references now 4 days |

Second-pass test evidence: 29/29 focused (incl. new walk-past, future-doc, and closed-today tests), full suite **1050/1050**, `tsc` clean. Converged — no further pass needed.
