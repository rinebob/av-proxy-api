**Topic:** Swing-driven options corpus platform  
**Topic Slug:** swing-driven-options-corpus  
**Thread:** Swing-set generation platform  
**Thread Slug:** swing-set-platform  
**Issue:** #120  
**Thread Parent:** #103  
**Topic Parent:** #102  
**Task:** #122  
**Domain:** OPTIONS-DATA  
**Type:** Code Review  
**Status:** Complete  
**Created:** 2026-09-23  
**Last Updated:** 2026-09-23  

---

# Code Review — Task #122: Port ZigZag engine into shared/zigzag

Three axes reviewed the change set: `shared/zigzag/*` (6 files), `functions/tests/shared/zigzag/*` (3 files), `functions/scripts/verify/options-data-122-zigzag-engine.{ts,md}`, and edits to `run-all.ts` + `README.md`.

## Standards

**Fixed during review:**
- `lineColor`/`showTriggerDots` were required dead render-only fields — made optional with a doc note explaining they're retained for persisted-config compatibility with ST's swing-set document shape (`zigzag.types.ts`).
- Vacuous assertions in two projection tests — replaced conditional `if (result.projection)` guards with strict `toBeDefined()` assertions; one fixture genuinely produced no projection, so it was replaced with a fixture that does (`zigzag.pivots.test.ts`).
- Hardcoded Firestore path in the verify script — switched to the canonical `getSymbolTimeSeriesYearsCollectionPath` builder.
- Silent `?? 0` price defaults in the verify-script bar mapping — now skips bars missing `h`/`l`/`c` and uses `c` (split-adjusted close) with documented intent.
- Unguarded `swings[swings.length - 1]` — added a length assertion.

**Judgement calls (accepted):**
- `isPivotPoint` vs `isValidProjection` similarity — intentional asymmetry, port fidelity preserved.
- `Swing.start`/`end` data clump and `PriceBar` `date`+`x` duality — inherited from ST schema; changing them would break doc compat.

## Spec

- All acceptance criteria met: five engine exports re-exported from the barrel, `shared` build compiles, no Angular imports.
- Port fidelity verified line-for-line: zero logic divergence from `st-zigzag.*.ts`; test counts match exactly (pivots 23=23, swings 8=8, stats 7=7).
- Minor notes: `shared/package.json` `main: lib/index.js` dangles (pre-existing, consumers use `@shared/<dir>` subpaths); IMPL doc file tree mixes #122/#123 scope.

## Thermo-nuclear

- Largest file 351 lines; pure functions; typed fixtures; deterministic tests.
- `deriveSwings(pivots, bars?, projection?)` positional-optionals + silent `volume: 0`, and `processPivot`'s redundant `lastPivot` param — kept verbatim for port fidelity; redesign deferred to a post-parity refactor if ever needed.
- NaN-handling asymmetry between `isPivotPoint`/`isValidProjection` confirmed verbatim from the ST original.

## Test results

- `tests/shared/zigzag/`: **38/38 pass**.
- Full suite: 499/505 pass. The 6 failures are in `tests/v2/historical-options-corpus/services/contract-summary-aggregator.service.test.ts` — a **pre-existing broken import path** (`../../../src/` is one level short; the file sits in a `services/` subdir). Unrelated to this task — candidate for Thread #108 misc fixes.
- Verification script: **PASS** against prod (AAPL 6,764 bars → 492 pivots @ 5/5/5; alternation, ordering, swing/stat consistency, date round-trip all confirmed).

## Verdict

**PASS** — the one major finding (vacuous assertions) and all actionable minors were fixed; remaining notes are documented port-fidelity decisions.

---

## Re-review — Round 2 (2026-09-23)

All three axes re-ran against the final state.

- **Standards:** no hard violations; prior findings confirmed resolved. Judgement calls: depth-check loop duplication (port fidelity), `processPivot` naming (port fidelity), `PriceBar` `date`+`x` duality (ST schema compat).
- **Spec:** no findings — port fidelity re-verified line-for-line; the replaced projection fixture was hand-validated as strictly stronger than the original.
- **Thermo-nuclear:** no critical/major findings. Prior findings confirmed resolved.

**Fixed in round 2:**
- `index.ts` now documents the deliberate omission of `computeTriggerPoints`/`TriggerPoint` (chart-only, not needed backend-side).
- Removed stray `return;` and clarified the `open` fallback comment in the verify script.

**Deferred minors (non-blocking):**
- `findProjectionPivot` fallback-scan path lacks a dedicated test (same gap exists in the ST spec).
- No stats test for NaN-duration filtering; swings tests don't cover `volume: undefined`.
- Verify script checks the compiled module + internal consistency only — no consumer exists yet (service lands in #125); stats asserts are count-only.
