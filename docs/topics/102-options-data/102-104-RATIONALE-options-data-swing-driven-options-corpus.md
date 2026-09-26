**Topic:** Swing-driven options corpus platform  
**Topic Slug:** swing-driven-options-corpus  
**Thread:** Swing-set generation platform  
**Thread Slug:** swing-set-platform  
**Issue:** #104  
**Thread Parent:** #103  
**Topic Parent:** #102  
**Domain:** OPTIONS-DATA  
**Type:** RATIONALE  
**Status:** Complete  
**Created:** 2026-09-23  
**Last Updated:** 2026-09-23  


> **SUPERSEDED (2026-09-26):** The multi-config + served-swing design in this document was replaced: SA stores one dev2/L2/R2 dates-only swing doc per enabled symbol — a corpus-internal date sampler, not a served artifact — and partnerSwingSetsV2 was removed. See 102-107-DECISION-swing-doc-slim-shape.md. This doc remains as the historical record of the shipped implementation.

# Why we're moving swing generation (and the options corpus) to SA

- **SA** â€” SavantApi, this backend project.
- **ST** â€” SavantTrader, the consumer client application that calls SA endpoints and reads SA data.

Companion to `102-104-SPEC-options-data-swing-driven-options-corpus.md`
â€” that doc is the *what*; this is the *why*. Written for the SA team so the
motivation survives handoff.

## 1. The product reality driving all of this

Two ST surfaces consume the same underlying data:

- **oc%c grid** (`/savant-trader/option-chain-pct-change`): pick symbol +
  start date + target dates â†’ fetch full option chains â†’ render a
  % change heatmap. The real workflow is swing-compare: ZigZag pivots
  define the interesting dates.
- **Swing analysis** (`/savant-trader/swing-analysis`): ZigZag swing files
  â†’ swing magnitude/duration statistics for projecting future swings.
  Historical statistical analysis â€” not trading decisions, not display-only.

Both need the same two datasets: **swing pivots** and **option chain
snapshots at those pivot dates**.

## 2. The pain today

Every date in every oc%c run is a live fetch through
`partnerHistoricalOptionsV2` â†’ Alpha Vantage:

- **Slow** â€” ~1s per date, concurrency-capped at 3 because the partner
  502s on bursts. A 10-target run = ~11 upstream calls.
- **Fragile** â€” transient failures surface mid-analysis as per-date errors.
- **Wasteful** â€” identical `(symbol, date)` chains re-fetched on every run,
  every param variation, every session, every user. Immutable historical
  data, paid for repeatedly.

## 3. Why fetch-on-miss was rejected

