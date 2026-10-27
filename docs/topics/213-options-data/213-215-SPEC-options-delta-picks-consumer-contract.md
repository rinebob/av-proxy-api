**Topic:** Options Corpus Bulk Ingest  
**Topic Slug:** options-corpus-bulk-ingest  
**Thread:** Full-Date Corpus Backfill (2026)  
**Thread Slug:** full-date-backfill-2026  
**Issue:** #215  
**Thread Parent:** #214  
**Topic Parent:** #213  
**Domain:** OPTIONS-DATA  
**Type:** SPEC  
**Status:** Draft  
**Created:** 2026-10-25  
**Last Updated:** 2026-10-25  

# SPEC: `options-delta-picks` — Consumer Contract

## Purpose

A **pick doc** answers, for every trading day: *"which real listed contract was
closest to a target delta at a target DTE?"* SavantTrader backtests read pick
docs directly — no chain parsing, no Black-Scholes inversion, no per-run
compute.

One document per **(symbol, option type, target delta, target DTE)** cell,
sharded by calendar year. Each cell holds a `days` map with one entry per
trading day: either a picked contract with its observed greeks/market data, or
an explicit miss status.

## Storage Location

```
options-delta-picks/{SYM}-{type}-{deltaPct}-{dte}/years/{YYYY}
```

| Segment | Example | Notes |
|---|---|---|
| `{SYM}` | `QQQ` | Uppercase underlying symbol |
| `{type}` | `put` | `put` or `call` |
| `{deltaPct}` | `20` | Target delta **magnitude** × 100 (sign is implied by type: puts are negative deltas) |
| `{dte}` | `45` | Target days-to-expiration (calendar days) |
| `{YYYY}` | `2026` | Year shard — `days` keys fall within this calendar year |

Examples:
- `options-delta-picks/QQQ-put-20-45/years/2026` — 20-delta put at ~45 DTE
- `options-delta-picks/SPY-call-30-30/years/2026` — 30-delta call at ~30 DTE

## Document Schema

```jsonc
{
  "symbol": "QQQ",
  "type": "put",
  "targetDelta": -0.20,              // signed: puts negative, calls positive
  "expiry": { "mode": "nearestDte", "dte": 45 },
  "gridVersion": 1,
  "firstDate": "2026-01-02",         // first day key in this shard
  "lastDate": "2026-10-23",          // latest day key — grows nightly
  "pickCount": 200,                  // days with status = pick
  "missCount": 4,                    // days with any miss status
  "days": {
    "2026-04-01": {
      "underlyingClose": 584.31,     // split-adjusted close, always present
      "contractId": "QQQ260515P00565000",
      "expiration": "2026-05-15",
      "dte": 44,                     // actual DTE of the chosen expiration
      "strike": 565,
      "delta": -0.204,               // observed delta (not the target)
      "iv": 0.198,
      "mark": 8.42,
      "bid": 8.30,
      "ask": 8.54,
      "volume": 412,
      "openInterest": 5210
    },
    "2026-04-14": {
      "status": "no_chain",
      "underlyingClose": 617.80
    }
  },
  "updatedAt": "<serverTimestamp>"
}
```

### Day entry — pick

| Field | Meaning |
|---|---|
| `underlyingClose` | Symbol's split-adjusted close that day (from `sa-time-series`). Present on **every** entry including misses — backtests always need spot for the entry day. |
| `contractId` | OCC-style ID: `{SYM}{YYMMDD}{C\|P}{strike×1000}` |
| `expiration` | ISO date of the chosen expiration |
| `dte` | **Actual** calendar days to expiration on that date — differs from target when the nearest listed expiration isn't exact |
| `strike` | Strike in dollars |
| `delta` | **Observed** delta on the chain — the closest to target, not exactly the target |
| `iv` | Observed implied volatility for that contract |
| `mark` / `bid` / `ask` | Observed quotes |
| `volume` / `openInterest` | Observed that day |

A pick entry carries **no `status` field** — presence of `contractId` means pick.

### Day entry — miss

| `status` | Meaning |
|---|---|
| `no_chain` | No corpus chain for that (symbol, date) — a data gap. Self-repairs: if the chain is later seeded, the next materialization pass replaces this entry with a real pick. |
| `no_match` | Chain exists, but no contract satisfied the cell's criteria (e.g., no expiration near target DTE, or no contract in the delta vicinity). May carry `reason` detail. |

