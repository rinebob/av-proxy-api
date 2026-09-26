**Topic:** Swing-driven options corpus platform  
**Topic Slug:** swing-driven-options-corpus  
**Thread:** Swing-set generation platform  
**Thread Slug:** swing-set-platform  
**Issue:** #104  
**Thread Parent:** #103  
**Topic Parent:** #102  
**Domain:** OPTIONS-DATA  
**Type:** SPEC (ST handoff)  
**Status:** Complete  
**Created:** 2026-09-22  
**Last Updated:** 2026-09-23  

---
> **SUPERSEDED (2026-09-26):** The multi-config + served-swing design in this document was replaced: SA stores one dev2/L2/R2 dates-only swing doc per enabled symbol — a corpus-internal date sampler, not a served artifact — and `partnerSwingSetsV2` was removed. See `102-107-DECISION-swing-doc-slim-shape.md`. This doc remains as the historical record of the shipped implementation.


# SavantApi Handoff: Options corpus platform + swing-set generation

**Audience:** SavantApi (SA) project team. SA creates its own Topic/Thread
from this document — this is the consumer contract plus the platform work
SavantTrader (ST) is depending on.

## Terminology

- **SA** — SavantApi, this backend project.
- **ST** — SavantTrader, the consumer client application that calls SA endpoints
  and reads SA data.

## Background — what this is and how we got here

**The product.** ST (SavantTrader) has an "option-chain percent-change
grid" feature (Topic #326, live at `/savant-trader/option-chain-pct-change`):
pick a symbol, a start date, and target dates; ST fetches the full option
chain for each date, matches contracts across dates, and renders a heatmap
of % price change (expiration columns × strike rows). The workflow centers
on swing-compare: a ZigZag indicator picks swing pivots on the chart, the
user frames a large swing, and each inside pivot becomes a target date —
answering "which strike/expiration/delta captured the most option % move
over this swing?"

**The problem.** Every date in every run is a **live** upstream fetch to
the options vendor through SA's `partnerHistoricalOptionsV2`. That has
three costs:

1. **Slow** — a 10-target run is 11 serial-ish upstream calls (ST caps
   concurrency because the partner 502s on bursts).
2. **Fragile** — rate limits and transient partner failures surface as
   per-date errors mid-analysis.
3. **Wasteful** — the same `(symbol, date)` chain is re-fetched on every
   run, every session, every user.

