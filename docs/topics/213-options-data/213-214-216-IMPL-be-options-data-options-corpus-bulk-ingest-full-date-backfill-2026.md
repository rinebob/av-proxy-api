**Topic:** Options Corpus Bulk Ingest  
**Topic Slug:** options-corpus-bulk-ingest  
**Thread:** Full-Date Corpus Backfill (2026)  
**Thread Slug:** full-date-backfill-2026  
**Issue:** #216  
**Thread Parent:** #214  
**Topic Parent:** #213  
**Domain:** OPTIONS-DATA  
**Type:** IMPL  
**Status:** Draft  
**Created:** 2026-10-25  
**Last Updated:** 2026-10-25  

# Implementation Plan — Options Corpus Bulk Ingest (BE)

Scope: the remaining PRD stories not already shipped. Delivered so far:
per-symbol seed pipeline, corpus buckets, time-series builder + lease,
calendar-mode pilot fanout (the 2026 backfill itself). Remaining:

1. **Delta-pick grid** — PRD stories 9d–9g: cell docs, picker, fanout,
   nightly append, self-repair, partner endpoint.
2. **Standing reconciler** — PRD stories 4–8/10: full-window coverage diff →
   re-enqueue gaps + run tracking.
3. **Chain sanity** — PRD story 10c: put/call counts flagged at seed time.

Area: **BE only.** No SHARED package changes — `shared/` is not consumed
cross-repo (SavantTrader is a separate repo reading via HTTP JSON). Off-grid
on-demand compute is **deferred** to a later thread (endpoint returns 400).

Consumer contract: `213-215-SPEC-options-delta-picks-consumer-contract.md`.

## Architecture

```mermaid
flowchart LR
    subgraph nightly
      NC[NightlyCorpusService<br/>exists] --> ST[seed task<br/>exists]
      ST -->|store chain| GCS[(corpus bucket)]
      ST --> TSB[ts-build task<br/>exists]
      ST -->|NEW: enqueue| PT[pick task<br/>(symbol, date)]
    end
    subgraph picks
      PT --> PC[pickCellForDate<br/>pure fn] --> CW[cell writer]
      CW --> FS[(options-delta-picks<br/>cell/year docs)]
      MAT[materialize task<br/>per symbol] --> PC
      EP[partner endpoint] --> FS
    end
    subgraph reconcile
      REC[reconciler scheduler<br/>NEW] --> COV[corpus-coverage diff<br/>exists]
      COV -->|missing dates| PR[planCorpusRun<br/>exists] --> ST
    end
```

## Components

### 1. Grid config + shared types (foundation)

- `PICK_GRID` constant: deltas `{5..95 step 5}` (magnitude pct), DTEs
  `{7,14,21,30,45,60,90,120,180,365}`, types `{put,call}` → 380 cells.
- `cellId(symbol, type, deltaPct, dte)` encoder —
  `QQQ-put-20-45`; decoder for endpoint param validation.
- `DayPick` / `CellYearDoc` interfaces mirroring the SPEC schema
  (`days` map, `underlyingClose`, `status` on misses, header counts).

### 2. Picker core — pure function

`pickCellsForDate(chain, underlyingClose, date, grid) → Map<cellId, DayEntry>`

- One chain load serves all 380 cells. Group contracts by type →
  expiration (nearest `|expirationDate − date + dteTarget|`) →
  `argmin|observedDelta − targetDelta|` per cell.
- Contract fields come straight off the chain row (`contractId`,
  `expiration`, `strike`, `delta`, `iv`, `mark`, `bid`, `ask`, `volume`,
  `openInterest`); `dte` computed as actual days to the chosen expiration.
- Miss statuses: `no_chain` (caller-side, chain absent) vs `no_match`
  (chain present, nothing selectable).
- Reuses seams: `HistoricalOptionsRetrievalService` for chain
  load/decompress; `DailyAdjustedReader.readDate` (already wired in
  `corpus-seed.task.ts` / `symbol-metrics/build.service.ts`) for
  `underlyingClose`.

### 3. Cell doc writer

Path `options-delta-picks/{cellId}/years/{YYYY}` — 4 segments, even count.

- `mergeDayEntries(cellId, year, entries)`: for each `days.{date}` — write if
  absent; **rewrite only if the existing entry carries a miss status**
  (`no_chain`/`no_match`) and the new entry is a pick or better status.
  Pick entries are immutable — never overwritten.
- Bumps `lastDate`, `pickCount`, `missCount`, `firstDate`, `updatedAt`
  (serverTimestamp) transactionally or via `set(..., {merge:true})` with
  FieldValue increments where the counts can be derived — simpler: recompute
  counts on write since the writer already knows which keys changed.

### 4. Materialization fanout — task per symbol

