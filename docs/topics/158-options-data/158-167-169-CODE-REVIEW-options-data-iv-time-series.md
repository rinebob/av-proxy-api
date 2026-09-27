**Topic:** IV time series  
**Topic Slug:** iv-time-series  
**Thread:** IV history for all tracked symbols  
**Thread Slug:** iv-history-tracked-symbols  
**Issue:** #167  
**Task:** #169  
**Thread Parent:** #159  
**Topic Parent:** #158  
**Domain:** OPTIONS-DATA  
**Type:** CODE-REVIEW  
**Status:** Complete  
**Created:** 2026-09-26  
**Last Updated:** 2026-09-26  

# Code Review — Task #169: IV30 metric computer + registry

## Scope

- `functions/src/v2/symbol-metrics/types.ts`, `metrics/iv30.computer.ts`, `metrics/registry.ts` (new)
- `functions/tests/v2/symbol-metrics/{iv30.computer,registry}.test.ts` (new)
- `functions/scripts/verify/options-data-169-iv30-computer.{ts,md}` + README row
- `shared/options/symbol-metrics.types.ts` — `TimestampLike` deduped to canonical `shared/firestore/timestamp`

## Standards

- **Fixed:** `computeDayMetrics` explicit return type `SymbolMetricDayEntry | null`.
- **Fixed:** registry's import-time throw removed — `registry.test.ts` already asserts fields ⊆ whitelist; module load is now side-effect-free.
- **Fixed:** verify-script `any[]` annotations → `AvOptionContract` / `CompactBar`.
- **Fixed:** duplicated `daysBetween` per expiration — DTE computed once per expiration.
- Accepted/deferred: verify README row ordering (cosmetic).

## Spec

- All recipe requirements met: OTM-side selection, total-variance interpolation, `[0.005, 5.0]` bounds, expired/same-day exclusion, `null` on empty, `nearest` fallback.
- **Fixed:** exact-DTE-30 expiration was labeled `nearest` — now `interpolated` (degenerate t=0 interpolation).
- **Fixed:** `iv30Contracts` overcounted all valid expirations — now counts only contributing expirations (bracketing pair, or nearest).
- **Fixed:** strike == close kept put side arbitrarily — now averages valid side IVs.
- Verified in prod: QQQ 2024-01-05 → `iv30 = 0.161`, `interpolated`, 498 contributing contracts.

## Thermo-nuclear

- **Major (fixed):** malformed `expiration`/`date` produced NaN DTE that survived the `dte <= 0` filter and emitted `iv30: NaN` — now `Number.isFinite(dte)` guards.
- **Major (fixed):** exact-tenor mislabel (above).
- **Minor (fixed):** `iv30Contracts` semantics, module-load throw, `any` fixtures.
- **Accepted:** nearest-tie picks shorter DTE (deterministic, documented); duplicate same-strike rows last-write-wins (documented — corpus chains are unique per key); no real-shape QQQ fixture in unit tests (verify script covers real data end-to-end).

## Round 2 (post-fix re-review)

All three axes re-ran on the rewritten computer (findIndex bracket, slot
invariant, exact-tenor, contributing-count). Verified sound — and:

- **Fixed:** `iv30Contracts` docstring clarified (usable-IV contracts in
  contributing expirations — a chain-depth signal, not a leg count).
- **Fixed:** dead defensive guards dropped — the slot invariant (only
  IV-valid contracts enter `byStrike`) makes them unreachable; `ivAtStrike`
  now returns `number`.
- **Fixed:** `MetricComputer.fields` typed `readonly SymbolMetricField[]` —
  whitelist conformance is now compile-time.
- **Fixed:** verify `assert` → `asserts condition` (drops `entry!` assertions);
  duplicate-DTE comment documented; `s === close` float equality accepted
  (spec-literal, spec-silent on near-equality).
- **New tests:** close below all strikes (`splitIdx===-1` path), non-numeric
  strike skip — 22 computer + 3 registry + 6 types tests.

## Rounds 3–4 (convergence passes)

Round 3 found and fixed:

- `strike: ''`/`'   '` parsed as `Number('') === 0` → phantom strike-0 slot;
  now rejected via `trim()` + empty check before parsing.
- `StrikeSlot` refactored to store parsed IVs (`{put?: number; call?: number}`) —
  the valid-IV invariant is structural; the `!` and double-parse are gone.
- Registry comment reworded; verify-script redundant `!`s removed via
  `asserts condition`.

Round 4 (single combined pass, instructed to report only defensible findings):

- Verify-script IV bound was strict where `parseIv` is inclusive — aligned to
  `>= 0.005 && <= 5`.
- Whitespace-strike test added to the non-numeric-strike case.
- Otherwise **NO FINDINGS** — slot invariant verified airtight, bracketing
  math traced, spec conformance confirmed line-by-line.

## Test results

- `npx jest tests/v2/symbol-metrics/ tests/shared/options/` — 28/28 green.
- Full suite: 74 suites / 704 tests green; `tsc --noEmit` clean.
- `options-data-169-iv30-computer.ts` — all checks pass against prod
  (QQQ 2024-01-05 → iv30 0.1612, interpolated, 498 contributing contracts).

## Verdict

**PASS** — all critical/major findings fixed with regression tests; minors fixed or documented.