**History of the fix attempt.** Thread #327 shipped the original grid
against live fetches. A first pass at caching (proposal #329) sketched
fetch-on-miss into an SA-side snapshot cache — **rejected**: organic misses
are the wrong trigger (unbounded, uncurated, and ST-driven). The pivot
dates that matter are already known — ZigZag swing files say exactly which
dates are analytically interesting per symbol — so the corpus should be
built *deterministically from pivot data*, not incidentally from requests.

**The architectural decision.** SA is the source of truth for all shared
data; ST sites are consumers. Concretely for this thread: SA owns the
options corpus, the canonical swing files, and the symbol flags that
decide which symbols get corpus coverage. ST owns only the grid
compute + rendering. Custom (non-canonical) ZigZag configs stay ST-side
as preview-only — never persisted.

**What ST already shipped against this.** The ST consumer side is live:

- `source` field passthrough + a "live fetch" chip on grids served live.
- `OPTIONS_NOT_ENABLED` → callable `failed-precondition` → a friendly
  "Options analysis is not available for {SYMBOL}" message.
- Per-date fetch resilience: one missing/unavailable date degrades to an
  error row; the rest of the run renders.

So the endpoint contract below is already coded on the consumer side —
SA's implementation just needs to honor it.

**Related work.** Topic #261 (ZigZag/indicator lib) is the upstream
dependency that produces the pivots; ST's `st-swing-sets` collection is
the *legacy* store SA replaces — no migration, SA regenerates fresh.

## The short version

SA becomes the sole owner of canonical options + swing data:

1. Port ST's ZigZag swing-set generation into SA; SA generates swing files
   for every tracked symbol under **4 fixed canonical configs**.
2. Add `optionable` + `optionsEnabled` flags to SA's symbol records
   (Symbol Manager); enabling a symbol triggers its corpus seeding.
3. Build the options corpus on the existing GCS JSON-per-date infra — docs
   keyed `(symbol, date)`, seeded on newly-confirmed pivot dates, plus a
   one-time backfill of the enabled universe's historical pivots.
4. Serve it through `partnerHistoricalOptionsV2` (unchanged shape) plus a
   `source` field and distinguishable error codes.

ST remains a pure consumer. No ST endpoints, no ST writes to SA data, no
fetch-on-miss driven by ST requests (rejected — the corpus is built by SA's
flag-driven seeding and backfill, not organic misses).

## 1. Swing-set platform

**Port from ST** (`rel-str` repo — code to move):

- `src/app/features/shared/components/flex-chart/indicators/st-zigzag.engine.ts`
  — `computeZigZagPivots`, `deriveSwings`, `computeSwingStats`
- `scripts/bulk-swing-sweep.ts` — the build/persist sweep (reads symbol bars,
  computes all 4 configs, writes docs). Ports nearly verbatim.
- `st-swing-sets` doc shape — `{symbol}_{paramsId}` keyed docs; ST will read
  SA's equivalent and retire this collection later (separate #261 work).

**Canonical configs (fixed set of 4):**

|| devThreshold | leftDepth | rightDepth | allowZigZagOnOneBar | projectionPivots | showTriggerDots |
|---|---|---|---|---|---|---|
|| 10 | 10 | 10 | true | true | true |
|| 5  | 5  | 5  | true | true | true |
|| 3  | 3  | 3  | true | true | true |
|| 2  | 2  | 2  | true | true | true |

|`paramsId` derivation lives in
`src/app/features/savant-trader/swing-analysis/swing-analysis.types.ts`
(`deriveParamsId`) — port it so doc keys match ST's existing format.

**Scope:** every symbol in SA's `tracked_symbols`. New tracked symbols get
swing files generated on add (hook the symbol-add path or run a scheduled
sweep — SA's call).

**No migration needed:** ST's existing `st-swing-sets` docs are abandoned —
SA generates fresh files using the ported sweep. Cutover verification
(SA files cover the expected symbols×configs) belongs to the ST #261 work.

## 2. Symbol flags

Two new boolean fields on SA's symbol record, editable in Symbol Manager:

|| Field | Meaning | Set by |
|---|---|---|---|
|| `optionable` | Symbol has listed options — factual, system-derived | probe (below) |
|| `optionsEnabled` | Optionable **and** worth trading — liquid chain, broad strikes/expirations | user (curated) |

- `optionsEnabled` is settable at symbol ingestion and editable afterward.
- **Flipping `optionsEnabled` on triggers that symbol's corpus seeding**
  (generate swing files → collect pivot dates → ingest those chains).
- `optionable` population: probe `partnerHistoricalOptionsV2` for each
  tracked symbol on a recent trading day. Non-empty chain → `optionable=true`.
  The response's `analysis.summary` (`totalContracts`, `totalVolume`,
  `totalOpenInterest`, `uniqueStrikes`, expiration breakdown) doubles as the
  curation data for deciding `optionsEnabled`. One-time backfill job +
  on-add probe for new symbols.

## 3. Options corpus — the full pipeline

Two-stage ingest, both SA-owned (this exists today for QQQ/TQQQ — this
spec asks SA to generalize it to the `optionsEnabled` universe):

**Stage 1 — pivot-date chain snapshots → GCS JSON docs.** One gzipped JSON
per `(symbol, date)` on the existing corpus layout, unchanged. This is the
snapshot corpus `partnerHistoricalOptionsV2` serves from.

**Stage 2 — per-contract Firestore time-series docs.** From each chain
snapshot, SA derives one doc per contract id that accumulates the
contract's pivot-date observations (mark/OHLC, volume, OI, IV, greeks) into
a time series — that's what powers the contract-chart viewer. Today this
runs SA-side only; under this spec it must run for every ingested
`(symbol, date)` — seeded pivots, backfill dates, and any live-fetched
docs SA chooses to persist — so every enabled symbol's contracts get
time-series coverage, not just QQQ/TQQQ.

- **Update trigger:** when the swing pipeline detects a newly-*confirmed*
  pivot for an enabled symbol (config × symbol), ingest that pivot date's
  chain (stage 1 + stage 2). Repaint semantics: the doc lands when the
  pivot confirms (rightDepth bars later), not when it first paints.
- **One-time backfill:** after the `optionsEnabled` flag is populated,
  seed the corpus with every enabled symbol's historical pivot dates
  across all 4 configs — both stages. Idempotent — rerunnable, skips
  existing docs.
- The contract-chart viewer stays SA-side, unchanged.

## 4. Endpoint contract — what ST depends on

### `partnerHistoricalOptionsV2` — unchanged shape + `source`

```json
{ "ok": true, "symbol": "QQQ", "date": "2024-03-15", "source": "gcs", ... }
```

- `source: "gcs"` — served from the corpus; `source: "live"` — fresh
  upstream fetch. Whether SA serves live for a corpus gap (fetch-on-miss)
  or errors instead is SA's call — the PRD's design assumption is
  **no** fetch-on-miss (corpus = pivot-seeded + backfill only).
- Response shape otherwise identical to today. ST's callable passes the body
  through verbatim — no field mapping needed.

### Error contract

ST needs two distinguishable failures (current mapping flattens both to
generic errors):

|| Condition | Proposed signal | ST callable maps to |
|---|---|---|---|
|| Symbol not `optionsEnabled` | HTTP 404/403 with body `code: "OPTIONS_NOT_ENABLED"` | `failed-precondition` |
|| Date has no snapshot & no upstream data | existing "no data" signal | `not-found` (unchanged) |
|| Upstream transient failure | existing 502/504 | `unavailable` (unchanged) |

Final shape is SA's call — ST just needs to tell the three apart.

### Universe endpoints

ST needs to read SA's symbol universes (replaces today's indirect
`trackedSymbolsCache` path eventually — not blocking for this thread):

- Tracked-symbol list (exists today via Symbol Manager surfaces)
- Options-enabled subset — could be the same list with the flag exposed, or
  a dedicated endpoint; SA's choice

## 5. Out of scope for SA

- oc%c grid compute, contract matching, filters, grid cache — all ST-side.
- ST's `st-swing-sets` retirement — ST-side cleanup under #261.
- ST custom swing-config previews — ST-side, preview-only, never persisted.

## Open questions for SA

1. Corpus seed latency: how quickly after pivot confirmation does the chain
   doc land? Drives ST expectations for "recent swing" analyses.
2. Does the corpus store raw AV JSON, or the parsed/normalized shape? ST's
   `chainContracts()` reads `data.data` as `HistoricalOptionContract[]` —
   the served response just needs to match today's shape.
3. Availability/coverage endpoint (`symbol → dates[]` or enabled-symbol
   list)? Nice-to-have for ST pre-run hints; not blocking.
