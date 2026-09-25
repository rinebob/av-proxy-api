**Topic:** Swing-driven options corpus platform
**Topic Slug:** swing-driven-options-corpus
**Thread:** Options corpus ingest
**Thread Slug:** options-corpus-ingest
**Blueprint:** #149 (BE Blueprint)
**Task:** #151 (Swing-doc pivot planner)
**Thread Parent:** #106
**Topic Parent:** #102
**Domain:** OPTIONS-DATA
**Type:** CODE-REVIEW
**Status:** Approved
**Created:** 2026-09-25
**Last Updated:** 2026-09-25

# Code Review — Task #151: swing-doc pivot planner

## Scope reviewed

- `pivot-work-planner.ts` (new) — `planPivotSeeds` + `createPivotPlannerDeps`
- `pivot-work-planner.test.ts` (new, 9 tests)
- Semantics cross-checked against `SwingSetRepository.getCurrentSwing`, `shared/zigzag` engine, `CANONICAL_ZIGZAG_CONFIGS`, and PRD #110 user stories 1 & 5.

## Findings and remediation

### Resolved during review (all low)

- **`projection.confirmed` unchecked** — engine always writes projections `confirmed:false`, but a malformed doc could emit a bogus interim. Guard added (`projection && !projection.confirmed`) + test.
- **`source` not filtered** — an `'st'`-sourced doc with a canonical paramsId could drive corpus spend. `d.source !== 'st'` added + test.
- **Coverage gaps** — added the combined malformed-projection / st-source test case.

### Second pass (post-remediation verification)

- `source !== 'st'` blacklist is the right default: the sole in-repo writer stamps `source:'sa'` unconditionally (`swing-set-generation.service.ts`), and a doc missing the field would be a legacy SA write that must not be dropped. **Note:** ST does not write `options-swing-sets` at all — it reads via `partnerSwingSetsV2` and persists to its own `st-swing-sets` collection (per `swing-set.types.ts` header), so the filter is belt-and-suspenders against any future direct ST write.
- `!projection.confirmed` guard + combined regression test verified; dedupe/sort/deps unchanged.

### Verified clean

- `Pivot.time` → session-date mapping is exact: engine sets `time = bars[i].x` with `x = bar.date T00:00:00Z`; `toDay` recovers it identically to the repository's `extremeDate`.
- Interim semantics agree with #154's supersede/delete design: projection is the supersedeable interim; the last confirmed pivot stays `confirmed`.
- Tri-state projection (`Pivot | null | undefined`), canonical-paramsId filter, dedupe-by-date with confirmed precedence, uppercase keying, FirestoreLike wiring — all correct.

## Verification

- **9/9** planner tests, full suite green, build clean.

## Verdict

**PASS** — semantics verified against the swing engine and repository; all findings were defensive nits, now fixed with tests.
