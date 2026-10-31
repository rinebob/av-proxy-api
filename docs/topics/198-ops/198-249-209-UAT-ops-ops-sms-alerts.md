# UAT — B/C Watchdog Coverage + POST Calendar Gate

| Meta | Value |
|---|---|
| **Doc Type** | UAT |
| **Blueprint** | [#202 — Backend — Ops SMS Alerts — Pipeline SMS Refresh](../../issues/202) |
| **Issue** | [#249 — QA: B/C watchdog coverage + POST calendar gate](../../issues/249) |
| **Task** | #209 |
| **Topic** | [#198 — Ops SMS Alerts](../../issues/198) |
| **Topic Parent** | #198 |
| **Topic Slug** | ops-sms-alerts |
| **Type** | UAT |
| **Status** | Complete |
| **Created** | 2026-10-30 |
| **Last Updated** | 2026-10-30 |

## Scope

Task #209 adds hard-down watchdog coverage for the POST B (18:00 PT)
and C (04:00 PT next-day retry) passes plus calendar gates so
market-closed days produce zero scheduled runs and zero checks.
Acceptance criteria under test:

- A watchdog check runs for the B pass and the C pass on weekdays
- Market-closed days produce zero checks/alerts — **and** zero
  scheduled POST runs (orchestrator gate added during review)
- Health docs continue to be written per check
  (`realtime-health/{date}`, `{date}-B`, `{date}-C`)
- Existing A-pass check unchanged on trading days

Review-remediation additions also under test:

- B/C `COMPLETE` runs with `createdJobs === 0` report `no_jobs`, not
  `pdr_missing` (A zero-job still alerts)
- C watchdog resolves its target via the shared validated retry-target
  resolver (skips future/closed/malformed dates, ≤ today)
- C watchdog skips on a market-closed today before resolving a target
  (deferred orchestrator pass is not a false `run_missing`)
- `RUN_DOC_TTL_MS` = 96h — Friday retry docs survive to the next
  trading day's C pass (Bug #248)

## Prerequisites

- Repo at the uncommitted #209 working tree (or the #209 ship commit).
- Node deps installed: `cd functions && npm ci`.
- Firebase credentials present (Application Default Credentials) for
  the production-verification scenario only.
- The production verification script is **mutating**: it writes and
  deletes six `realtime-runs` probe docs and two `realtime-health` docs
  for marketDate `2026-12-30` in `alpha-vantage-proxy-api`. It refuses
  to run without `GCLOUD_PROJECT=alpha-vantage-proxy-api`.

## Start instructions

```bash
cd functions
```

## Scenarios

### S1 — Focused unit tests (watchdog + calendar gate + orchestrator gates)

- **Feature:** all B/C watchdog logic, `no_jobs` classification, A
  preservation, calendar gate, C today-gate, retry-target validation.
- **Starting state:** clean working tree.
- **Steps:**
  ```bash
  cd functions
  npx jest tests/v2/alpha-vantage/post-watchdog tests/v2/alpha-vantage/data-refresher/post-calendar-gate.test.ts tests/v2/alpha-vantage/data-refresher/av-refresh-manager.test.ts
  ```
- **Expected:** all tests pass (29/29 at review time).
- **Result/evidence:** **PASS** — 29/29 tests, 3 suites
  (`post-pdr-watchdog`, `post-calendar-gate`, `av-refresh-manager`),
  2026-10-30.

### S2 — Full test suite + typecheck

- **Feature:** no regression in neighboring code.
- **Steps:** `cd functions; npx jest` then `npx tsc --noEmit`.
- **Expected:** all suites pass; zero type errors.
- **Result/evidence:** **PASS** — 1050/1050 tests, 98 suites;
  `tsc --noEmit` exit 0, 2026-10-30.

### S3 — Static wiring checks

- **Feature:** scheduled exports, cron constants, TTL value.
- **Steps (grep/read):**
  - `functions/src/index.ts` exports `postPdrWatchdogB` and
    `postPdrWatchdogC`.
  - `functions/src/v2/common/function-schedules.ts` contains the B
    (19:15 PT) and C (05:15 PT) cron constants.
  - `functions/src/v2/alpha-vantage/jobs/job-config.ts`:
    `RUN_DOC_TTL_MS = 4 * 24 * 60 * 60 * 1000`.
- **Expected:** all three present.
- **Result/evidence:** **PASS** — `index.ts:129` exports both;
  `TS_POST_B_PDR_WATCHDOG_SCHEDULE = '15 19 * * 1-5'` and
  `TS_POST_C_PDR_WATCHDOG_SCHEDULE = '15 5 * * 1-5'` in
  `function-schedules.ts`; `RUN_DOC_TTL_MS = 4 * 24 * 60 * 60 * 1000`
  at `job-config.ts:122`. Mutating script confirmed absent from
  `run-all.ts` (comment only).

### S4 — Production end-to-end verification (mutating)

- **Feature:** real watchdog cores against prod Firestore — B health
  doc + `no_jobs`, B `pdr_missing` alert, C target resolution via the
  real retry-run query, holiday zero-writes, probe cleanup.
- **Starting state:** no leftover `2026-12-30-*` probe docs (cleanup
  deletes them; if a prior interrupted run left any, delete the six
  `realtime-runs` docs + two health docs first).
- **Steps:**
  ```bash
  cd functions
  GCLOUD_PROJECT=alpha-vantage-proxy-api GOOGLE_CLOUD_PROJECT=alpha-vantage-proxy-api \
    npx ts-node -r tsconfig-paths/register -P scripts/tsconfig.json \
    scripts/verify/ops-sms-alerts-209-post-bc-watchdog.ts
  ```
- **Expected:** every `PASS:` line prints; ends with
  `=== All verification checks passed ===`; probe docs deleted.
- **Cleanup:** automatic via try/finally; verify
  `realtime-runs/2026-12-30-WED-*` and `realtime-health/2026-12-30-{B,C}`
  are gone.
- **Result/evidence:** **PASS** — all 13 checks against
  `alpha-vantage-proxy-api` (user-authorized run, 2026-10-30):
  B health doc `{date}-B` with `tickStatus: ok`,
  `intervalStatuses.monthly: no_jobs`; B `pdr_missing` alert on a
  created-jobs interval without PDR; C health doc `{date}-C`
  (`sequence: C`, `clockPt: '0400'`) via the real retry-run query;
  Thanksgiving `2026-11-26` produced zero writes
  (`post.watchdog.skip market closed (holiday)`); probe cleanup
  confirmed (`probe health docs deleted`), run ended with
  `=== All verification checks passed ===`.

### S5 — Live-day confirmation (informational, user-observed)

- **Feature:** real scheduled firing — B watchdog at 19:15 PT, C at
  05:15 PT next morning, on a trading day.
- **Steps:** after deploy, check `realtime-health/{tradingDay}-B` and
  `{tradingDay}-C` exist the next morning, or check function logs for
  `postPdrWatchdogB`/`postPdrWatchdogC` invocations.
- **Expected:** health docs written each trading day; none on
  closed days.
- **Result/evidence:** **BLOCKED — non-gating.** Requires post-deploy
  observation over a real trading day. Code path proven by S1/S4;
  schedule wiring verified statically (S3). Recommend the user spot
  check `realtime-health/{day}-B`/`-C` the morning after next deploy.

## Traceability

| Acceptance criterion | Scenario |
|---|---|
| Watchdog check runs for B and C passes on weekdays | S1, S3, S4, S5 |
| Market-closed days produce zero checks/alerts | S1, S4 |
| Market-closed days produce zero scheduled runs (orchestrator gate) | S1, S3 |
| Health docs written per check (`{date}`, `{date}-B`, `{date}-C`) | S1, S4 |
| Existing A-pass check unchanged | S1 |
| B/C zero-job → `no_jobs`; A zero-job still alerts | S1, S4 |
| C target via shared validated resolver | S1, S4 |
| C skips on closed today (no false `run_missing`) | S1 |
| `RUN_DOC_TTL_MS` = 96h (Bug #248) | S3 |

## Regression / smoke checklist

- Intraday watchdog + intraday signoff emission untouched — covered by
  S2 (full suite includes intraday watchdog and alerting suites).
- `run-all.ts` does not include the mutating #209 script — verified in
  review; spot-check via grep.
- `docs/pipeline/time-series-post-pipeline-monitoring.md` TTL
  references consistent with 96h — verified post-remediation.

## Refinement pass

Not applicable — no user-facing surface (backend scheduled functions,
Firestore health docs, SMS emission path unchanged by this task).
