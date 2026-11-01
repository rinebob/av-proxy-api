**Topic:** Options Corpus Bulk Ingest  
**Topic Slug:** options-data  
**Thread:** Full-Date Corpus Backfill (2026)  
**Thread Slug:** corpus-backfill-2026  
**Issue:** #259  
**Thread Parent:** #214  
**Topic Parent:** #213  
**Task:** #220  
**Domain:** BE  
**Type:** UAT  
**Status:** Complete  
**Created:** 2026-11-01  
**Last Updated:** 2026-11-01  

# UAT — Task #220: Standing coverage reconciler

## Scope

`reconcileOptionsCorpusCoverage` — a scheduled sweep (22:30 PT weekdays,
~90 min after the 21:00 corpus sweep) that diffs expected trading days
`[2026-01-01 .. yesterday ET]` against stored corpus objects for every
`optionsEnabled` symbol, suppresses gaps already live-queued, persists the
surviving gap manifest via `planCorpusRun`, dispatches seed tasks for each,
and records one `options_corpus_runs` doc per sweep with per-symbol
`{planned, present, missing, enqueued}` counts. This is the self-healing
backstop for terminal seed holes (e.g. SNDK/2026-09-21).

## Prerequisites

- `reconcileOptionsCorpusCoverage` **deployed** (does not exist until
  `firebase deploy --only functions:reconcileOptionsCorpusCoverage` —
  the codebase has other uncommitted work, but a single-function deploy
  only affects this function's bundle).
- ADC auth with Firestore read/write + GCS read on **prod** —
  `GCLOUD_PROJECT=alpha-vantage-proxy-api` is required or ADC resolves the
  dev `rel-str` project (same pitfall as the #209/#224 verify runs).
- Local task-enqueue needs `FIREBASE_SERVICE_ACCOUNT_ID`
  (`29825344315-compute@developer.gserviceaccount.com`) — only for
  `--execute` verify runs; dry mode is read-only.
- Verify script guide:
  `functions/scripts/verify/options-data-220-corpus-reconcile.md`.

## Scenarios

### S1 — Unit tests for the diff logic

```
cd functions
npx jest tests/v2/historical-options-corpus/corpus-reconcile.core.test.ts \
  tests/v2/historical-options-corpus/corpus-planner.service.test.ts
```

Expected: reconcile suite 11 tests (weekend edge, live-queue suppression,
stale/dead-run re-enqueue, latest-wins, per-symbol isolation, empty-set,
idempotent re-run) + planner manifest-branch test green.

- **Result/evidence:** PASS — 12 + 5 tests green (2026-11-01, post-review).

### S2 — Full suite + typecheck

```
cd functions
npx tsc --noEmit
npx jest
```

- **Result/evidence:** PASS — tsc clean; 103 suites / 1,146 tests
  (2026-11-01, post-review-pass-2).

### S3 — Dry read-only sweep reports the real prod diff

```
cd functions
GCLOUD_PROJECT=alpha-vantage-proxy-api npx ts-node -r tsconfig-paths/register \
  -P scripts/tsconfig.json scripts/verify/options-data-220-corpus-reconcile.ts
```

Expected: prints `runId`, symbol count, expected dates/symbol,
`totalGaps/enqueued/suppressed/failed`, per-symbol gapped list if any,
`coverage: FULL` when none. No writes — stubs replace plan/status/enqueue.

- **Result/evidence:** PASS — full enabled set: **130 symbols × 209
  expected dates → 0 gaps, 0 suppressed, 0 failed** (~90 s; covered
  symbols cost one GCS list and zero Firestore run-item scans).
  SNDK bounded re-run post-review: `coverage: FULL`, per-symbol log
  `planned=209 present=209 missing=0 enqueued=0`.

### S4 — Execute mode writes a real run doc + per-symbol summary

```
GCLOUD_PROJECT=alpha-vantage-proxy-api \
FIREBASE_SERVICE_ACCOUNT_ID=29825344315-compute@developer.gserviceaccount.com \
npx ts-node -r tsconfig-paths/register -P scripts/tsconfig.json \
  scripts/verify/options-data-220-corpus-reconcile.ts --symbols SNDK --execute
```

Expected: real `options_corpus_runs/{runId}` doc —
`status=completed` when zero gaps, `totalItems=0`, `perSymbol.SNDK`
present. With gaps: `in_progress` + item docs + real seed enqueues.

- **Result/evidence:** PASS — run doc `status=completed`, `totalItems=0`,
  `perSymbol` recorded (1 key). Residue: TTL'd run doc, same as any run.

### S5 — Deployed function: schedule exists + forced run completes

```
firebase deploy --only functions:reconcileOptionsCorpusCoverage
gcloud scheduler jobs list --location=us-central1 \
  --filter="id:reconcileOptionsCorpusCoverage" \
  --project=alpha-vantage-proxy-api
gcloud scheduler jobs run \
  firebase-schedule-reconcileOptionsCorpusCoverage-us-central1 \
  --location=us-central1 --project=alpha-vantage-proxy-api
```

Expected: scheduler job exists at `30 22 * * 1-5`
(America/Los_Angeles); forced run logs per-symbol lines +
`corpus-reconcile done — … symbols=130 …`; a new run doc
`options_corpus_runs-reconcile-{ts}` with `status=completed` and
`perSymbol` covering the enabled set.

- **Result/evidence:** PASS (2026-11-01). Deployed
  (`firebase deploy --only functions:reconcileOptionsCorpusCoverage` —
  "Successful update operation"); scheduler job
  `firebase-schedule-reconcileOptionsCorpusCoverage-us-central1` confirmed
  ENABLED at `30 22 * * 1-5` America/Los_Angeles; forced run completed:
  `runId=options_corpus_runs-reconcile-1793563246663`, per-symbol lines
  for all 130 symbols (`planned=209 present=209 missing=0 enqueued=0`),
  and `corpus-reconcile done — symbols=130 expected=209 gaps=0
  enqueued=0 suppressed=0 failed=0`. Run doc verified live:
  `status=completed`, `totalItems=0`, `perSymbol` covering the full
  130-symbol enabled set.

### S6 — Gap → dispatch → heal (J5)

Current prod state is `coverage: FULL` — no live gap to heal. Evidence by
equivalence: the identical `planCorpusRun` + seed-queue dispatch path
healed SNDK/2026-09-21 end-to-end during #224 live QA (object stored,
items recorded, pick/ts-build fanout fired). Optional stronger check:
delete one corpus object for one symbol/date, force-run the scheduler
(S5), confirm the run enqueues the date and the object is restored.

- **Result/evidence:** PASS by equivalence (SNDK/2026-09-21 live heal via
  the identical dispatch path, #224 UAT S4). Induced-gap check deferred —
  prod currently has no gaps; destructive induction optional.

### S7 — Idempotency: second sweep suppresses live-queued gaps

Unit-proven (reconcile suite: a second sweep reading back its own
dispatched items suppresses all 4 — `suppressed=4, enqueued=0`). Live:
the covered-state sweep is the common case and enqueues zero.

- **Result/evidence:** PASS — unit idempotency test + S3/S4 zero-dispatch.

## Traceability

| Acceptance criterion | Scenario |
|---|---|
| Scheduled function iterates live enabled-symbol list each run | S5 (deployed), S3 (live set read fresh) |
| Coverage diff reuses coverage listing + TradingCalendarService dates | S1, S3 |
| Missing items → existing seed queue; re-run idempotent | S1, S4, S6, S7 |
| Run doc records per-symbol planned/present/missing/enqueued | S4, S5 |
| SNDK/2026-09-21 gap heals end-to-end | S6 |
| Unit tests for the diff logic (weekend/holiday edges) | S1 |
| PRD story 8: per-symbol log lines | S3 output, S5 logs |

## Regression checklist

- [x] Nightly/sweep/pilot seeding unchanged — planner `items` is additive;
  computed mode unchanged (pilot + nightly suites green)
- [x] Coverage service behavior unchanged — `isLiveQueueEntry`/
  `latestItemsByDate` extractions are pure moves (coverage suite green)
- [x] `listItemsForSymbol`, `markRunStatus` unchanged; `updateRunSummary`
  additive only
- [x] `run-all.ts` untouched by the reconcile script (comment-only entry —
  it's mutating/manual)

## Result

**PASS (2026-11-01)** — all scenarios green, including the deployed-
function evidence: scheduler exists (`30 22 * * 1-5` PT), forced run
`options_corpus_runs-reconcile-1793563246663` completed with
`status=completed`, `totalItems=0`, `perSymbol` = 130 symbols,
`gaps=0 enqueued=0 suppressed=0 failed=0` (coverage FULL).
