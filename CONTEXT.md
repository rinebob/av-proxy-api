# Context — Domain Glossary

**Scope:** Historical options time-series corpus, partner-facing API, interpolated OHLC enrichment, and contract discovery.

---

## Glossary

### Raw Corpus

The collection of gzipped daily option-chain snapshots fetched from Alpha Vantage `HISTORICAL_OPTIONS`, stored at `historical-options/v1/{SYMBOL}/{YYYY-MM-DD}.json.gz` in `av-hist-options-corpus-bucket`. One object per `(symbol, trading date)` containing the full validated provider response.

### Time Series

A per-contract JSONL file stored at `time-series/v1/{SYMBOL}/{CONTRACT_ID}.jsonl` in `av-options-time-series-bucket`. One observation per line, ordered ascending by date. Built by pivoting the raw corpus from daily snapshots into per-contract life-of-contract series.

### Observation

A single line in a time-series JSONL file. Represents one trading day's data for one contract. Contains compact-aliased fields: `d` (date), `l` (last), `m` (mark), `b` (bid), `bs` (bid_size), `a` (ask), `as` (ask_size), `v` (volume), `oi` (open_interest), `iv` (implied_volatility), `de` (delta), `g` (gamma), `t` (theta), `ve` (vega), `r` (rho).

### Interpolated OHLC

Open, high, and low values for an observation that are **not observed market quotes** but are computed by running the underlying's daily open, high, and low prices through the Black-Scholes-Merton model alongside the contract's stored implied volatility, strike, time-to-expiration, risk-free rate, and dividend yield. The mark serves as the close. Stored as `io` (interpolated open), `ih` (interpolated high), `il` (interpolated low) in the JSONL. Expanded to `open`, `high`, `low` in the API response.

### Mark

The observed mid-market price for a contract on a given trading day, as provided by Alpha Vantage. Serves as the close value in the OHLC candle. Stored as `m` in the JSONL, expanded to `mark` in the API response.

### Contract Length

A classification bucket representing the observed lifespan of a contract from its first appearance in the corpus to its expiration date. Computed using calendar-month differences between `firstObserved` and `expiration`. Buckets: `1d`, `1w`, `2w`, `1mo`, `2mo`, `3mo`, `6mo`, `1yr`, `2yr`, `3yr`, `3yr+`. Stored in GCS object metadata, returned in the API response envelope. Used for UI filtering.

### Enrichment Pass

A one-time administrative operation that processes existing time-series JSONL files to add interpolated OHLC values and contract-length metadata. Triggered via an admin HTTP function, executed via Cloud Tasks (one file per task). Idempotent — reprocessing an already-enriched file produces identical output.

### OHLC Method

A metadata field (`ohlcMethod`) stored in GCS object metadata and returned in the API response envelope. Value is `"interpolated"` when the file contains interpolated OHLC values. Accompanied by `ohlcDisclaimer`, a static human-readable string clarifying that O/H/L values are Black-Scholes interpolations, not observed market quotes. Both fields are only present when interpolation has been performed.

### Black-Scholes-Merton Model

The options pricing model used for interpolation. Extends the standard Black-Scholes formula with a continuous dividend yield parameter (*q*). Inputs: underlying price (*S*), strike (*K*), time-to-expiration in years (*T*), risk-free rate (*r*), dividend yield (*q*), implied volatility (*σ*), and option type (call/put). When *T* ≤ 0, intrinsic value is used. All output values are clamped to non-negative.

### Underlying OHLC

The split-adjusted daily open, high, and low prices for the symbol underlying an option contract. Sourced from the `sa-time-series` Firestore collection (`symbol-data/{SYMBOL}/sa-time-series/av-daily-adjusted/years/{YEAR}`). Pre-fetched once per symbol and held in memory as a date-keyed map during enrichment or build operations.

### Contract Discovery

