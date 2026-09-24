**Topic:** Swing-driven options corpus platform  
**Topic Slug:** swing-driven-options-corpus  
**Thread:** Swing-set generation platform  
**Thread Slug:** swing-set-platform  
**Issue:** #121  
**Thread Parent:** #103  
**Topic Parent:** #102  
**Task:** #125  
**Domain:** OPTIONS-DATA  
**Type:** Code Review  
**Status:** Complete  
**Created:** 2026-09-23  
**Last Updated:** 2026-09-23  

---

# Code Review — Task #125: SwingSetGenerationService

Three axes reviewed: `swing-set-generation.service.ts`, `types.ts`/`index.ts` edits, the service test, and `options-data-125-swing-set-generation.{ts,md}` + `run-all.ts` comment.

## Standards

- **Fixed (real flaw):** test fixture generated invalid dates (`2026-01-32`…`2026-01-60`) → `Invalid Date` → `NaN` pivot times persisted. Now uses real sequential UTC dates; a `Number.isFinite(p.time)` assertion was added so this class of bug can't go silent again.
- **Fixed:** verify script previously overwrote then deleted *real* `{SYMBOL}_*` docs — a pre-flight `listBySymbol` now aborts if the symbol already has swing sets.
- Judgement calls accepted: sequential `upsert` loop (idempotent via `set(merge)`; partial-failure is self-healing on retry); `LoggerLike` is a new but justified seam (no prior logger interface exists).

## Spec

- All four acceptance criteria met; no scope creep.
- **Fixed:** `generatedAt` now uses `Timestamp.now()` — the manual `{seconds, nanoseconds:0}` literal would have persisted as a *map*, breaking consumers calling `.toDate()`.
- IMPL doc §1 amended to match the implementation (positional deps, `Promise<SwingSetDoc | null>`, iterate-not-delegate, idempotency caveat) — the code deviations are improvements, docs were the drift.

## Thermo-nuclear

- **Fixed (major):** same `generatedAt` map-vs-timestamp issue as Spec.
- **Fixed:** `loadPriceBars` helper extracted (removes the duplicated normalize/read/map in both public methods).
- Verified: `projection ?? null` is load-bearing under `set(merge)` — omitting it would leave a stale projection; "reads bars once per symbol" is a real perf property guarded by the mock; idempotency compare in the verify script (all fields except `generatedAt`) is sound.
- Noted: `generateForConfig` re-reads bars — correct for standalone use; intended callers (#126/#127) use `generateForSymbol`.

## Test results

- `tests/v2/swing-set/`: **24/24 pass**.
- Verify script: **PASS** against prod — all four canonical docs written with real engine output (e.g. `dev5_L5_R5_1barY_projY`: 495 pivots), idempotent re-run, docs deleted on exit; pre-flight guard verified.
- Pre-existing unrelated failure unchanged (`contract-summary-aggregator.service.test.ts` import path — Thread #108).

## Re-review (second pass)

All fixes verified on all three axes:

- `Timestamp.now()` structurally satisfies `TimestampLike`; the `firebase-admin/firestore` module-scope import matches 25+ v2 modules — no side effects, test seam intact.
- Fixture math verified independently: 15-bar monotonic legs at ±2%/bar yield ≈+34.6%/−26.1% reversals — confirmed pivots at indices 14/29/44 + 1 projection for *every* canonical config; test now asserts the exact structure.
- Pre-flight abort runs before any write; `finally` can't fire on abort.
- Remaining nits applied: `symbol.trim().toUpperCase()`, `persistDoc` extraction, exact pivot-structure assertions.

No critical or major findings remain; one judgement call stands (sequential upserts vs `WriteBatch` — `FirestoreLike` has no batch surface and idempotent re-runs make partial states self-healing).

## Verdict

**PASS** — one real data-integrity fix (Timestamp), one test-fixture fix (NaN dates), one prod-safety fix (pre-flight abort), doc drift corrected; re-review confirmed all fixes plus strengthened test assertions.
