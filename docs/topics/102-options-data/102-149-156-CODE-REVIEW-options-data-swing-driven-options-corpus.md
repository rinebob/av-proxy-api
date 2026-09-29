**Topic:** Swing-driven options corpus platform  
**Topic Slug:** swing-driven-options-corpus  
**Thread:** Options corpus ingest  
**Thread Slug:** options-corpus-ingest  
**Issue:** #149  
**Thread Parent:** #106  
**Topic Parent:** #102  
**Task:** #156  
**Domain:** OPTIONS-DATA  
**Type:** Code Review  
**Status:** Complete  
**Created:** 2026-09-28  
**Last Updated:** 2026-09-28  

# Code Review — Task #156: Corpus coverage report surface

## Verdict: PASS

Three-axis review ran over three passes on the Task #156 working-tree
changes; every major finding was remediated in-review and each pass
re-verified the full final state. No remaining critical or major findings.

## Scope

| File | Change |
|---|---|
| `functions/src/v2/historical-options-corpus/services/corpus-coverage.service.ts` | New — deps-injected `runCorpusCoverage` core + prod wiring |
| `functions/src/v2/historical-options-corpus/handlers/corpus-coverage.http.ts` | New — `getHistoricalOptionsCorpusCoverage` admin endpoint |
| `functions/src/v2/historical-options-corpus/services/corpus-metadata.service.ts` | Added `listItemsForSymbol` |
| `functions/src/v2/historical-options-corpus/services/index.ts` | Barrel export |
| `functions/src/index.ts` | Function export |
| `functions/tests/v2/historical-options-corpus/corpus-coverage.service.test.ts` | New — 12 tests |
| `functions/scripts/verify/options-data-156-corpus-coverage.{ts,md}` | New — read-only verify script + guide |
| `functions/scripts/verify/README.md` | Index row |

## Standards — NITS

- No hard violations. Secret fails closed via shared `requireAdminSecret`;
  handler is a thin parse/auth/dispatch shell; deps-injected test pattern
  matches `corpus-sweep.core.test.ts`; verify script follows the #155
  convention.
- Nits addressed: stale "collectionGroup scan" docstrings corrected to
  describe the `array-contains` + per-run scan; duplicated zeroed report
  literal extracted into `emptySymbolReport`.
- Nit accepted: `unplanned` counter covers both `unplanned` and
  `superseded_interim`/`pre_floor` rows — documented on the field.

## Spec — PASS

- `x-admin-secret` gated; wrong secret 403 — `corpus-coverage.http.ts`
  `requireAdminSecret` (new secret `HISTORICAL_OPTIONS_COVERAGE_ADMIN_SECRET`;
  **deploy prerequisite: provision the secret**).
- Per-symbol planned/seeded/missing counts + per-date status — met, plus
  `failed`, `inFlight`, `unplanned` counts, `runStatus`/`error` detail, and
  `currentInterimDate` per the issue body.
- Absent `symbols` → all options-enabled; subset honored verbatim —
  non-enabled symbols reported flagged `optionsEnabled=false` rather than
  dropped (read surface; curation gate bounds spend, not reads).
- Zero writes — every dep is a read.
- Unit tests (12) + verify script — met; script ran green against prod.

## Thermo-nuclear — findings remediated in-review

**Pass 1 majors (fixed):**

1. `success`-latest run item with absent object reported `in_flight` forever
   (swept interim / deleted object). → Now reports `missing` with
   `runStatus: 'success'` preserved — a live coverage gap, truthfully.
2. `listItemsForSymbol` serial N+1 over all historical runs. → Per-run item
   fetches now bounded-parallel (chunks of 10) over the newest
   `RECENT_RUN_LIMIT = 50` runs — latest-wins ordering means only recent
   runs can matter.
3. `pending` items had `touchedAtMs=0`, losing latest-wins to older
   failures — a queued retry reported `failed`. → Falls back to the run
   doc's `createdAt`.

**Pass 2 majors (fixed):**

4. `pending`/`in_progress` items orphaned by a dead run reported `in_flight`
   forever. → `runState` (run doc status) is carried through
   `listItemsForSymbol`; queue entries in terminal runs (`completed`/
   `failed`) downgrade to `missing`.
5. Run docs are never reconciled to terminal after their items finish, so
   the `DEAD_RUN` check alone was dormant — a crashed run stays
   `in_progress` forever. → Added a 24h staleness bound
   (`STALE_QUEUE_MS`): queue entries untouched >24h are dead, not
   in-flight. A run-finalizer reconciler remains an upstream write-side
   follow-up; `runState` is surfaced on rows so operators see the real
   provenance.

**Minors (fixed or accepted):**

- Added `pre_floor` date status — stored objects below the 2019 corpus floor
  that the fanout deletes regardless of provenance were understating as
  generic `unplanned`.
- `skipped` (curation drop) reclassified `failed` → `missing` — nothing
  failed, the date was never attempted.
- Symbol normalization now reuses `normalizeSymbolList` — no forked logic.
- Accepted: the ~10-line plan-vs-GCS diff intentionally parallels the
  fanout's (read/write seams stay decoupled); `RECENT_RUN_LIMIT` windowing
  is documented on the method.

## Test results

- `functions`: `npx jest` — all suites pass except the unrelated
  `tests/shared/options/symbol-metrics.types.test.ts`, which fails to compile
  against uncommitted IV-rank field additions in
  `shared/options/symbol-metrics.types.ts` (in-progress Thread #159/#163
  work in the same working tree — not part of this change set).
- Corpus area: 22 suites / 174 tests pass, including the 16 new coverage
  tests (seeded/missing/failed/in_flight fold, latest-wins ordering, stale
  success → missing, pending > old failure, dead-run + stale-queue
  downgrades, skipped → missing, pre_floor, superseded_interim,
  subset/enabled defaulting, per-symbol isolation).
- Verify script `options-data-156-corpus-coverage.ts` ran green against prod,
  full enabled set: zero missing/failed across all symbols.

## Deploy prerequisites

- `firebase functions:secrets:set HISTORICAL_OPTIONS_COVERAGE_ADMIN_SECRET`
  before deploy, or the endpoint 403s unconditionally.
- No new Firestore indexes required.
