# Partner Data Access Discovery

Audience: External partner engineering/admin teams integrating with Savant partner endpoints. This document explains partner-facing surfaces, authentication, data schemas, and operational expectations.

Last updated: 2025-10-08

> Start here: Read this discovery guide first to understand the surface area, data shapes, and auth model. When ready to make requests, proceed to `docs/partner-integration.md` for step-by-step integration examples.

---

## Overview

SavantApi.com maintains a centralized, Firestore-backed market data service. Partner applications consume data through secure HTTPS endpoints operated on Firebase/Cloud Run. The current partner-exposed surface focuses on normalized time series data aggregated from Alpha Vantage (AV) and stored in a sharded Firestore schema.

For server-to-server integrations, partners should use Google OIDC (service account identity tokens) with allowlisting. See `docs/partner-integration.md` for end-to-end examples.

### Operational Checklist (Quick Start)
- Ensure Cloud Run requires authentication; remove `allUsers` from invokers
- Grant `roles/run.invoker` to each partner service account
- Configure partner auth via Secret Manager (not plain env vars):
  - `ALLOWED_SERVICE_ACCOUNT_EMAILS` → comma-separated SA emails
  - `EXPECTED_GOOGLE_AUDIENCE` → exact deployed service URL (Cloud Run)
- Partner mints Google OIDC ID token with exact `aud` = service URL and `--include-email`
- Test with curl; expect 200 for allowlisted SA, 403 for anonymous

---

## Partner Endpoint Surface

- Endpoint: Partner Time Series API (read-only)
  - Deployed as a Google Cloud HTTPS function/service (Cloud Functions for Firebase / Cloud Run)
  - Canonical function name (current): `partnerTimeSeriesV2`
  - Purpose: Deliver normalized OHLCV bars for common intervals without hitting upstream providers directly

### Authentication Notes
- Dual-auth middleware accepts either:
  - Google OIDC ID token (preferred for partners), with `email` claim present and `aud` equal to the deployed Cloud Run URL
  - Firebase ID token (used internally)
- Allowlist and audience are sourced from Secret Manager:
  - `ALLOWED_SERVICE_ACCOUNT_EMAILS`
  - `EXPECTED_GOOGLE_AUDIENCE`
- See `docs/partner-integration.md` for exact setup commands and request examples.

> Preflight: Before requesting access, confirm your real service account email(s) and the exact Cloud Run URL for `partnerTimeSeriesV2`. Partner calls must target the Cloud Run service URL and mint tokens with that URL as the audience. See the "Partner Preflight Checklist" in `docs/partner-integration.md`.

---

## Data Provider & Storage Model (Overview)

- Provider (current primary): Alpha Vantage (AV)
  - We persist adjusted series by default for `DAILY`, `WEEKLY`, and `MONTHLY`.

- Canonical Firestore paths (non-intraday):
  - Top-level provider/interval doc (metadata only):
    - `symbol-data/{SYMBOL}/time-series/{av-daily-adjusted|av-weekly-adjusted|av-monthly-adjusted}`
    - Fields: `metadata{ symbol, interval, histStartTs, histEndTs, lastUpdated, nextRefreshAt, ttlSeconds, vendor, endpoint }`, and `latestBarTimestamp` (Firestore Timestamp for the latest bar)
  - Year‑sharded docs for `DAILY`/`WEEKLY`:
    - `symbol-data/{SYMBOL}/time-series/{docId}/years/{YYYY}` → `{ bars: CompactBar[], count, firstBarTs, lastBarTs, updatedAt }`
  - Single ‘all’ doc for `MONTHLY`:
    - `symbol-data/{SYMBOL}/time-series/{docId}/all/data` → `{ bars: CompactBar[], count, firstBarTs, lastBarTs, updatedAt }`

- Compact bar schema (subset):
  - `t` (epoch ms, UTC day)
  - `d` (optional `YYYY-MM-DD` UTC)
  - `o,h,l,c` (OHLC), `v` (volume)
  - Adjusted series fields: `ac` (adjusted close), `dv` (dividend), `sc` (split coefficient)
  - Derived: `ch` (change), `cp` (percent change)
  - Intraday snapshot fields may be present on the latest bar: `ip, io, it, ic, ipc`

