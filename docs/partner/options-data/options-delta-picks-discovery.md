# Partner Options Delta-Picks — Discovery Document

**Status:** **Live** — `partnerOptionsDeltaPicksV1` deployed and QA-verified (Task #225). The underlying pick-doc dataset is **live**: ~380 cell docs per symbol across the full options-enabled universe, appended nightly.  
**Audience:** Partner engineering and administrative teams (primary consumer: SavantTrader backtests)  
**Last updated:** 2026-11-01

---

## Overview

A **pick doc** answers, for every trading day: *"which real listed contract was closest to a target delta at a target DTE?"* The endpoint serves one year-sharded document per **(symbol, option type, target delta, target DTE, year)** cell — a single document fetch that answers a full-year backtest for one cell, with zero chain parsing, no Black-Scholes inversion, and no per-run compute.

Each document holds a `days` map with one entry per trading day: either a **picked contract** with its observed greeks and market data, or an **explicit miss status**.

This is a **read-only, on-demand** API serving pre-materialized data — it does not call Alpha Vantage. Picks are produced by the internal corpus pipeline: stored daily option chains are picked once per trading day and written to `options-delta-picks/{cellId}/years/{YYYY}` Firestore documents. The dataset is endpoint-only — Firestore rules deny direct client access.

---

## Availability

| Item | Status |
|---|---|
| `options-delta-picks` dataset | **Live** — 380 cells × ~130 options-enabled symbols; appended nightly |
| Pick-doc endpoint (`partnerOptionsDeltaPicksV1`) | **Live** (Task #225, deployed 2026-11-01) |
| Firestore rules: deny client access to `options-delta-picks` | **Live** — deployed with #225 |
| Symbol universe | All symbols with `optionsEnabled = true` (~130) |
| Coverage window | Trading days 2026-01-01 onward |

---

## Endpoint

| Property | Value |
|---|---|
| Function name | `partnerOptionsDeltaPicksV1` |
| HTTP method | `GET` |
| Request URL | `https://us-central1-alpha-vantage-proxy-api.cloudfunctions.net/partnerOptionsDeltaPicksV1` (also `https://partneroptionsdeltapicksv1-lsluydmucq-uc.a.run.app`) |
| Authentication | Google OIDC ID token from an allowlisted service account |
| Data source | Firestore `options-delta-picks` collection (pre-materialized) |
| Request scope | One cell — `(symbol, type, delta, dte)` + one `year` shard |
| Data delivery | Synchronous JSON response — one document per call |
| Browser support | No. Server-to-server only. |

---

## Authentication Model

The endpoint uses the same dual-auth middleware as existing partner endpoints.

- Cloud Run IAM requires the caller to have `roles/run.invoker` on the deployed function.
- Application authorization requires the service account email to be in the `ALLOWED_SERVICE_ACCOUNT_EMAILS` secret.
- The caller sends `Authorization: Bearer <Google OIDC ID token>`.
- The ID token must include an `email` claim and use the deployed endpoint URL as its audience.
- A Firebase user identity token is rejected with `403 FORBIDDEN` — **service-account tokens only**.
- Never place service account credentials or token-minting capability in browser code.

The full SA setup guide lives in [`partner-auth-and-audience.md`](../partner-auth-and-audience.md). Minting/calling examples in [`contract-availability-discovery.md`](contract-availability-discovery.md#authentication-model) apply identically — only the endpoint URL changes.

---

## Request Parameters

| Parameter | Required | Format | Description |
|---|---:|---|---|
| `symbol` | Yes | Ticker symbol | Equity symbol, case-insensitive. Letters/digits/hyphens — class shares use hyphen form (`BRK-B`, not `BRK.B`). Must be options-enabled. |
| `type` | Yes | `put` or `call` (`P`/`C` accepted) | Option type. Sign of the target delta is implied by type (puts are negative deltas). |
| `delta` | Yes | Integer 5–95 | Target delta **magnitude** × 100 — must be a grid level (multiples of 5). `20` = the 20-delta cell. |
| `dte` | Yes | Integer | Target days-to-expiration — must be a grid level: `7, 14, 21, 30, 45, 60, 90, 120, 180, 365`. |
| `year` | Yes | `YYYY` | Calendar-year shard to serve. |

Example: a 20-delta put at ~45 DTE on QQQ for 2026 —
`?symbol=QQQ&type=put&delta=20&dte=45&year=2026`
serves `options-delta-picks/QQQ-put-20-45/years/2026`.

**Off-grid parameters** (a `delta` or `dte` that isn't a materialized grid level — e.g. `delta=17`, `dte=63`) return `400` naming the invalid component. On-demand compute for off-grid cells is intentionally out of scope.

---

## Response Semantics

A successful response returns the stored year-sharded cell document:

```jsonc
{
  "ok": true,
  "symbol": "QQQ",
  "type": "put",
  "targetDelta": -0.20,              // signed: puts negative, calls positive
  "expiry": { "mode": "nearestDte", "dte": 45 },
  "gridVersion": 1,
  "firstDate": "2026-01-02",         // first day key in this shard
  "lastDate": "2026-10-30",          // latest day key — grows nightly
  "pickCount": 200,                  // days with a picked contract
  "missCount": 4,                    // days with a miss status
  "days": {
    "2026-04-01": {
      "underlyingClose": 584.31,     // split-adjusted close
      "contractId": "QQQ260515P00565000",
      "expiration": "2026-05-15",
      "dte": 44,                     // ACTUAL DTE of the chosen expiration
      "strike": 565,
      "delta": -0.204,               // OBSERVED delta — closest to target
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
  "updatedAt": "2026-10-30T16:52:39.747Z"   // ISO-8601; null when unstamped
}
```

### Day entry — pick (no `status` field; presence of `contractId` means pick)

| Field | Meaning |
|---|---|
| `underlyingClose` | Symbol's split-adjusted close that day. Present when an adjusted close exists; absent means "spot unavailable", never `0`. |
| `contractId` | OCC-style ID: `{SYM}{YYMMDD}{C\|P}{strike×1000}` |
| `expiration` | ISO date of the chosen expiration |
| `dte` | **Actual** calendar days to expiration — differs from target when the nearest listed expiration isn't exact |
| `strike` | Strike in dollars |
| `delta` | **Observed** delta on the chain — closest to target, not exactly the target |
| `iv` | Observed implied volatility |
| `mark` / `bid` / `ask` | Observed quotes |
| `volume` / `openInterest` | Observed that day |

Quote fields are **omitted — never zero-filled** — when a chain row lacks a parseable value. Absence means "not observed."

### Day entry — miss

| `status` | Meaning |
|---|---|
| `no_chain` | No corpus chain for that (symbol, date) — a data gap. Self-repairs: when the chain is later seeded, the next materialization pass replaces this entry with a real pick. |
| `no_match` | Chain exists but no contract satisfied the cell's criteria (no expiration near target DTE, or none near target delta). May carry `reason` detail. |

---

## Selection Semantics

Each (symbol, date) is picked independently:

1. Chain contracts filtered to the cell's option type.
2. The listed expiration **nearest to the target DTE** is chosen.
3. Among that expiration's contracts: `argmin |observedDelta − targetDelta|`.

**Expect contract rolls.** Nothing ties day N's pick to day N−1's — the selected contract changes as the nearest-DTE expiration hops forward and delta drifts. Use `contractId` + `expiration` + `dte` to detect rolls; do not assume continuity across days.

**No liquidity filter.** The picker always returns the closest-delta real listed contract — including stale/thin ones (`openInterest: 0`, wide spreads). `openInterest`, `bid`, `ask`, `volume` are on every pick so consumers apply their own liquidity rules. The doc records what the market offered, not a curated opinion — deep-grid cells on thin underlyings will regularly pick illiquid contracts.

---

## Grid

- **Deltas (magnitude):** `5 → 95` step `5` — 19 levels (sign implied by type)
- **DTE targets:** `7, 14, 21, 30, 45, 60, 90, 120, 180, 365` — non-uniform on purpose (dense weeklies; monthly/quarterly/annual conventions)
- **Types:** `put`, `call`

→ 19 × 10 × 2 = **380 cells per symbol per year** (~49k cell docs across the universe). The set is config — future levels are additive-only; existing docs are never rewritten.

---

## Freshness & Self-Repair

- **Nightly append:** when a day's chain is stored, one entry is appended to each cell doc's `days` map; `firstDate`/`lastDate`/`pickCount`/`missCount` recompute inside the write transaction.
- **Backstop:** a scheduled coverage reconciler diffs expected trading days vs stored chains and re-seeds gaps — a healed gap materializes its pick automatically.
- **Self-repair:** `no_chain` entries are recomputed when a previously missing chain lands — the doc converges to truth without a rebuild.
- Historical entries are immutable once written; `updatedAt` reflects the last append/repair.

---

## Limits and Expected Behavior

- One cell + one year per call — a full-year backtest for one cell is a single document fetch (typically tens of ms). Multi-year backtests = one call per year shard; multi-cell = one call per cell.
- Symbols: any `optionsEnabled = true` symbol. Others return `404 OPTIONS_NOT_ENABLED`.
- A `year` shard that hasn't materialized yet (e.g., a future year) returns `404`.
- `days` keys are trading days only — no weekend/holiday entries.
- Earliest expected coverage: **2026-01-01**.

---

## Error Handling

| HTTP | Code | Meaning / Consumer action |
|---|---|---|
| 200 | (none) | Success — year doc returned. |
| 400 | `BAD_REQUEST` | Missing/invalid param, or off-grid `delta`/`dte` — the message names which component failed. Correct the request. |
| 401 / 403 | (auth middleware) | Invalid/missing ID token, `aud` mismatch, email not allowlisted, IAM denied. |
| 403 | `FORBIDDEN` | A Firebase identity token was presented instead of a service-account ID token. |
| 404 | `OPTIONS_NOT_ENABLED` | Symbol not in the options-enabled universe. |
| 404 | `NOT_FOUND` | Valid params, but the requested year shard doc doesn't exist. |
| 405 | `METHOD_NOT_ALLOWED` | Only `GET` is supported. |
| 500 | `INTERNAL_ERROR` | Retry once or twice; report persistent failures with the response timestamp. |

---

## Integration Readiness Checklist

Before onboarding, partners should provide:

1. Environment name and service account email.
2. Confirmation that the caller is a backend service, not browser code.
3. Expected request volume and typical cell patterns (which delta/DTE cells, how many symbols, backtest batch sizes).
4. Acceptance of pick-roll semantics — no `contractId` continuity across days.
5. Own liquidity policy — picks carry raw observed quotes; no liquidity filter is applied upstream.

Savant will provide:

1. The deployed endpoint URL.
2. IAM invoker access and application allowlisting.
3. Known-good `(symbol, type, delta, dte, year)` values for acceptance testing.
4. The canonical grid (or its published `gridVersion`).

---

## Related Documents

- `contract-availability-discovery.md` — companion endpoint: which contracts/dates have data.
- `partner-auth-and-audience.md` — dual-auth model and audience configuration.
- `partner-endpoint-inventory.md` — full partner endpoint index.
- `docs/topics/213-options-data/213-215-SPEC-options-delta-picks-consumer-contract.md` — the consumer-contract spec this doc summarizes.
- Reference asset: `src/assets/data/options-delta-picks-QQQ-put-0.20-45-apr2026.example.json` — a validated cell doc generated from real production chains.
