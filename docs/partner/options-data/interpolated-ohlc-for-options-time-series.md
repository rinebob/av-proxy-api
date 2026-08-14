# ADR 0001: Interpolated OHLC for Options Time Series

**Date:** 2026-07-23
**Status:** Proposed
**Decision makers:** Savant API engineering

---

## Context

The historical options time-series corpus stores per-contract daily observations in JSONL files. Each observation contains market data (mark, bid, ask, volume, IV, Greeks) but **no open, high, or low values**. Alpha Vantage's `HISTORICAL_OPTIONS` endpoint does not provide intraday OHLC for individual contracts.

Consumers (RS backtesting) want to render candlestick charts for individual option contracts. Without O/H/L, they can only render a line series of mark values, or attempt their own interpolation — which duplicates logic across every consumer and requires access to underlying equity data they may not have.

## Decision

**Compute interpolated O/H/L values server-side using the Black-Scholes-Merton model and store them in the JSONL files.**

For each observation:
- **Open** = BSM(underlying_open, K, T, r, q, σ, type)
- **High** = BSM(underlying_high, K, T, r, q, σ, type)
- **Low** = BSM(underlying_low, K, T, r, q, σ, type)
- **Close** = observed mark (no change)

When IV or underlying OHLC is unavailable, O/H/L are set equal to the mark (flat candle).

The interpolated values are stored as compact aliases (`io`, `ih`, `il`) in the JSONL and expanded to `open`, `high`, `low` in the API response. GCS metadata and the API response envelope include `ohlcMethod: "interpolated"` and a disclaimer string making it unambiguous that these are not observed market quotes.

### Key parameters (v1)

| Parameter | Value | Source |
|---|---|---|
| Risk-free rate (*r*) | 4.0% (constant) | Configurable; TODO: upgrade to per-date Treasury yields |
| Dividend yield (*q*) | QQQ: 0.5%, TQQQ: 0% (constant per symbol) | Configurable |
| Time-to-expiration (*T*) | Calendar days / 365 | Standard BS convention |
| IV (*σ*) | Stored `iv` from the observation | Alpha Vantage |
| Underlying OHLC | Split-adjusted from `sa-time-series` Firestore | Existing data pipeline |
| Precision | 2 decimal places, stored as string | Consistent with existing fields |
| Edge cases | T≤0 → intrinsic value; all output clamped to ≥0 | Safety |

## Alternatives Considered

### A. Do nothing — let consumers interpolate

Consumers would need underlying OHLC data, a BS implementation, and per-contract metadata (strike, expiration, type, IV) to compute their own O/H/L. This duplicates logic, requires data the consumer may not have, and shifts computational cost to every consumer.

**Rejected:** The service's stated principle is "pivoting daily snapshots into per-contract series is the service's responsibility, not the consumer's." The same principle applies to interpolation.

### B. Store raw underlying OHLC per observation, let consumers compute

Add `underlying_open`, `underlying_high`, `underlying_low` to each JSONL line. Consumers run BS themselves.

**Rejected:** Doubles the per-line data the consumer must process, still requires every consumer to implement BS, and the consumer still needs strike/expiration/type/rate/dividend yield. The service is better positioned to do this once.

### C. Use a different model (e.g., binomial tree, Monte Carlo)

More accurate for American-style options (early exercise premium) or dividend handling. QQQ/TQQQ options are American-style, so a binomial model would technically be more precise. However, BS-Merton is a well-established approximation for American-style index options, the early exercise premium for these liquid contracts is typically negligible, and the values are for visualization — not trading decisions.

**Rejected:** Over-engineered for the use case. BS-Merton is sufficient and trivially fast. The early exercise premium is immaterial for candlestick visualization.

### D. Fetch live Treasury yields per date for the risk-free rate

More accurate than a constant rate. The Alpha Vantage `TREASURY_YIELD` endpoint provides historical yields.

**Deferred:** The risk-free rate has the smallest impact on BS price relative to underlying price and IV. For visualization candlesticks, a 50bps error is imperceptible. Upgrade to live Treasury yields is a TODO item.

## Consequences

- **Storage:** Each JSONL line grows by 3 small string fields (`io`, `ih`, `il`) when interpolation succeeds. Approximately 20-30 bytes per line. Across ~300k-500k files, total storage increase is modest.
- **Schema:** Additive only. Existing consumers that don't know about `io`/`ih`/`il` are unaffected. No schema version bump.
- **API:** Response envelope gains optional `ohlcMethod`, `ohlcDisclaimer`, and `contractLength` fields. Per-observation `open`, `high`, `low` are optional and only present when interpolated.
- **Operational:** One-time enrichment pass for existing QQQ files (~300k-500k files via Cloud Tasks). TQQQ build and daily append incorporate interpolation inline.
- **Accuracy:** Interpolated O/H/L are theoretical values, not observed market quotes. The `ohlcMethod` and `ohlcDisclaimer` metadata makes this inviolable. Consumers must not represent these as actuals.
- **Reversibility:** Removing interpolated fields later would require another full enrichment pass. The additive nature means old consumers are unaffected, but the data is now embedded in the files.