- Reader behavior (what partners receive):
  - The partner reader clamps requested windows using numeric `histStartTs`/`histEndTs` from metadata, loads relevant year docs, filters bars by `from`/`to` (or presets like `1y`), sorts ascending, and returns `availableYears`, `count`, and `bars`.

---

## Authentication and Security (Partner)

We use dual-auth middleware to validate partner requests. Recommended approach is Google OIDC with allowlisted service accounts.

- Primary auth: Google OIDC ID token (service account)
  - Allowlist env var: `ALLOWED_SERVICE_ACCOUNT_EMAILS` (comma-separated list)
  - Header: `Authorization: Bearer <id_token>`
  - Token must include an `email` claim matching an allowlisted service account
  - `aud` (audience) must equal the deployed function URL
- IAM lockdown: Cloud Run invoker is restricted; anonymous/public invocations are blocked
- Alternate auth (case-by-case): Firebase ID token

---

## IAM Lockdown (Summary)

Partner endpoints are protected by both IAM (Cloud Run invoker) and application-level allowlisting (dual-auth with email allowlist).

- Remove public invoker (`allUsers`); require authentication on `partnerTimeSeriesV2`
- Grant `roles/run.invoker` to partner service accounts only
- Set `ALLOWED_SERVICE_ACCOUNT_EMAILS` to the same partner SA emails and deploy a new revision
- Partner must send OIDC ID token with `aud` = exact service URL and include the `email` claim

For full CLI and Console steps, see “IAM Lockdown and Allowlisting (Required)” in `docs/partner-integration.md`.

---

## Partner Time Series API

- HTTPS method: GET
- URL: Provided during onboarding (e.g., `https://us-central1-alpha-vantage-proxy-api.cloudfunctions.net/partnerTimeSeriesV2`)

### Query parameters
- `symbol` (required) — e.g., `AAPL`
- `interval` (required) — `DAILY` | `WEEKLY` | `MONTHLY`
- `range` (optional) — `ytd` | `1y` | `3y` | `5y` | `max`
- `from` (optional) — ISO `YYYY-MM-DD` or epoch ms
- `to` (optional) — ISO `YYYY-MM-DD` or epoch ms
- `limit` (optional) — truncate to the last N bars after filtering

Defaults used when `range/from/to` are not provided:
- DAILY: last 1 year
- WEEKLY: last 5 years
- MONTHLY: all available

### Example requests

- Last 1 year of daily bars
```
GET /partnerTimeSeriesV2?symbol=AAPL&interval=DAILY&range=1y
Authorization: Bearer <id_token>
```

- Weekly bars YTD
```
GET /partnerTimeSeriesV2?symbol=MSFT&interval=WEEKLY&range=ytd
Authorization: Bearer <id_token>
```

- Explicit date range and limit
```
GET /partnerTimeSeriesV2?symbol=GOOGL&interval=DAILY&from=2024-01-01&to=2024-12-31&limit=100
Authorization: Bearer <id_token>
```

### Response shape

```
{
  "ok": true,
  "symbol": "AAPL",
  "interval": "DAILY",
  "provider": "av",
  "endpointDocId": "av-daily-adjusted",
  "rangeUsed": { "from": 1704768000000, "to": 1725849600000, "preset": "1y" },
  "availableYears": [2023, 2024],
  "count": 252,
  "bars": [
    {
      "t": 1725494400000,
      "d": "2024-09-05",
      "o": 220.1,
      "h": 222.3,
      "l": 219.8,
      "c": 221.5,
      "v": 51234567,
      "ac": 221.5,
      "dv": 0,
      "sc": 1,
      "ch": 1.4,
      "cp": 0.64,
      "ic": null,
      "ipc": null
    }
  ],
  "timestamp": "2025-09-09T00:00:00.000Z",
  "truncated": false
}
```