- Payload `{symbol}`; walks corpus objects for the symbol (coverage lister),
  for each date: load chain → `pickCellsForDate` → merge into cell docs.
- **Per symbol = one task** (~200 sequential chain loads, est. 2–5 min):
  zero Firestore contention (only writer per cell doc), resumable via
  writer's skip-existing semantics. Avoids both the ts-build lease
  serialization and the 200-writers-per-doc thrash a per-(sym,date) fanout
  would cause.
- Enqueued via an ops HTTP trigger (same pattern as
  `triggerHistoricalOptionsTimeSeriesBuild`); ~130 tasks, all GCS reads,
  zero AV calls.
- Idempotent: re-running a symbol skips already-picked dates and repairs
  `no_chain` entries — this is also the self-repair mechanism.

### 5. Nightly append hook

- On seed-task success (`corpus-seed.task.ts`), enqueue a pick task
  `{symbol, date}` in parallel with the existing ts-build enqueue — picks
  need only the chain, **not** the time series, so no ordering dependency on
  ts-build. (SPEC prose says "after ts-build completes"; code-wise seed
  success is the correct trigger.)
- Same task payload/handler as materialization, bounded to one date.

### 6. Partner endpoint

- HTTPS function serving a year-sharded cell doc for
  `(symbol, type, delta, dte, year)` after param validation against the grid.
- Off-grid params → `400` with an error naming the invalid component;
  on-demand compute deferred.
- Auth follows existing partner-endpoint conventions in this repo.
- Firestore rules: `options-delta-picks` backend-only (deny client read/write)
  — all consumer access via endpoint.

### 7. Standing reconciler

- Scheduled sweep (nightly, after nightly corpus run): per enabled symbol,
  diff expected trading days `[2026-01-01 .. latest completed]` vs stored
  corpus objects — reuses `corpus-coverage.service` listing + `planCorpusRun`
  calendar-mode + `CorpusMetadataService` run doc.
- Enqueues missing (symbol,date) seeds through the existing seed queue.
  This is the self-healing path for `SNDK/2026-09-21`-type terminal holes.
- Suspect chains flagged by 10c count as gaps for re-seeding.

### 8. Chain sanity (10c)

- In `corpus-seed.worker.ts` where the chain is already in memory: count
  `putCount`/`callCount`/total rows; flag `empty`, `calls_only`, `puts_only`
  into the run-item outcome metadata.
- Reconciler consumes the flag: suspect + re-seedable → treated as a gap;
  suspect + upstream-confirmed-empty → logged as `no_chain`-equivalent (e.g.,
  the observed ~400-byte SPCX payloads).

## Phases & tasks (tracer order)

| # | Task | Delivers | Blocked by |
|---|------|----------|------------|
| 1 | Grid config + pick types | `PICK_GRID`, cellId codec, DayPick/CellYearDoc types + unit tests | — |
| 2 | Picker core service | `pickCellsForDate` + expiry/delta selection unit tests vs fixture chain | 1 |
| 3 | Cell doc writer | merge/self-repair semantics + rules sketch | 1 |
| 4 | Materialization fanout | per-symbol task + ops trigger; QQQ symbol end-to-end produces cell docs | 2, 3 |
| 5 | Nightly pick append | seed-success → pick task wiring | 2, 3 |
| 6 | Partner endpoint + rules | in-grid year-doc read; 400 off-grid; deny-all client rules | 4 |
| 7 | Golden-file verification | regenerate `options-delta-picks-QQQ-put-20-45` year shard through prod path; diff vs validated prototype example | 4 |
| 8 | Standing reconciler | scheduled coverage diff → gap enqueue + run doc; heals SNDK gap | — |
| 9 | Chain sanity flags | seed-time put/call counts → run item; reconciler consumes flags | 8 |

Blocking edges are minimal: 1→{2,3}→{4,5}→{6,7} chain for picks; 8→9 for
reconciler. 4 and 5 share deps and can run parallel. Endpoint can start once
4 proves a real symbol end-to-end (needs real docs to serve).

## Risks & notes

- **Doc size**: 380 cells × ~200-day `days` map ≈ 30–80KB per year doc — well
  under the 1MB limit; year-sharding bounds growth.
- **Memory in materialize task**: 380 cells × 200 entries accumulated
  per symbol ≈ 15–30MB — fine in a 512MB function.
- **Firestore write volume**: nightly ≈ 380 writes × 130 symbols ≈ 49k/day —
  trivial. Materialization ≈ 380 doc writes × 130 symbols ≈ 49k total.
- **`underlyingClose` absence**: if no adjusted bar exists for a date the
  entry still writes with the pick and `underlyingClose` omitted only in the
  miss case where no bar exists (per SPEC, close accompanies every entry
  *when available* — logged for the sanity audit).
- **Corpus floor is 2026**; cell docs shard by year — 2027+ years materialize
  as the window extends, same code path.