The process of determining which option contracts exist in our GCS storage for a given symbol. OCC option tickers are publicly known and traded contracts are published by exchanges, but the question for consumers is: *does this particular contract exist in our database, and is there data for it?* Contract discovery answers this by reading the File Viewer Index. Two access paths exist: an internal admin Cloud Function (full access, includes raw file content) and a partner-facing API endpoint (metadata only, contract IDs + attributes). See ADR 0002.

### File Viewer Index

A derived Firestore cache that enables fast lookup of time-series contracts by expiration date or strike price. Stored at `options_file_index/{SYMBOL}/ts_expirations/{DATE}` and `options_file_index/{SYMBOL}/ts_strikes/{STRIKE}`. GCS remains the source of truth; the index is a cache that can be rebuilt from GCS filenames at any time. Maintained by the time-series builder on every file write. See ADR 0002.

### Storage File Viewer

An internal admin Angular page at `/storage-file-viewer` that provides a searchable, filterable interface for browsing file contents in the AV historical options GCS buckets (time-series and corpus). Three-pane layout: search controls across the top, file list on the left, file content viewer on the right. Requires `admin` role.

### Spread

A multi-leg options position composed of two or more individual option contracts on the same underlying symbol. Each leg has an expiration, strike, option type (call/put), and direction (long/short). The spread has a single daily price computed from the mark prices of its constituent legs, weighted by direction. Supported Phase 1 types: vertical, straddle, strangle, iron condor.

### Spread Leg

A single option contract within a spread. Defined by `{ expiration, strike, optionType, direction }`. The server constructs the OCC contract ID from these parameters to locate the contract's time-series JSONL file in GCS. No Firestore lookup is needed.

### Spread Pricing Engine

The service that computes a spread time series from individual leg time series. For each trading day in the intersection of all leg date ranges, it resolves each leg's mark price (via the mark fallback chain), computes the spread price as `sum(long leg marks) − sum(short leg marks)`, and computes spread-level Greeks as the signed sum of stored leg Greeks. No Black-Scholes computation is needed — Greeks are linear and already stored per observation.

### Mark Fallback Chain

The resolution order for determining a leg's daily mark price when the `mark` field is missing from the observation: (1) use `mark` if present, (2) compute `(bid + ask) / 2` if both are present, (3) carry forward the last known resolved mark, (4) skip the day. The fallback chain is defensive — data integrity tests confirm edge cases are rare in the actual dataset.

### Spread Time Series

A daily time series for a spread position, where each observation contains the spread price and spread-level Greeks (delta, gamma, theta, vega, rho). The series covers the intersection of all leg date ranges. Dates within the range where one or more legs have unresolvable data are surfaced in a `gaps` array. Returned as JSON numbers (not strings) with fixed precision: 2 decimals for price/delta/theta/vega/rho, 4 decimals for gamma.

### Strategy Scan

A planned async operation (Phase 3) that enumerates every instance of a strategy template across the historical dataset (e.g., "open a 1-month ATM iron condor every trading day, hold to expiration"), computes each spread's time series via the Spread Pricing Engine, and writes all results to GCS as a single downloadable file. Uses Cloud Tasks for parallel processing. Not yet implemented.

### Earnings Event Calendar

A planned system that ties options trading strategies to earnings dates. For each tracked symbol, the earnings timeline is synthesized from three Alpha Vantage endpoints: EARNINGS (historical actuals), EARNINGS_ESTIMATES (forward estimates), and EARNINGS_CALENDAR (upcoming dates). Options strategies around earnings have specific timing windows (e.g., 60-45 days before earnings, 1 day before, day-of, post-earnings volatility crush). Since earnings dates are known 3 months out from EARNINGS_CALENDAR, the event calendar can compute all strategy start dates upfront and schedule timed triggers for each phase. Repeats every quarter for each tracked symbol. The three AV endpoints are the data layer; the event calendar and strategy triggers are a future phase that consumes this data. See Topic #33.
