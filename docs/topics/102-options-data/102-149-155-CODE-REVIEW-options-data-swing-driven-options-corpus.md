**Topic:** Swing-driven options corpus platform
**Topic Slug:** swing-driven-options-corpus
**Thread:** Options corpus ingest
**Thread Slug:** options-corpus-ingest
**Blueprint:** #149 (BE Blueprint)
**Task:** #155 (backfillOptionsCorpus admin endpoint)
**Thread Parent:** #106
**Topic Parent:** #102
**Domain:** OPTIONS-DATA
**Type:** CODE-REVIEW
**Status:** Complete
**Created:** 2026-09-26
**Last Updated:** 2026-09-26

# Code Review — Task #155: pivot-driven corpus backfill

## Scope reviewed

User-approved design fold-in: `triggerHistoricalOptionsPilot` gains
`dateSource: 'pivots'` — plans per-symbol corpus dates via `planPivotSeeds`
instead of the trading calendar, carries `kind` through to seed payloads,
adds a `perSymbol` report, skips run-plan persistence unless executing.

## Standards

Reuses the pilot's secret gate, enabled-set filtering, coverage manifest,
and dispatch — one admin surface instead of two. Findings **fixed during
review**:

- **MAJOR → fixed:** serial `gcs.getMetadata` + serial `enqueueTask` would
  exceed the 120s trigger timeout on a full-universe pivots backfill (the
  20-dates bound that protected calendar mode is gone). Both loops now
  chunked at 20 (fanout convention); handler timeout raised to 540s.
- O(n²) `manifest.find` in the dispatch loop → `Map` keyed by
  `symbol_date`.
- All-covered execute left the run doc `in_progress` forever → nightly
  convention (`missing===0 → 'completed'`).
- `dryRun=false` + `execute=false` wrote a permanently-planned run doc →
  `createRunPlan` now gated on `execute`.
- Invalid `dateSource` silently coerced to calendar → now 400s.

Accepted minors: pivots run-doc reports `pilot: false` (backfill ≠ bounded
pilot — matches fanout); `report.symbols` includes planner-failed symbols
(traceable via `perSymbol.error`); dryRun `runId` is ephemeral (calendar
dryRun already persisted a plan — pivots is strictly more honest).

## Spec

All ACs met:

- `x-admin-secret` gate shared — runs before any body handling
- dryRun: zero writes, zero dispatch, real per-symbol counts
- symbols subset + absent → enabled set (non-enabled dropped to `skippedSymbols`)
- per-symbol report: `planned/present/missing/enqueued/error` — richer than
  the AC's `generated/skipped/failed` (`generated≈enqueued`, `skipped≈present`,
  `failed≈error`)
- pacing: serial dispatch replaced by chunked-after-diff dispatch, but AV
  pacing is downstream — seed queue `maxConcurrentDispatches:1, 1/s` +
  `av-throttle` in retrieval. Dispatcher never calls AV, so "no batching"
  applies to fetches, not task enqueues.
- unit tests + prod dryRun verify script

## Thermo-nuclear

One seam (`planPivots`) added to an existing deep module; the pivots branch
reuses manifest/dispatch untouched — no parallel mechanism created.
Ephemeral dryRun runId is honest (nothing was persisted).

## Test results

`npm run build` clean; 71 suites / 674 tests green. Live prod dryRun passed:
129 enabled symbols enumerated, all report invariants held, subset +
non-enabled-drop verified. All symbols currently show `planned=0` — corpus
swing docs for the enabled set haven't been generated yet (deferred mass
generation); the dryRun correctly previews zero AV spend until they exist.

## Round 2 (post-fix re-review)

- **Fixed:** partial dispatch failure previously orphaned the run at
  `'planned'` — `markRunStatus` now precedes dispatch (`in_progress`, or
  `completed` when nothing is missing); item dedupe guard added to the
  pivots item loop (defense-in-depth — planner already dedupes).
- **New tests:** all-covered execute → `'completed'`; dispatch-failure →
  run marked `in_progress` before any enqueue.
- Residuals accepted (both axes LOW/pre-existing): calendar-mode dryRun
  still persists a plan via `planCorpusRun` (pre-#155 semantics, unchanged);
  ephemeral dryRun runId has no doc by design; `Date.now` runId collisions
  are acceptable for an operator tool.
- Chunked `Promise.all` dispatch is throughput, not batching — each task is
  one (symbol,date); AV pacing remains queue-rate-limit + av-throttle in
  the worker.

## Verdict

**PASS** — all ACs met; round-1 blocking finding (serial I/O under a 120s
timeout) and round-2 findings (orphaned 'planned' run on partial dispatch,
missing completed-when-empty status) were fixed with regression coverage.
71 suites / 676 tests green.
