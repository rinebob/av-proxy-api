# UAT — Watchdogs Emit Canonical Alert Events

| Meta | Value |
|---|---|
| **Doc Type** | UAT |
| **Blueprint** | [#202 — Backend — Ops SMS Alerts — Pipeline SMS Refresh](../../issues/202) |
| **Issue** | [#255 — QA: Watchdogs emit canonical alert events](../../issues/255) |
| **Task** | #210 |
| **Topic** | [#198 — Ops SMS Alerts](../../issues/198) |
| **Topic Parent** | #198 |
| **Topic Slug** | ops-sms-alerts |
| **Type** | UAT |
| **Status** | Complete |
| **Created** | 2026-10-31 |
| **Last Updated** | 2026-10-31 |

## Scope

Task #210 wires the intraday and POST (A/B/C) PDR watchdogs into the
canonical ops-alert seam so hard-down conditions emit exactly one
`OpsAlertEvent` each. A shared helper `emitWatchdogException`
(`ops-alert.exceptions.ts`) composes text, claims the send-once slot,
and emits; both watchdogs detect conditions in their existing check
loops and emit after the health doc writes. Acceptance criteria under
test:

- Each hard-down condition produces exactly one exception alert event —
  `run_missing` (no run doc), `pdr_missing` (run doc + jobs + no PDR),
  `orchestrator_no_start` (run doc + zero/absent `createdJobs` + no PDR)
- Exception text names expected vs actual, run/pass/interval
  (incl. POST scheduled window), and next step
- Sent exactly once per condition per run via the send-once guard —
  already-claimed suppresses, claim transaction failure fails closed
- Existing ERROR logs retained for diagnostics; health-doc semantics
  unchanged
- B/C empty-retry `no_jobs` emits nothing; market-closed days emit
  nothing
- No run-doc fabrication for `run_missing`; `opsSms.claimed` stamp only
  on run docs that exist

Alert-key scheme (single source: `opsAlertKey` in `ops-alert.types.ts`):
`exception:intraday:{date}:{tick}:{condition}` and
`exception:post:{date}:{seq}:{interval}:{condition}`.

## Prerequisites

- Repo at the uncommitted #210 working tree.
- Node deps installed: `cd functions && npm ci`.
- Firebase credentials (Application Default Credentials) for the
  production-verification scenario only.
- The production verification script is **mutating**: it writes and
  deletes probe docs in `realtime-runs`, `intraday-runs`,
  `realtime-health`, `intraday-health`, `ops-alerts`, and
  `ops-alert-claims` for marketDate `2026-12-30` in
  `alpha-vantage-proxy-api`. It refuses to run without
  `GCLOUD_PROJECT=alpha-vantage-proxy-api`, pre-cleans all six probe
  alert keys before seeding (rerunnable), and cleans up in `finally`.

## Start instructions

```bash
cd functions
```

## Scenarios

### S1 — Focused unit tests (watchdogs + ops-alerts seam)

- **Feature:** all exception conditions both watchdogs, send-once
  suppression, fail-closed claim failure, composer text (incl. scheduled
  window), helper claim/emit/fail-safe behavior, calendar fail-open.
- **Steps:**
  ```bash
  cd functions
  npx jest tests/v2/alpha-vantage/intraday-watchdog tests/v2/alpha-vantage/post-watchdog tests/v2/common/ops-alerts
  ```
- **Expected:** all tests pass (101/101 at QA time).
- **Result/evidence:** **PASS** — 101/101 tests, 6 suites, 2026-10-31.

### S2 — Full test suite + typecheck

- **Feature:** no regression in neighboring code; script compiles under
  its own tsconfig.
- **Steps:** `cd functions; npx jest` then `npx tsc --noEmit` and
  `npx tsc -P scripts/tsconfig.json --noEmit`.
- **Expected:** all suites pass; zero type errors.
- **Result/evidence:** **PASS** — 1097/1097 tests, 100 suites; both
  `tsc` invocations exit 0, 2026-10-31.

### S3 — Static wiring checks

- **Feature:** shared seam is actually shared; keys single-sourced;
  scheduled watchdog exports unchanged.
- **Steps (read/grep):**
  - `ops-alert.exceptions.ts` exports `emitWatchdogException` +
    `exceptionConditionForRunDoc`; both watchdogs import both.
  - `ops-alert.types.ts` `opsAlertKey` builders are the only key
    construction — grep finds no remaining inline `exception:` template
    strings in src or verify scripts.
  - `ops-alert.guard.ts` stamps `opsSms.claimed` only when the run doc
    exists; `runDocPath` is passed only in the `runSnap.exists` branch.
  - `functions/scripts/verify/run-all.ts` does not include the
    mutating #210 script (comment only); `README.md` registers it.
- **Expected:** all true.
- **Result/evidence:** **PASS** — verified during review pass 2:
  builders used by both watchdogs and both verify scripts
  (`ops-sms-alerts-209:59`, `ops-sms-alerts-210:55-57`); emit sites
  `intraday-pdr-watchdog.ts:183-190`, `post-pdr-watchdog.ts:230-240`
  after health writes; `runDocPath` only on the exists branch
  (intraday :185-186, post :202); README table row + run-all exclusion
  comment present.

### S4 — Production end-to-end verification (mutating, user-authorized)

- **Feature:** real watchdog cores against prod Firestore — A-pass
  `pdr_missing` (daily) + `run_missing` (weekly/monthly), audit docs,
  claim docs, `opsSms.claimed` stamp on the existing run doc, no
  fabrication for missing docs, send-once re-run suppression,
  `orchestrator_no_start` for zero-job docs (POST and intraday),
  intraday `run_missing`, health doc still written, probe cleanup.
- **Starting state:** none required — the script pre-cleans all six
  probe alert keys before seeding.
- **Steps:**
  ```bash
  cd functions
  GCLOUD_PROJECT=alpha-vantage-proxy-api GOOGLE_CLOUD_PROJECT=alpha-vantage-proxy-api \
    npx ts-node -r tsconfig-paths/register -P scripts/tsconfig.json \
    scripts/verify/ops-sms-alerts-210-watchdog-exceptions.ts
  ```
- **Expected:** every `PASS:` line prints; ends with
  `=== All verification checks passed ===`; probe docs deleted.
- **Cleanup:** automatic via `Promise.allSettled` in `finally`; verify
  `realtime-runs/2026-12-30-*`, `intraday-runs/2026-12-30-*`,
  `realtime-health/2026-12-30`, `intraday-health/2026-12-30-*`, and
  `ops-alerts`/`ops-alert-claims` probe docs are gone.
- **Result/evidence:** **PASS** — all checks against
  `alpha-vantage-proxy-api` (user-authorized run, 2026-10-31):
  `pdr_missing` audit for DAILY with correct text ("the POST A DAILY
  run (scheduled 1335 PT) ... never sent. Run doc ... has details.
  Needs attention."); `run_missing` audits for WEEKLY/MONTHLY ("never
  ran - no run doc exists. Check Cloud Scheduler and functions logs");
  all three claim docs kind=exception; `opsSms.claimed[alertKey]` stamp
  on the DAILY run doc; no run doc fabricated for WEEKLY; re-run
  produced three `ops.alert_exception_skipped already-claimed` events
  and unchanged `emittedAt` (send-once); zero-job DAILY →
  `orchestrator_no_start` audit ("never started - no jobs were
  created"); intraday zero-job → `orchestrator_no_start` + stamp;
  intraday missing doc → `run_missing` + no fabrication; POST health
  doc written alongside the events; cleanup confirmed
  (`probe alert docs deleted`); ended with
  `=== All verification checks passed ===`.

### S5 — Live-day confirmation (informational, user-observed)

- **Feature:** on the next real hard-down day, an `ops-alerts/{alertKey}`
  audit doc exists alongside the health doc and the `ops.alert` ERROR
  log; on a healthy day nothing emits.
- **Steps:** after deploy, on any hard-down day check
  `ops-alerts` for `exception:*` docs and logs for `ops.alert`; compare
  `realtime-health`/`intraday-health` tick status.
- **Expected:** audit doc + ERROR log co-exist; text matches the
  composed format; no duplicate alerts on repeated checks.
- **Result/evidence:** **BLOCKED — non-gating.** Requires post-deploy
  observation of a real failure day. Code path proven by S1/S4;
  recommend a spot check the first morning an interval legitimately
  fails.

## Traceability

| Acceptance criterion | Scenario |
|---|---|
| One exception event per hard-down condition, both watchdogs, A/B/C | S1, S4 |
| Exception text: expected vs actual, run/pass/interval, next step | S1, S4 |
| POST scheduled-window clause in exception text | S1, S4 |
| Exactly once per condition per run (already-claimed no-op, tx fail-closed) | S1, S4 |
| Existing ERROR logs retained; health doc still written | S1, S4 |
| B/C `no_jobs` emits nothing | S1 |
| Market-closed days emit nothing; calendar fail-open | S1 |
| No run-doc fabrication; stamp only when doc exists | S1, S4 |
| Zero-job run doc → `orchestrator_no_start` | S1, S4 |
| Prod verification rerunnable (pre-clean + finally cleanup) | S4 |

## Regression / smoke checklist

- Signoff emission (#207/#208) untouched — full suite includes the
  signoff and ops-alert suites (S2).
- `runLabel` POST boundary widened to `sequence`-only — signoff text
  unchanged (composer signoff tests unaffected, S1/S2).
- 209 verify script now pre-cleans + key-builds its exception artifacts —
  its own checks unchanged (S1 post-watchdog suite).
- `run-all.ts` still excludes all mutating scripts — S3.

## Refinement pass

Not applicable — no user-facing surface (backend scheduled functions,
Firestore audit docs, canonical log events; SMS delivery path unchanged
by this task).