- `bars[].t` is epoch milliseconds (UTC); `bars[].d` is optional `YYYY-MM-DD` (UTC) added on newer writes
- Required adjusted fields for AV adjusted series: `ac` (adjusted close), `dv` (dividend), `sc` (split coefficient)
- `ch`/`cp` are derived day-over-day change metrics; `ic`/`ipc` are intraday change metrics present on pre-close snapshots
- Prices are decimals; volume is integer; not all optional fields will appear on every bar

### Limits and behavior
- Soft cap: Data begins in 1999 so ~6500 bars is a safe limit
- Ordering: ascending time order
- Missing days (holidays) are naturally absent; weekly/monthly represent period bars
- Symbols must be initialized in our backend. If you receive 404, contact us to initialize the symbol

---

## Data Schema (internal reference)

We normalize upstream data into a sharded Firestore schema to support high-volume writes and efficient reads.

- Canonical collection: `symbol-data/{SYMBOL}/time-series/{provider-interval}`
  - Non-intraday sharding: `years/{YYYY}` (bar documents grouped under the year)
  - Intraday sharding (optional): `days/{YYYY-MM-DD}/bars/{ISO_TIMESTAMP}`
  - Top-level doc stores metadata fields such as `latestBarTimestamp`
  - Provider-interval IDs:
    - `av-daily-adjusted`
    - `av-weekly-adjusted`
    - `av-monthly-adjusted`

- Bar document schema (compact):
```
{
  "t": number,  // epoch ms UTC
  "o": number,  // open
  "h": number,  // high
  "l": number,  // low
  "c": number,  // close (adjusted for AV daily adjusted)
  "v": number,  // volume
  "d": string?, // YYYY-MM-DD (UTC)
  "ch": number?, // change in decimal
  "cp": number? // change percentage
}
```

Notes:
- Prior close is not persisted; compute as the previous bar’s `c` if needed.
- Important: Legacy shapes like `{ data, metadata }` on time-series docs are deprecated; all new logic uses the normalized, enum-driven schema above.

---

## Freshness and TTL Strategy (Reference)

A background refresher keeps Firestore current by reloading data from upstream according to endpoint TTLs. The scheduler triggers refresh runs and only rewrites documents when `metadata.nextRefreshAt` is missing or due.

- AV time-series:
  - Daily cadence at pre-close and post-close (3:30PM and 4:30PM Eastern) 
  - After a successful refresh: set `metadata.lastUpdated`, `metadata.ttlSeconds`, `metadata.nextRefreshAt`
  - TTLs are defined per endpoint in `shared/alpha-vantage/av-endpoint-configs.ts` and `AV_TIME_SERIES_ENDPOINT_CONFIGS`
  - Cron schedules live in `functions/src/v2/common/function-schedules.ts` (source of cron truth only)

> Partners do not need to orchestrate refresh; the API reads from Firestore only and does not fan-out upstream synchronously.

---

## Onboarding Checklist (Partner)

1. Provide the service account email(s) your backend will use.
2. We add them to `ALLOWED_SERVICE_ACCOUNT_EMAILS` on the deployed `partnerTimeSeriesV2` service (Cloud Run env var; IAM invoker is locked down).
3. Mint a Google OIDC ID token with `aud` equal to the exact function URL and include the `email` claim.
4. Call the `partnerTimeSeriesV2` endpoint with `Authorization: Bearer <id_token>`.

See `docs/partner-integration.md` for cURL/Node/PowerShell examples.

---

## Error Handling and Troubleshooting

- 401/403 Unauthorized/Forbidden
  - Missing/invalid ID token, `aud` mismatch, email not allowlisted, or IAM invoker denies
- 404 Not Found
  - Symbol not initialized in Firestore
- 400 Bad Request
  - Invalid `interval` / `range` / date formats
- 5xx Errors
  - Transient issues; retry with backoff and contact Savant if persistent

---

## Contacts

- Integration support: Contact your Savant representative or open a ticket in the shared tracker.
- Security/allowlisting changes: Provide the service account email(s) and target environment (dev/stage/prod).
