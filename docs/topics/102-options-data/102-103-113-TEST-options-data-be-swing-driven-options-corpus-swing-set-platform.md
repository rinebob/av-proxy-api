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
> **SUPERSEDED (2026-09-26):** The multi-config + served-swing design in this document was replaced: SA stores one dev2/L2/R2 dates-only swing doc per enabled symbol — a corpus-internal date sampler, not a served artifact — and `partnerSwingSetsV2` was removed. See `102-107-DECISION-swing-doc-slim-shape.md`. This doc remains as the historical record of the shipped implementation.


# Test Plan — BE: Swing-set generation, persistence, and availability

## E2E User Journeys

- Operator enables options for a symbol → swing files appear in `options-swing-sets` for all four canonical configs.
- Scheduled sweep runs → missing/stale swing files are regenerated.
- Backfill script runs → all options-enabled symbols have swing files.
- ST consumer calls `partnerSwingSetsV2` → receives swing file data.

## Integration Tests

- `SwingSetGenerationService` reads daily-adjusted data, computes pivots/swings/stats, and writes docs.
- `generateSwingSetsTask` receives a symbol payload and produces expected Firestore docs.
- `sweepSwingSets` iterates options-enabled symbols and skips fresh docs.
- `partnerSwingSetsV2` returns correct responses for tracked/enabled/disabled/missing cases.
- Parity test: SA-generated swing file matches ST-generated output for the same symbol/date range.

## Unit Tests

- `SwingSetGenerationService` mapping from `DailyAdjustedBar` to `PriceBar`.
- `SwingSetRepository` upsert/get/list methods.
- Freshness check logic used by sweep.
- Endpoint request parsing and error mapping (`OPTIONS_NOT_ENABLED`, `NOT_FOUND`).

## Test Seams

- **Highest seam:** `generateForSymbol` with a mocked `DailyAdjustedReader` and real `SwingSetRepository` (Firestore emulator or test double).
- **Lower seams:** `SwingSetRepository` methods, `DailyAdjustedReader` adapter, endpoint handler with mocked deps.

## Existing Test Coverage

- Existing corpus ingest tests cover GCS/metadata behavior but not swing sets.
- This Thread adds swing-set-specific coverage.

## Edge Cases

- Symbol with no daily-adjusted data → generation fails gracefully and is logged.
- Daily-adjusted data updated after generation → sweep detects staleness and regenerates.
- `optionsEnabled=false` → endpoint rejects; sweep skips.
- Concurrent generation for the same symbol → idempotent upserts.
- Invalid `paramsId` requested via endpoint → `NOT_FOUND`.
