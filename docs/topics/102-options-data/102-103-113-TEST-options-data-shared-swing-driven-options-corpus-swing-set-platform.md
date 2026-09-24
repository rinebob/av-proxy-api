**Topic:** Swing-driven options corpus platform  
**Topic Slug:** swing-driven-options-corpus  
**Thread:** Swing-set generation platform  
**Thread Slug:** swing-set-platform  
**Issue:** #113  
**Thread Parent:** #103  
**Topic Parent:** #102  
**Domain:** OPTIONS-DATA  
**Type:** Test Plan  
**Status:** Approved  
**Created:** 2026-09-23  
**Last Updated:** 2026-09-23  

---

# Test Plan — SHARED: ZigZag engine + swing-file types

## E2E User Journeys

- None; this is a shared library consumed by backend services.

## Integration Tests

- Shared package builds under `shared/` and compiles cleanly.
- The ported engine produces output identical to the original ST engine for a representative symbol/date range (parity test).

## Unit Tests

- `computeZigZagPivots` returns expected pivots on synthetic price series.
- `deriveSwings` produces swings with correct direction, magnitude, duration, and volume.
- `computeSwingStats` produces distribution summaries and histograms.
- `deriveParamsId` generates expected ids for the four canonical configs.
- `CANONICAL_ZIGZAG_CONFIGS` matches the documented values.
- `SwingSetDoc` serializes/deserializes correctly.

## Test Seams

- **Highest seam:** call `computeZigZagPivots`/`deriveSwings`/`computeSwingStats` directly with synthetic `PriceBar[]`.
- **Lower seams:** individual math helpers (`calcDev`, `isFiniteNum`).

## Existing Test Coverage

- ST has spec files for the original engine (`st-zigzag.*.spec.ts`). Port those cases as the baseline.

## Edge Cases

- Empty bar array → no pivots.
- All bars same price → no pivots.
- Insufficient bars for `rightDepth` → no confirmed pivots.
- Non-finite prices → skipped.
- Projection pivot when `projectionPivots=false` → none returned.