Miss entries always include `underlyingClose` when an adjusted close exists.

## Selection Semantics

For each (symbol, date) the picker loads the day's chain **once** and computes
every cell:

1. Filter chain contracts to the cell's option type.
2. Choose the listed expiration **nearest to the target DTE** (calendar days).
3. Among that expiration's contracts, pick `argmin |observedDelta − targetDelta|`.
4. Emit the pick, or the applicable miss status.

**Every day is an independent pick.** Nothing ties day N's pick to day N−1's;
the selected contract rolls forward as the nearest-DTE expiration changes and
delta drifts. Consumers must not assume continuity of `contractId` across days —
they should expect the contract to change and use `contractId` +
`expiration` + `dte` to detect rolls (in the April example, the pick rolls from
the May-15 expiry to Jun-19 on Apr 23 as the nearest-DTE expiry hops forward).

Only real listed contracts are ever returned — observed delta, never a
synthetic/interpolated strike.

## Grid

**Canonical grid** (all levels confirmed 2026-10-25):

- **Deltas (magnitude):** 0.05 → 0.95 in 0.05 steps — **19 levels**
  (`{5,10,15,...,95}` in `deltaPct` terms)
- **DTE targets:** `7, 14, 21, 30, 45, 60, 90, 120, 180, 365` —
  non-uniform on purpose: weeklies give dense coverage at the short end while
  30/60/90/180/365 line up with monthly/quarterly/annual expiry conventions.
  Each day's `dte` field records the *actual* DTE picked, so coarse targets
  cost nothing but a hop to the nearest listed expiration. The set is config —
  future levels (e.g., denser short-end 1/2/3/5) are additive-only changes.
- **Types:** put, call

→ 19 deltas × 10 DTEs × 2 types = **380 cells per symbol per year**
(~49k cell docs across the 130-symbol universe). Cells are independent
documents — widening the grid later adds new cell docs only; no existing doc
is rewritten.

Backtest usage patterns this covers: e.g., a cash-secured-put strategy at
"20-delta, ~45 DTE" reads one doc (`{SYM}-put-20-45`) per symbol per year.

## Freshness & Self-Repair

- **Initial materialization:** built from stored GCS corpus chains via Cloud
  Tasks fanout — pure reads, zero AV calls. ~200 trading days per symbol.
- **Nightly append:** after each day's ts-build completes, one entry is
  appended to each cell doc's `days` map; `lastDate`/`pickCount`/`missCount`
  update accordingly.
- **Self-repair:** `no_chain` entries are recomputed when a previously missing
  chain is later seeded — the doc converges to truth without a rebuild.
- Historical data is immutable once written; `updatedAt` reflects the last
  append/repair.

## Access

- **Access is endpoint-only.** Consumers never read `options-delta-picks`
  directly — Firestore rules deny client access; all reads flow through the
  partner endpoint.
- **In-grid reads:** the partner endpoint serves the stored year-sharded doc
  for (symbol, type, delta, DTE, year) — a single document fetch that answers
  a full-year backtest for one cell.
- **Off-grid** (delta/DTE values not materialized — e.g., 17-delta at 63
  DTE): **out of scope for this thread** — deferred to a later thread. The
  endpoint returns `400` for non-materialized cell parameters. When needed,
  the likely design is enqueue-and-materialize: the request fans out a
  custom-cell build from stored chains and the consumer polls the resulting
  doc.

## Selection Policy (decided 2026-10-25)

**Pure `argmin|observedDelta − targetDelta|` — no liquidity filter.** The
picker always returns the closest-delta contract, including stale/thin ones
(`openInterest: 0`, wide spreads). Consumers see `openInterest`, `bid`, `ask`,
`volume` on every pick and apply their own liquidity rules — the doc records
what the market offered, not a curated opinion. A consequence to be aware of:
deep-grid cells on thin underlyings will regularly pick illiquid contracts —
that's the honest answer for that cell.

## Deferred Decisions

- **Off-grid cells** — endpoint rejects non-materialized params today. A
  later thread may add on-demand compute (likely enqueue-and-materialize,
  persisting custom cells so repeat requests hit the doc).

## Reference Asset

Validated example (QQQ put 20Δ/45DTE, April 2026, generated from real
production chains): `src/assets/data/options-delta-picks-QQQ-put-0.20-45-apr2026.example.json`
