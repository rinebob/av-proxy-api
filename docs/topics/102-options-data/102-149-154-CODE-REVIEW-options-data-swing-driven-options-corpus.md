**Topic:** Swing-driven options corpus platform
**Topic Slug:** swing-driven-options-corpus
**Thread:** Options corpus ingest
**Thread Slug:** options-corpus-ingest
**Blueprint:** #149 (BE Blueprint)
**Task:** #154 (Ongoing maintenance — pivot hooks + corpus sweep + interim delete)
**Thread Parent:** #106
**Topic Parent:** #102
**Domain:** OPTIONS-DATA
**Type:** CODE-REVIEW
**Status:** Complete
**Created:** 2026-09-26
**Last Updated:** 2026-09-26

# Code Review — Task #154: corpus reconcile sweep + interim supersede

## Scope reviewed

`fanoutPivotSeeds` upgraded from dispatch-everything to coverage-aware
reconcile: GCS object listing → diff vs planned pivot dates → enqueue only
missing (kind-stamped) → delete superseded `kind='interim'` objects.
Supporting changes: `CorpusSeedPayload.kind`, `GcsCorpusAdapter.listItems /
deleteItem / writeItem kind stamp`, worker passes `kind`, new
`runCorpusSweep` core + `sweepHistoricalOptionsCorpus` scheduler (9 PM PT,
after the swing sweep).

## Standards

Seam style consistent with `pilot.service`/`nightly-corpus.service`;
scheduler config identical to `sweepSwingSets`; `getFiles` auto-paginates;
delete/seed sets disjoint by construction. Findings **fixed during review**:

- **MAJOR → fixed:** seed-worker retry re-enqueue dropped `kind` — retried
  interim writes would escape the supersede scan forever. Retry payload now
  carries `kind`; regression test added.
- `writeItem`'s doc comment had been detached above `listItems` — restored;
  `kind` param documented.
- `GcsCorpusObjectRef.kind` / `writeItem` param tightened `string` →
  `CorpusItemKind`.
- Documented the conservative early-return: an absent/empty swing doc skips
  the object scan entirely (deleting all interims on a transiently-missing
  doc is unsafe).

Remaining minors (accepted):

- Interim stamps are never re-stamped `confirmed` on promotion —
  correctness relies on `pivotDates` being append-only (it is;
  `generation.service.ts` writes the full pivot list, never a shrink).
- Unmarked objects that coincide with an interim date can't become
  deletable — no distinguishing provenance; accepted by design.
- `CorpusSweepDeps` names (`listObjects`/`deleteObject`) wrap adapter
  `listItems`/`deleteItem` — cosmetic drift.
- Sweep reconciles serially; fine at current enabled-set size, may need
  parallelism later (540s budget).

## Spec

All five ACs met:

- new confirmed pivot → enqueued (missing-diff on regen + sweep backstop)
- advancing extreme → new date seeded, prior interim deleted (verified live)
- swing completes → promoted date stays in `pivotDates` → object retained
- scheduled sweep enumerates enabled set and fills gaps
- supersede/delete edge cases unit-tested, incl. warn-not-fail delete and
  retry-preserves-kind

## Thermo-nuclear

Provenance stamp is the honest way to make supersede derivable with "no
state doc"; delete predicate is provably safe (only objects WE stamped
`interim` can be targets; confirmed dates can't exit an append-only
`pivotDates`). No abstraction leaks; result type carries `deleted` through.

## Test results

`npm run build` clean; `npx jest --coverage=false` → 71 suites / 670 tests
green. Live prod verify `options-data-154-corpus-sweep.ts` passed twice:
planned=3, enqueued=2 (missing only), deleted=1 (real GCS object removed),
unmarked object retained, dispatched tasks terminal via the disabled gate.

## Verdict

**PASS** — all ACs met; the one blocking-class finding (retry kind drop)
was fixed in-review with regression coverage.
