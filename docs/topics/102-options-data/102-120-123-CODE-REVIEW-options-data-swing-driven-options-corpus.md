**Topic:** Swing-driven options corpus platform  
**Topic Slug:** swing-driven-options-corpus  
**Thread:** Swing-set generation platform  
**Thread Slug:** swing-set-platform  
**Issue:** #120  
**Thread Parent:** #103  
**Topic Parent:** #102  
**Task:** #123  
**Domain:** OPTIONS-DATA  
**Type:** Code Review  
**Status:** Complete  
**Created:** 2026-09-23  
**Last Updated:** 2026-09-23  

---

# Code Review — Task #123: Swing-set types, paramsId, canonical configs

Three axes reviewed the change set: `shared/zigzag/swing-set.types.ts`, `canonical-configs.ts`, `index.ts` edits, `functions/tests/shared/zigzag/swing-set.types.test.ts`, `functions/scripts/verify/options-data-123-swing-set-types.{ts,md}`, and edits to `run-all.ts` + `README.md`.

## Standards

- No hard violations. `deriveParamsId` verified byte-identical to ST's `swing-analysis.types.ts` (doc keys will collide correctly across collections).
- Fixed during review: `SwingSetDoc` doc comment overstated ST parity — now explicitly states the doc is **not** readable by ST's `SwingAnalysisDoc` path (renamed `savedAt`→`generatedAt: TimestampLike`, no `id`/`userId`, different collection with `userId`-gated rules); ST consumes via `partnerSwingSetsV2` (#128).
- Judgement calls (accepted): `deriveParamsId`/`CANONICAL_ZIGZAG_CONFIGS` live in both repos — documented drift surface guarded by exact-id tests; `readDailyBars` duplicated between verify scripts — tolerable at two copies, extract to `verify/lib/` on a third.

## Spec

- All five acceptance criteria met: `SwingSetDoc` (+`source`), `deriveParamsId` identical to ST for all four canonical configs, `CANONICAL_ZIGZAG_CONFIGS` matches IMPL §3 verbatim, `DailyAdjustedBar` matches IMPL §5, all exported via the barrel.
- No scope creep — no writer (#124) or adapter function (#125) included.

## Thermo-nuclear

- Clean; no critical issues after fixes.
- Fixed during review: vacuous literal re-reads replaced by a JSON deep-equality round-trip assertion and a `doc.paramsId ↔ deriveParamsId(config)` consistency test; verify-script asserts now cross-check `doc.paramsId` against the literal ST contract rather than the assigned value; `projection?: Pivot | null` tri-state documented as verbatim ST parity.
- Noted: `DailyAdjustedBar` has no consumer until #125 (contract anchor, accepted); runtime function inside a `.types.ts` file mirrors ST's own layout.

## Test results

- `tests/shared/zigzag/`: **45/45 pass** (8 new in `swing-set.types.test.ts`).
- Verification script: **PASS** against prod (AAPL: all four canonical ids verified — `AAPL_dev10_L10_R10_1barY_projY` etc., swings/stats consistency per config).
- Full suite: same 6 pre-existing unrelated failures in `contract-summary-aggregator.service.test.ts` (broken relative import path — flagged for Thread #108).

## Verdict

**PASS** — all findings addressed or documented as deliberate contract decisions.
