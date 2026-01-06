# Alpha Vantage Firestore Data Service – Phase 1 Dataset Baseline

This document is intended as a **prompt for an LLM** used by partner teams. It describes the current capabilities and near‑term roadmap of the Alpha Vantage–backed Firestore data service so that downstream applications can be designed against a realistic, stable contract.

---

## 1. High-Level Positioning

You are integrating with a **centralized Firestore-backed market data service** that normalizes and stores Alpha Vantage time-series data. This service is the **single source of truth** for OHLCV bars and related metadata; partner apps will **never** call Alpha Vantage directly.

The dataset described here represents the **Phase 1 production baseline**. Future phases will extend the metadata surface (e.g., supported-symbols reporting) but will preserve these core guarantees.

---

## 2. Current Dataset Guarantees (Phase 1 – As of 2026‑01‑04)

### 2.1 Symbol Universe

- The service maintains a **tracked universe** of symbols in Firestore under the collection:
  - `tracked-symbols/{SYMBOL}`
- As of this baseline, there are **696 tracked symbols**.
- There is a **1:1 mapping** between tracked symbols and symbol-data documents:
  - `symbol-data/{SYMBOL}` exists for every tracked symbol.
  - No `symbol-data` document is empty; each has at least basic metadata fields such as `createdAt` and `createdBy`.

### 2.2 Time-Series Coverage (Split-Adjusted Only)

For **every tracked symbol**, the following Alpha Vantage split‑adjusted time-series parents exist and are structurally populated:

- **Daily adjusted OHLCV**
  - Path: `symbol-data/{SYMBOL}/sa-time-series/av-daily-adjusted`
  - Year-sharded children: `.../years/{YYYY}` with compact bar arrays.
- **Weekly adjusted OHLCV**
  - Path: `symbol-data/{SYMBOL}/sa-time-series/av-weekly-adjusted`
  - Year-sharded children: `.../years/{YYYY}` with compact bar arrays.
- **Monthly adjusted OHLCV**
  - Path: `symbol-data/{SYMBOL}/sa-time-series/av-monthly-adjusted`
  - Single `all` document holding the full compact bar array.

Key points:

- Legacy, non‑split‑adjusted `time-series` collections for AV OHLCV have been **wiped in production** and are no longer written.
- All OHLCV consumption should use the **`sa-time-series`** paths; this is the canonical storage for AV OHLCV going forward.

### 2.3 Refresh Cadence (Conceptual)

The service runs scheduled refreshers that update time-series data on trading days:

- **Daily adjusted (TIME_SERIES_DAILY_ADJUSTED)**
  - Pre‑close jobs write intraday snapshot fields into the latest bar.
  - Post‑close jobs write finalized OHLCV, adjusted close, dividends, splits, and derived change fields (`ch`, `cp`).
  - Retry jobs handle late or failed symbols.
- **Weekly and Monthly adjusted (TIME_SERIES_WEEKLY_ADJUSTED / TIME_SERIES_MONTHLY_ADJUSTED)**
  - Updated daily in a compact window so the most recent periods stay aligned with Alpha Vantage.

Partners should treat **post‑close runs** as the canonical points for consuming finalized daily/weekly/monthly bars.

### 2.4 Access Pattern for Partners

- Partners do **not** read Firestore directly.
- Instead, they call a **partner‑only HTTPS endpoint** (e.g., `partnerTimeSeriesV2`) that:
  - Authenticates via OIDC/IAM allowlists.
  - Reads from the `symbol-data/{SYMBOL}/sa-time-series/...` collections.
  - Returns time-series documents with compact bar arrays.

Details of the time-series API contract (request/response shape) are documented separately, but partners can assume that for any symbol in the tracked universe:

- Daily/weekly/monthly split-adjusted series **exist**.
- The series are **incrementally refreshed** on trading days.

---

## 3. Data Quality & Completeness Process

Internally, the team maintains a **completeness script** to validate the dataset after bulk imports and backfills:

- Script path: `functions/scripts/find-incomplete-sa-timeseries.ts`.
- Behavior:
  - Scans all `tracked-symbols`.
  - Verifies that `symbol-data/{SYMBOL}` exists and is non‑empty.
  - In "deep" mode, also verifies that daily/weekly/monthly `sa-time-series` parents exist and that at least one shard/all doc is present under each.
- As of this baseline, a deep run of the script reports **0 incomplete symbols**.

This means partner applications can treat the dataset as **structurally complete** for the current tracked universe.

---

## 4. Near-Term Roadmap – Supported Symbols Metadata

A future phase (Phase 2) will add a **Supported Symbols metadata layer** and corresponding endpoints. This is not implemented yet but is planned and should be considered in partner designs.

### 4.1 Symbol Support Endpoint (Planned)

A planned HTTP endpoint (name TBD, e.g., `getSymbolSupportV1`) will:

- Accept one or more symbols as input.
- Return, per symbol:
  - Whether it is part of the tracked universe.
  - Which intervals are available (daily/weekly/monthly), based on presence of non‑empty `sa-time-series` parents/shards.
  - Optionally, basic freshness indicators such as latest bar dates by interval.

This allows partner apps to:

- Validate user‑entered symbols.
- Feature‑gate functionality based on which intervals are present.
- Surface user‑friendly messages when a symbol is not yet supported.

### 4.2 Supported Symbols Universe Endpoint (Planned)

A companion endpoint will expose:

- The full tracked universe of symbols.
- High‑level counts (tracked symbols, coverage, last completeness audit timestamp).

Partner apps can use this to:

- Pre‑seed symbol pickers and configuration UIs.
- Periodically synchronize their own symbol catalogs.

---

## 5. Guidance for LLM-Assisted Partner Implementations

When using this document as a prompt for an LLM helping to build partner integrations, emphasize the following constraints and expectations:

1. **Do not call Alpha Vantage directly.** All time-series data must be fetched via the provided partner HTTPS endpoints backed by Firestore.
2. **Assume split-adjusted only.** All OHLCV bars should be treated as split-adjusted; there is no separate raw stream.
3. **Assume completeness for the tracked universe.** For any symbol in the tracked universe, daily/weekly/monthly adjusted series exist and are structurally valid.
4. **Design for a future "symbol support" API.** Where possible, structure the partner app so that it can:
   - Ask "is this symbol supported?"
   - Discover which intervals are available.
   - Degrade gracefully if a symbol is not in the tracked universe.
5. **Treat the Firestore dataset as the canonical API surface.** Any destructive changes (backfills, reseeds) are rare, managed operations; partner code should not depend on undocumented collections or perform writes.

Use this baseline to:

- Implement time-series ingestion and caching logic in partner applications.
- Design UIs and services that assume a stable, split-adjusted OHLCV stream.
- Plan for future integration with a symbol-support metadata API once it is exposed.
