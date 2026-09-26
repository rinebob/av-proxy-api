**Topic:** Swing-driven options corpus platform
**Topic Slug:** swing-driven-options-corpus
**Thread:** Options corpus ingest
**Thread Slug:** options-corpus-ingest
**Blueprint:** #149 (BE Blueprint)
**Task:** #153 (Enable trigger — optionsEnabled false→true seeds all historical pivots)
**Thread Parent:** #106
**Topic Parent:** #102
**Domain:** OPTIONS-DATA
**Type:** CODE-REVIEW
**Status:** Complete
**Created:** 2026-09-26
**Last Updated:** 2026-09-26

# Code Review — Task #153: pivot-seed fanout on enable + generation

## Scope reviewed

New `fanoutPivotSeeds` service (planner → corpus run plan → per-item Stage-1
seed task dispatch) plus warn-not-fail hooks in `set-options-enabled.core`
(false→true), `generate-swing-sets.core` (`onGenerated` after successful
generation), and `swing-set-sweep.core` (per regenerated symbol) — the
enable → generate → fanout chain that makes first-enable seeding work when
the swing doc doesn't exist at enable time.

## Standards

Dep-injection seam mirrors `pivot-work-planner.ts`; warn-not-fail posture
matches the existing `enqueue` call site and `notifySeedSuccess`; all four
prod wiring sites consistent; tests follow neighboring conventions.

Findings **fixed during review**:

- Sequential per-item enqueue inside the 60s callable → chunked
  `Promise.all` (20/batch).
- `createRunPlan` single batch caps at ~500 writes (reachable for the first
  time via pivot fanouts) → item writes chunked at 450.
- `markRunStatus('in_progress')` moved ahead of the enqueue loop so a
  mid-loop failure doesn't leave a `planned` run with dispatched tasks.
- `OPTIONS_CORPUS_SEED_TASK_QUEUE` hoisted to `types.ts` (service no longer
  imports a handler module).

Remaining minors (accepted, pattern-consistent or out of scope):

- `Date.now()` runId suffix — collision only under same-ms re-entry
  (callers are serialized awaits).
- `CorpusRunDoc.status` never transitions to `completed` — pre-existing
  gap shared with pilot/nightly paths; candidate for #154 reconcile.
- `PivotWorkItem.kind` is dropped into `CorpusItemDoc` (no schema field) —
  interim-snapshot supersede is #154's scope.

## Spec

All four ACs met:

- false→true enqueues the full pivot seed set — via the documented two-path
  chain (direct `seedCorpus` covers re-enable/existing doc; `onGenerated`
  covers first-enable after generation completes).
- enqueue failure warns, never fails the curation write (all three call
  sites swallow to warn).
- same-value no-op enqueues nothing (early return before hooks).
- Unit tests at every seam (10 new).

Contract checks: `CorpusSeedPayload {runId,symbol,date,attempt:1}` matches
the worker; item docs committed `pending` before dispatch; `skipped`
status exists; cross-run dedupe lands on the worker's GCS-metadata hit.

## Thermo-nuclear

Small single-purpose service; no abstraction leaks; optional-dep hooks are
minimal footprint. Volume note (accepted): each swing regeneration re-fans
out N seed tasks (cheap `gcs-hit` skips) — #154's reconcile is the place to
trim if it gets noisy.

## Test results

`npm run build` clean; `npx jest --coverage=false` → 70 suites / 659 tests
green. Live prod verify `options-data-153-enable-seed-fanout.ts` passed
twice (pre- and post-review fixes): real task dispatch → deployed worker →
terminal `skipped` items, zero AV calls.

## Verdict

**PASS** — ACs met, patterns consistent, review findings addressed in-line.
