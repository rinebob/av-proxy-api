**Topic:** Options Corpus Bulk Ingest  
**Topic Slug:** options-data  
**Thread:** Full-Date Corpus Backfill (2026)  
**Thread Slug:** full-date-backfill-2026  
**Issue:** #218  
**Thread Parent:** #214  
**Topic Parent:** #213  
**Task:** #221  
**Domain:** BE  
**Type:** CODE-REVIEW  
**Status:** Complete  
**Created:** 2026-10-27  
**Last Updated:** 2026-10-28  

# Code Review — Task #221: Picker core (pickCellsForDate)

## Files reviewed

- `functions/src/v2/historical-options-corpus/services/options-delta-picker.service.ts` (new)
- `functions/src/v2/historical-options-corpus/services/index.ts` (+1 barrel export)
- `functions/tests/v2/historical-options-corpus/options-delta-picker.service.test.ts` (new, 20 tests)
- `functions/scripts/verify/options-data-221-pick-cells.ts` + `.md` guide (new)
- `functions/scripts/verify/run-all.ts`, `README.md` (registration)
- `shared/options/options-delta-picks.types.ts` (`DayPick.underlyingClose`, `iv`/`mark`/`bid`/`ask`/`volume`/`openInterest` → optional)
- `docs/topics/213-options-data/213-215-SPEC-...` (schema table updated for optional fields)

## Standards axis

- Pure function, zero I/O, ~230 lines, single purpose — matches small-module
  convention. Reuses `isValidIsoDate`, `buildCellId`, `PICK_GRID` — no
  duplication.
- Field-parse boundary is explicit (`parseStrict`) — `Number('') === 0` trap
  handled; identity vs quote fields cleanly separated.
- `.service.ts` suffix for a function module vs sibling `.utils.ts` modules —
  nit; "picker core service" naming follows the Blueprint's language.
- Findings fixed in-review (all minor):
  - `noChainPickEntries` aliased one `DayMiss` object under 380 keys —
    now fresh per cell.
  - `row.type` unchecked cast → explicit `'put'|'call'` filter.
  - `Date.parse` leniency on `expiration` (`'2026-5-15'` parses) →
    `isValidIsoDate` gate; non-ISO expirations now ineligible.
  - `strike` re-parse at emit → carried on `EligibleRow`.

## Spec axis

Issue #221 ACs:

| AC | Status |
|---|---|
| One chain load computes all 380 cells | Met — one call → `Map<cellId, DayPickEntry>` of 380 |
| Nearest-DTE expiry then argmin\|observedDelta − target\|, signed deltas | Met — tested both types |
| `dte` = actual days-to-expiration | Met — recorded from chosen expiration |
| `no_match` for empty type/no usable expiry; `no_chain` caller-emitted | Met — `chain` param non-null (compile-enforced); `noChainPickEntries` helper for callers |
| Deterministic tie-breaks (documented) | Met — longer-DTE, larger \|delta\|, contractId; tested |
| Unit tests over fixture chain | Met — 20 tests |

TEST-doc edge cases: calls-only → `no_match` ✓, missing `underlyingClose` →
omitted ✓, both tie-breaks ✓. Year-shard/idempotency concerns belong to
#222/#223 (writer/fanout), correctly out of scope.

**Deviations (all documented in module header + issue comments):**
- Signature carries `symbol` — required for full `cellId` keys per the
  Blueprint's `Map<cellId, DayEntry>`.
- IMPL said "BE only, no SHARED changes" — `DayPick` quote/close fields
  widened to optional to satisfy the TEST edge case without fabricating
  data. Additive-compatible widening; SPEC schema table updated to match.
- Malformed `date` throws — fail-loud caller bug vs silent all-`no_match`.

## Thermo-nuclear axis

- Tests are behavioral, fixture-driven, no mocks needed (pure function).
  Tie-break and eligibility tests exercise real semantics, not internals.
- Determinism: Map insertion order can't leak into selection — both
  argmins use strict comparators with total tie-break chains.
- `daysTo`/eligibility reject malformed input rather than propagating —
  `dte < 0` excludes already-expired contracts; `dte === 0` (same-day)
  remains selectable.
- The `noChainPickEntries` shared-reference bug was the only genuine
  defect found — fixed (fresh object per cell).
- Golden-asset divergence (207 field diffs on `QQQ-put-20-45`) is a data
  question, not a code defect — asset predates corpus self-repair and
  interim supersession; reconciliation is Task #226's explicit scope.
  The independent oracle confirms SPEC semantics on all 7,980 cells.

## Test results

- Focused: 20/20 `options-delta-picker.service.test.ts` pass.
- Full suite: 88/88 suites, 900 tests pass.
- `tsc --noEmit`: clean.
- Prod verify `options-data-221-pick-cells.ts`: oracle agrees on all
  7,980 cells across 21 real GCS chains; golden diff report-only.

## Findings by severity

- **Critical:** none.
- **Major:** none.
- **Minor (all fixed in-review):** shared `DayMiss` alias; unchecked
  `type` cast; `Date.parse` leniency; `strike` re-parse; SPEC doc drift.
- **Nit:** `.service.ts` naming for a function module; `bestExp!`
  assertion (provably non-null after `size` guard).

## Second pass (2026-10-27, re-review until convergence)

Re-read all files post-fix; two new items found and fixed:

- **Oracle/picker eligibility drift** — the verify oracle gated expiration
  with a format regex while the picker uses `isValidIsoDate`; an impossible
  date (`2026-02-30`) would normalize via `Date.parse` in the oracle but be
  rejected by the picker → false `ORACLE-DIFF`. Oracle now imports
  `isValidIsoDate`. Verify re-run: still 0 diffs on 7,980 cells.
- **Aliasing regression pin** — added a `not.toBe` test asserting
  `noChainPickEntries` returns distinct entry objects per cell.

No other findings. Remaining surface is exhausted: pure function, ~230
lines, total-order tie-breaks, oracle-validated against real prod data.

## Verdict: PASS

All ACs met, all minor findings resolved, suite green, prod-data oracle
agreement on every cell. Ready for `/proj qa 213 221`.
