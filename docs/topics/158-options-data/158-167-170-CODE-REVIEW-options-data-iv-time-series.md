**Topic:** IV time series  
**Topic Slug:** iv-time-series  
**Thread:** IV history for all tracked symbols  
**Thread Slug:** iv-history-tracked-symbols  
**Issue:** #167  
**Task:** #170  
**Thread Parent:** #159  
**Topic Parent:** #158  
**Domain:** OPTIONS-DATA  
**Type:** CODE-REVIEW  
**Status:** Complete  
**Created:** 2026-09-26  
**Last Updated:** 2026-09-26  

# Code Review — Task #170: symbol-metrics repository + computeForDate

## Scope

- `functions/src/v2/symbol-metrics/services/symbol-metrics.repository.ts`, `build.service.ts` (new)
- `functions/src/v2/swing-set/services/daily-adjusted-reader.service.ts` (`toBar` extraction + `readDate`)
- Tests: `symbol-metrics/{repository,build.service}.test.ts`, `daily-adjusted-reader.test.ts` (readDate block)
- `tests/v2/swing-set/fake-firestore.ts` — merge semantics upgraded to real deep-merge
- Verify script `options-data-170-compute-for-date.{ts,md}` + README row

## Standards

- **Clean** — `toBar` extraction kills real duplication; deps-seam style matches
  `*Deps` injection conventions; no `any` outside the minimal typed stubs.
- File layout drifts slightly from the IMPL sketch (`build.service.ts` at
  module root vs `services/`) — accepted, consistent with sibling modules.

## Spec

- All ACs met: year-shard merge write dedupes by date; close from
  `CompactBar.c` (split-adjusted) via `readDate`, interim bars excluded;
  null compute / missing close / absent corpus → deterministic `written:false`
  with zero writes; fake-Firestore + fake-GCS seams.
- **Major → fixed:** the original read-modify-write upsert relied on a read
  snapshot and could lose concurrent sibling dates. Replaced with a pure
  `set(merge:true)` write — Firestore deep-merges nested maps server-side, so
  `days.{date}` unions atomically (single-writer-per-(sym,date) requirement
  satisfied with no RMW window). Shared test fake upgraded to real recursive
  deep-merge so tests now reflect production semantics.

## Thermo-nuclear

- **Medium → fixed:** dead RMW read removed (same recommendation).
- **Medium → fixed:** `corpus.response?.data` weakened an already-narrowed
  type; now `corpus.response.data`, and CORRUPT results log `reason` (warn)
  instead of silently skipping.
- **Low:** `readDate` takes no date-format validation — malformed dates
  return null rather than throwing; acceptable, documented.
- **Accepted:** `Object.keys(entry) as SymbolMetricField[]` is accurate —
  computers can only emit whitelisted fields (compile-time `SymbolMetricField[]`).

## Rounds 2–4 (convergence passes)

Round 2 (3 axes) found and fixed:

- **Per-entry replace semantics:** plain `merge: true` unions the day entry's
  fields too — a metric declining on recompute would leave stale values.
  `upsertDay` now writes with `mergeFields: ['symbol','year','days.{date}',
  'updatedAt']` → the date entry is replaced wholesale, siblings untouched.
  Fake `firestore` implements `mergeFields` dot-paths faithfully
  (copy-on-write, throws when a listed path is absent — matching real
  Firestore).
- **Date validation:** `computeForDate` guards `/^\d{4}-\d{2}-\d{2}$/` →
  deterministic skip; `upsertDay` throws on malformed dates (a dotted date
  would corrupt the field path).
- **Undefined fields stripped** in `computeDayMetrics` — Firestore rejects
  `undefined` on write.
- `corpus.response.data` non-optional post-narrow; CORRUPT warns.
- Verified on prod after the mergeFields change: full round trip PASS.

Round 3 (combined): verified all round-2 changes; two minors fixed
(repo-side date guard; fake copy-on-write).

Round 4 (final): **NO FINDINGS.**

## Test results

- New: 8 repository + 6 build-service + 4 readDate tests; fake-upgrade
  regression-clean across all 278 fake-consumer tests.
- Full suite: 76 suites / 724 tests green; `tsc --noEmit` clean.
- Prod verify: `computeForDate(QQQ, 2024-01-05)` → written, read-back
  `iv30=0.1612`, idempotent recompute — PASS.

## Verdict

**PASS** — the concurrency fix (pure merge write) is the meaningful outcome;
all other findings fixed or documented.