The obvious fix â€” "cache whatever gets requested" â€” was proposed (#329) and
**rejected**:

- **Unbounded** â€” any ST request pattern (typos, interval targets,
  exploratory dates) grows the corpus forever.
- **Uncurated** â€” corpus contents driven by ad-hoc user clicks, not by
  what's analytically valuable.
- **Wrong side** â€” ST request traffic becomes the corpus's build trigger;
  the consumer dictates the platform's data.

The pivot dates that matter are **already known**. ZigZag swing files
enumerate exactly which dates are analytically interesting per symbol. The
corpus should be built *deterministically from swing data* â€” pivots seeded
on confirmation + a one-time historical backfill â€” not incidentally from
misses.

## 3b. What "corpus" actually means â€” the two-stage ingest

So there's no ambiguity about the deliverable: a daily options chain
ingest is two writes, not one.

**Stage 1 â€” chain snapshot JSON docs in GCS.** One gzipped JSON doc per
`(symbol, date)` on the existing corpus layout (this exists today for
QQQ/TQQQ). Immutable, replayable, vendor-call amortization â€” this is what
`partnerHistoricalOptionsV2` serves from.

**Stage 2 â€” per-contract Firestore time-series docs.** Each snapshot is
also exploded into per-contract docs that accumulate a contract's
pivot-date observations (mark, volume, OI, IV, greeks) over its lifetime â€”
the data behind the contract-chart viewer. We do not fetch daily; every
observation comes from a confirmed or current-extreme pivot date. Today
this only runs for the existing corpus symbols; under this spec it runs
for every enabled symbol, so "which contract captured the swing" analyses
can drill from a grid cell to that contract's full time series.

The seed/backfill triggers in the spec apply to **both** stages â€” a
pivot date that lands a GCS doc must also land its contract time-series
points.

## 3c. The causal chain â€” swings â†’ pivots â†’ corpus

Worth stating end-to-end because it's the whole design:

1. **Swing-set generation** â€” the ported ZigZag engine runs on every
   tracked symbol under the 4 canonical configs (`10/10/10`, `5/5/5`,
   `3/3/3`, `2/2/2` â€” devThreshold/leftDepth/rightDepth). Output: one
   swing file per `(symbol, paramsId)` â€” the swings (pivot-to-pivot legs)
   plus each pivot's confirmation metadata.
2. **Pivot dates** â€” each swing file's pivots are the local extrema: the
   bars where price actually turned. Those are precisely the dates the
   oc%c analysis cares about â€” a swing-compare run frames a large swing
   and treats each inside pivot as a target date, asking "which option
   contract captured the move from here?" A pivot date is *by
   construction* an entry/exit point worth analyzing; non-pivot dates
   aren't in the analysis path.
3. **Dedup to `(symbol, date)`** â€” the same calendar date can be a pivot
   under several configs. The corpus doesn't care which config detected
   it: one chain snapshot per `(symbol, date)`, config-agnostic.
4. **Two-stage ingest per pivot date** â€” confirmed pivot â†’ fetch the
   chain once â†’ (a) GCS JSON snapshot doc, (b) explode into per-contract
   Firestore time-series docs. The same trigger feeds both: the snapshot
   serves oc%c's `partnerHistoricalOptionsV2` reads, and the contract
   docs accumulate the per-contract history that the contract-chart
   viewer (and future drill-downs) render.

So the swing pipeline isn't a side input â€” it's the corpus's *build
driver*. That's the structural reason swing generation belongs in SA:
the thing that decides which dates get ingested lives in the same
process that produces it.

## 4. Why SA owns it â€” the architecture argument

**SA is the source of truth for all shared data; ST is a consumer.** This
is how the platform already works (corpus docs, GCS storage, ingestion
infra all live in SA). Concretely:

- Swing files are **shared platform data** â€” multiple ST surfaces read
  them, and future consumers will too. Persisting them client-side in
  `st-swing-sets` was a pragmatic stopgap, wrong layer.
- The ZigZag compute is **data-platform work** â€” regenerate per symbol
  universe, canonical configs, scheduled sweeps â€” identical to every other
  SA pipeline. ST's engine (`st-zigzag.engine.ts`) ports nearly verbatim.
- **Co-location kills a race** â€” corpus seeding triggers on
  *newly-confirmed pivots*. If swing generation stays in ST and the corpus
  in SA, SA has to watch ST's output to know when to ingest. Generating
  swings in SA makes the seed trigger internal â€” one pipeline, no
  cross-repo dependency.
- **Single writer** â€” nobody else produces swing/corpus data. No sync, no
  divergence, no "whose doc is fresher."

## 5. The economics argument â€” `optionable` vs `optionsEnabled`

Vendor calls cost money; the corpus must be **bounded by curation**, not by
accidents of usage:

- `optionable` = factual ("does this symbol have listed options") â€”
  system-derived via a cheap probe (`partnerHistoricalOptionsV2` on a
  recent day; the response's `analysis.summary` doubles as the liquidity
  metrics used for curation).
- `optionsEnabled` = editorial ("worth spending vendor calls on") â€”
  human-curated in Symbol Manager. Flipping it on triggers that symbol's
  seed; flipping it off stops corpus growth for that symbol.

Two flags, one gate: corpus = Î£(enabled symbols Ã— their pivot dates).
Predictable spend, no surprise growth.

## 6. The repaint subtlety SA needs to get right

ZigZag pivots **repaint** â€” a pivot appears at bar `t` but only *confirms*
`rightDepth` bars later. Seeding on first-paint ingests phantom dates. The
spec is explicit: ingest when the pivot **confirms**, not when it paints.
The ported engine must preserve the confirmation semantics from
`computeZigZagPivots`/`deriveSwings`, not just the output shape.

## 7. What ST already shipped (contract is live)

The consumer side is coded and deployed â€” SA just honors it:

- `source: "gcs" | "live"` passthrough â†’ "live fetch" chip on grids
- `OPTIONS_NOT_ENABLED` â†’ callable `failed-precondition` â†’ friendly message
- Per-date resilience: one bad date = one error row, not a dead run

`partnerHistoricalOptionsV2` request/response shape is **unchanged** â€” ST
keeps calling it identically; corpus hits just come back fast.

## 8. What ST keeps

- Grid compute, contract matching, filters, rendering â€” consumer-specific,
  never moves
- Custom (non-canonical) ZigZag configs â€” preview-only in the UI, **never
  persisted**
- `st-swing-sets` retirement + cutover verification â€” ST-side cleanup under
  #261, after SA's files land

## 9. Non-goals SA should know

- **No migration** of `st-swing-sets` â€” SA regenerates fresh; ST's docs are
  abandoned
- **No fetch-on-miss** â€” corpus = pivot-seeded + backfill only (SA can
  revisit, but that's the baseline)
- **No ST writes to SA data** â€” pure consumer, period

## 10. Why now

ST's swing-analysis page, oc%c grid, and coming "which options captured the
swing" analyses all multiply the same upstream fetches. Every new analysis
feature built on live fetches compounds the slow/fragile/expensive pattern.
Fixing the data layer once â€” canonical swings + pivot-seeded corpus â€”
unblocks all of them at platform speed.
