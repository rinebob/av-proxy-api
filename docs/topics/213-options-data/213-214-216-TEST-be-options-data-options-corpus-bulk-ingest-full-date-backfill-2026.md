**Topic:** Options Corpus Bulk Ingest  
**Topic Slug:** options-corpus-bulk-ingest  
**Thread:** Full-Date Corpus Backfill (2026)  
**Thread Slug:** full-date-backfill-2026  
**Issue:** #216  
**Thread Parent:** #214  
**Topic Parent:** #213  
**Domain:** OPTIONS-DATA  
**Type:** TEST  
**Status:** Draft  
**Created:** 2026-10-25  
**Last Updated:** 2026-10-25  

# Test Plan — Options Corpus Bulk Ingest (BE)

## E2E Journeys

- **J1 — Materialize a symbol**: run materialize task for `QQQ` → all 380
  cell docs under `options-delta-picks/QQQ-*/years/2026` exist; `days` keys
  cover stored corpus dates; spot-check `QQQ-put-20-45` April entries match
  the validated prototype example
  (`src/assets/data/options-delta-picks-QQQ-put-0.20-45-apr2026.example.json`).
- **J2 — Nightly append**: simulate/post a seed-success for
  `(symbol, date)` → pick task appends `days.{date}` to every cell; `lastDate`
  advances; pick entries unchanged for prior days.
- **J3 — Self-repair**: insert a `no_chain` entry, seed the chain, rerun the
  pick task → the entry becomes a real pick (miss-status rewrite allowed,
  pick-immutable preserved).
- **J4 — Endpoint read**: GET partner endpoint for
  `(QQQ, put, 20, 45, 2026)` → returns the year doc; off-grid params → 400;
  invalid params → 400.
- **J5 — Reconciler**: with a deliberately missing corpus date, run the
  reconciler sweep → a seed task is enqueued for the gap + a run doc records
  the diff.

## Integration Tests

- Picker + real chain fixture: `pickCellsForDate` over a stored
  decompressed chain → correct contractId/expiration/dte for known cells.
- Cell writer + Firestore emulator: merge semantics — absent→write,
  miss→rewrite-on-better, pick→never-overwrite; header counts/firstDate/
  lastDate correct.
- Seed-task → pick-task wiring: seed success enqueues the pick payload.
- Endpoint: emulator-backed doc read; param validation matrix
  (bad delta, bad dte, bad type, missing symbol).

## Unit Tests

- `cellId` encode/decode round-trip; invalid-cell rejection.
- Picker pure fn: nearest-DTE expiry selection (ties), `argmin` delta match
  (sign handling — puts negative), `no_match` on empty type/expiry sets,
  `dte` computed from actual chosen expiration.
- Grid config: 19 deltas × 10 DTEs × 2 types = 380 cells enumerated once.
- Miss-status precedence rules in the writer's merge decision table.
- Reconciler diff logic: expected trading days vs stored objects → gap set
  (weekend/holiday edge dates via `TradingCalendarService`).

## Test Seams

- **Highest seam**: Firestore emulator + Cloud Tasks handler invoked
  directly with a recorded chain fixture — exercises picker→writer→doc
  end-to-end without GCS/AV.
- **Lower seams**: pure `pickCellsForDate` (fixtures); writer merge fn with
  in-memory doc; reconciler diff with stubbed coverage lister.

## Existing Coverage

- `corpus-coverage.service`, `planCorpusRun`, `NightlyCorpusService`,
  `ts-build-lease.service` have tests — reconciler extends the coverage
  path, not new infra.
- `contract-metadata.utils` OCC parsing already tested — picker reuses it.

## Edge Cases

- Chain with zero puts (calls-only / suspect chain) → `no_match` per put
  cell + flagged by sanity counts.
- `underlyingClose` missing for a date → entry still written; close omitted
  per SPEC; logged.
- Expiry equidistant from two DTE targets — deterministic tie-break
  (nearest actual dte; document rule).
- Delta equidistant between two contracts — deterministic tie-break
  (e.g., nearer-to-ATM / higher |delta| — document rule).
- Re-run materialization on a fully-picked symbol → zero writes (idempotent).
- Year boundary: Dec 31/Jan 1 picks land in correct year shard by
  **chain date**, not expiration date.
