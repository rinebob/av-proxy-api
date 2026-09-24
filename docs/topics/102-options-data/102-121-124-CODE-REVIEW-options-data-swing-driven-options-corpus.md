**Topic:** Swing-driven options corpus platform  
**Topic Slug:** swing-driven-options-corpus  
**Thread:** Swing-set generation platform  
**Thread Slug:** swing-set-platform  
**Issue:** #121  
**Thread Parent:** #103  
**Topic Parent:** #102  
**Task:** #124  
**Domain:** OPTIONS-DATA  
**Type:** Code Review  
**Status:** Complete  
**Created:** 2026-09-23  
**Last Updated:** 2026-09-23  

---

# Code Review — Task #124: Swing-set data layer (repository + reader)

Three axes reviewed: `functions/src/v2/swing-set/` (repository, reader, types, barrel), `functions/src/v2/common/firestore/firestore-like.ts`, both test files, `shared/firestore/firestore.ts` (OPTIONS_SWING_SETS), verify script + guide, `run-all.ts`/`README.md` edits, and the `readDailyBars` migration in the #122/#123 verify scripts.

## Standards

- **Fixed (hard):** `as never` Firestore casts in tests → introduced `FirestoreLike` structural interfaces (`functions/src/v2/common/firestore/firestore-like.ts`); services take `FirestoreLike`, fakes satisfy it without casts.
- **Fixed (hard):** collection-name string literal in verify script → `FirestoreCollection.OPTIONS_SWING_SETS`.
- **Fixed:** mutating verify script (writes a prod probe doc) removed from `run-all.ts` and marked *(mutating, not in run-all)* per the #99 convention.
- **Fixed:** third `readDailyBars` copy — #122/#123 verify scripts migrated to `DailyAdjustedReader` + `toPriceBar`, which also closes the raw-close vs adjusted-close divergence between verify input and production input.
- Contract checks all pass: doc-id scheme, `set(merge)`, `getSymbolTimeSeriesYearsCollectionPath` signature, CompactBar field usage.

## Spec

- All five repository methods and the reader contract match the IMPL doc; all four acceptance criteria met; no scope creep.
- **Judgement call documented:** `getCurrentSwing` with no projection returns the last confirmed pivot's date as `extremeDate` — the current extreme *is* the pivot until the developing swing advances enough to paint a projection. Doc comment now states this explicitly.

## Thermo-nuclear

- **Fixed (minor→real):** reader now skips `barStatus !== 1` bars — interim PRE bars can carry partial OHLC that would have painted false pivots (prod read dropped 6764→6753 bars, confirming the filter catches real interim data).
- **Fixed:** `upsert` normalizes `doc.symbol` to uppercase (a lowercase-symbol doc would have been invisible to `listBySymbol`); `getCurrentSwing` guards `pivots` and applies the same confirmed-only filter as `listConfirmedPivots`; `toPriceBar` is now `static` (no instance state); non-null assertions in the reader replaced by destructured narrowing.
- Direction semantics verified correct both directions (projection.isHigh→'up'; trailing high pivot→'down').

## Test results

- `tests/v2/swing-set/`: **18/18 pass** (added lowercase-symbol normalization + `barStatus:0` interim-skip cases).
- Verify script: **PASS** against prod — write/get/listBySymbol/listConfirmedPivots/getCurrentSwing/delete round-trip on `ZZTEST` probe doc.
- Pre-existing unrelated failure unchanged: `contract-summary-aggregator.service.test.ts` import path (Thread #108).

## Verdict

**PASS** — all findings resolved or documented as deliberate semantics.
