# Partner API Surface (Single-Page Overview)

Audience: Partner backend teams integrating with Savant’s partner endpoints and Pub/Sub notifications.

Last updated: 2025-11-13

## What you get

- Normalized time-series reads via HTTPS (daily/weekly/monthly AV-adjusted OHLCV)
- Event-driven discovery via Pub/Sub Data‑Ready messages
- Strict, allowlisted server-to-server auth (Google OIDC)

---

## Endpoints (HTTPS)

- Base project/region (example):
  - Project: `alpha-vantage-proxy-api`
  - Region: `us-central1`

- Partner endpoints:
  - `partnerListTrackedSymbolsV2` (GET)
    - Purpose: list currently tracked symbols
    - Example:
      ```bash
      HOST="https://us-central1-alpha-vantage-proxy-api.cloudfunctions.net"
      URL_LIST="${HOST}/partnerListTrackedSymbolsV2"
      curl -i -H "Authorization: Bearer ${TOKEN_LIST}" \
        "${URL_LIST}?activeOnly=true&limit=500"
      ```
  - `partnerTimeSeriesV2` (GET)
    - Purpose: read normalized OHLCV time series
    - Params:
      - `symbol` (required): e.g., AAPL
      - `interval` (required): `DAILY` | `WEEKLY` | `MONTHLY`
      - `range` (optional): `ytd` | `1y` | `3y` | `5y` | `max`
      - `from`, `to` (optional): ISO `YYYY-MM-DD` or epoch ms
      - `limit` (optional)
    - Example:
      ```bash
      URL_TS="${HOST}/partnerTimeSeriesV2"
      curl -i -H "Authorization: Bearer ${TOKEN_TS}" \
        "${URL_TS}?symbol=AAPL&interval=DAILY&range=1y"
      ```

Notes
- Data reads are served from Firestore; partners never hit upstream vendors directly.
- Freshness is maintained by back-end schedulers; see Discovery below.

---

## Auth (Server-to-Server)

- Method: Google OIDC ID token from a partner service account (SA)
- Requirements:
  - SA email must be allowlisted (`ALLOWED_SERVICE_ACCOUNT_EMAILS`)
  - Cloud Run IAM must grant `roles/run.invoker` to your SA
  - ID token `aud` must equal the exact function URL you call
  - Include the `email` claim (`--include-email`)
- Quick mint (testing):
  ```bash
  AUD_LIST="https://us-central1-alpha-vantage-proxy-api.cloudfunctions.net/partnerListTrackedSymbolsV2"
  AUD_TS="https://us-central1-alpha-vantage-proxy-api.cloudfunctions.net/partnerTimeSeriesV2"
  TOKEN_LIST="$(gcloud auth print-identity-token --audiences="${AUD_LIST}" --include-email)"
  TOKEN_TS="$(gcloud auth print-identity-token --audiences="${AUD_TS}" --include-email)"
  ```

See: docs/partner-integration.md for full IAM, secrets, and troubleshooting guidance.

---

## Discovery (Pub/Sub)

- Topic: `partner-data-ready`
- Purpose: notify partners when data is updated and when daily bars are finalized
- Use cases:
  - Trigger reads on PRE or POST runs for DAILY
  - Trigger reads for WEEKLY or MONTHLY POST runs

### Message schema (v1 highlights)

- Data payload (JSON):
  - `version: "v1"`
  - `runId: "YYYY-MM-DD-(pre|post)[-suffix]"`
  - `phase: "pre" | "post"`
  - `marketDate?: "YYYY-MM-DD"`
  - `time: number` (epoch ms)
  - `timing.nextRefreshAtUTC: string` (ISO)
  - `timing.finalizedAtUTC?: string` (ISO; present on POST when the finalized bar was first detected)
  - plus optional counts/metrics
- Attributes:
  - `version`, `runId`, `phase`
  - `runType`: `non_time_series` | `ts_daily_pre` | `ts_daily_post` | `ts_weekly_post` | `ts_monthly_post`

See: docs/rel-str_partner-data-ready-pubsub-integration.md for full schema and examples.

### Subscription filters (examples)

- Finalized (POST) only:
  ```
  attributes.runType = "ts_daily_post" OR attributes.runType = "ts_weekly_post" OR attributes.runType = "ts_monthly_post"
  ```
- Daily only (both phases):
  ```
  attributes.runType = "ts_daily_pre" OR attributes.runType = "ts_daily_post"
  ```
- Exclude non-time-series:
  ```
  attributes.runType != "non_time_series"
  ```

---

## Freshness model (reference)

- Authoritative next refresh: `nextRefreshAtUTC` (consolidated; schedule-driven)
- Finalization marker: `finalizedAtUTC` indicates first detection of finalized daily data (POST)
- Partners should prefer Pub/Sub notifications over polling

---

## Responses (time series)

Example shape:
```json
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
    { "t": 1725494400000, "d": "2024-09-05", "o": 220.1, "h": 222.3, "l": 219.8, "c": 221.5, "v": 51234567, "ac": 221.5, "dv": 0, "sc": 1, "ch": 1.4, "cp": 0.64, "ic": null, "ipc": null }
  ],
  "timestamp": "2025-09-09T00:00:00.000Z",
  "truncated": false,
  "processingTimeMs": 37
}
```

Notes
- `bars[].t` is epoch ms (UTC) and `bars[].d` is an optional human-readable `YYYY-MM-DD` (UTC)
- Adjusted series include `ac` (adjusted close), `dv` (dividend), `sc` (split coefficient)
- Pre-close snapshots may include `ip`, `io`, `it`, `ic`, `ipc` on the latest bar

---

## Handy references

- Discovery: docs/partner-discovery.md
- Pub/Sub: docs/rel-str_partner-data-ready-pubsub-integration.md
- Integration details & auth: docs/partner-integration.md
- Backend overview: docs/backend-functions-overview.md
