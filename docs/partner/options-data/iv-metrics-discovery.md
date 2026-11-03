# Partner IV Metrics V2 — Discovery Document

**Status:** Deployed; serving all options-enabled symbols; the
weekday-evening corpus rank pass keeps rank fields current  
**Audience:** Partner engineering and administrative teams  
**Last updated:** 2026-11-03

---

## Overview

`partnerIvMetricsV2` is a server-to-server HTTPS endpoint that answers, in one
GET: **the daily implied-volatility metric series for a symbol** over a date
range. It serves pre-materialized `days` entries from the year-sharded
`symbol-metrics/{SYMBOL}/years/{YYYY}` Firestore documents written by the
corpus pipeline (seed-worker metric pass).

This is a **read-only, on-demand** API. It does not call Alpha Vantage; it
serves data maintained by the internal pipeline. It is the per-symbol,
per-day counterpart to the cross-symbol screener
(`partnerIvRankV2`) — use this endpoint when you need the *time series*
(e.g. an IV input to a Black-Scholes calc), not the latest snapshot.

The headline field is **`iv30`** — one implied-volatility observation per
trading day, interpolated from that day's full option chain to a constant
~30-day at-the-money tenor. That is the single-line IV series a pricing
model consumes.

---

## Deployed Endpoint

| Property | Value |
|---|---|
| Function name | `partnerIvMetricsV2` |
| HTTP method | `GET` |
| Request URL | `https://us-central1-alpha-vantage-proxy-api.cloudfunctions.net/partnerIvMetricsV2` |
| Direct Cloud Run URL | `https://partnerivmetricsv2-lsluydmucq-uc.a.run.app` |
| Authentication | Google OIDC ID token from an allowlisted service account |
| Data source | Firestore `symbol-metrics` year-sharded docs |
| Request scope | One `symbol` + `from`/`to` date range |
| Data delivery | Synchronous JSON response |
| Browser support | No. Server-to-server only. |

---

## Authentication Model

Same service-account-only model as every options partner endpoint.

- Cloud Run IAM requires `roles/run.invoker` on the deployed function.
- Application authorization requires the SA email in
  `ALLOWED_SERVICE_ACCOUNT_EMAILS`.
- Send `Authorization: Bearer <Google OIDC ID token>` with an `email` claim
  and an `aud` in `EXPECTED_GOOGLE_AUDIENCE`.
- A Firebase user identity token is rejected with `403 FORBIDDEN`.
- Never place SA credentials or token minting in browser code.

The full SA setup guide lives in
[`partner-auth-and-audience.md`](../partner-auth-and-audience.md).

### Minting and calling (server-to-server)

```bash
SA="your-partner-sa@your-project.iam.gserviceaccount.com"
HOST="https://us-central1-alpha-vantage-proxy-api.cloudfunctions.net"

# The base host is a permanent EXPECTED_GOOGLE_AUDIENCE entry — one token
# covers every partner function; per-function URLs work too but drift
# when the secret is repinned.
TOKEN="$(gcloud auth print-identity-token \
  --impersonate-service-account="${SA}" \
  --audiences="${HOST}" \
  --include-email)"

curl -H "Authorization: Bearer ${TOKEN}" \
  "${HOST}/partnerIvMetricsV2?symbol=AAPL&from=2026-01-01&to=2026-10-30&metrics=iv30"
```

From application code (no `gcloud`), use a Google auth library's
`idTokenProvider`/`IdTokenClient` with `targetAudience = ${HOST}`.

---

## Request Parameters

| Parameter | Required | Format | Description |
|---|---|---:|---|
| `symbol` | Yes | Ticker symbol | Equity symbol, case-insensitive. Must be tracked + options-enabled. |
| `from` | Yes | `YYYY-MM-DD` | Inclusive range start. |
| `to` | Yes | `YYYY-MM-DD` | Inclusive range end. `from <= to`; total span ≤ 10 years. |
| `metrics` | No | Comma-separated field names | Field whitelist. **Absent → all fields.** Present but containing only unknown names → `400`. Unknown names are ignored (lenient forward compat — new fields don't break older clients). |

Unknown query parameters are ignored.

---

## Response Semantics

```json
{
  "ok": true,
  "symbol": "AAPL",
  "from": "2026-01-01",
  "to": "2026-10-30",
  "metrics": ["iv30", "ivRank360", "ivN360"],
  "rows": [
    { "date": "2026-10-29", "iv30": 0.2401, "ivRank360": 79.5, "ivN360": 146 },
    { "date": "2026-10-30", "iv30": 0.2456, "ivRank360": 82.7, "ivN360": 147 }
  ],
  "timestamp": "2026-11-03T01:47:00.000Z",
  "processingTimeMs": 41
}
```

- `rows` are sorted by `date` ascending; one row per stored `days` entry in range.
- Rows exist only for dates with computed metrics — a date without a stored
  entry simply produces no row (not a zero row).
- Only requested fields present on the entry are emitted; a field absent on a
  day produces no key (absent key = no data, distinct from `0`).

### Field reference

| Field | Type | Description |
|---|---|---|
| `date` | string `YYYY-MM-DD` | Trading date (always present). |
| `iv30` | number | Constant-maturity ATM implied volatility, 30-day tenor, decimal (0.24 ≈ 24%). |
| `iv30Method` | `'interpolated' \| 'nearest'` | How the IV30 point was produced — total-variance interpolation between bracketing expirations, or nearest-expiration fallback when no pair bracketed the tenor. |
| `iv30Contracts` | number | Usable-IV contracts in the contributing expiration(s) — a chain-depth quality signal. |
| `ivRank{30,60,180,360}` | number | Rank-in-range of that day's `iv30` vs the trailing {30,60,180,360}-calendar-day window of IV30 observations (0–100). Present only when `ivN{W} ≥ 2`. |
| `ivPct{30,60,180,360}` | number | Percent of window observations with IV ≤ that day's `iv30` (0–100). Present when `ivN{W} > 0`. |
| `ivN{30,60,180,360}` | number | IV30 sample count in the window — data maturity, always emitted when the metric exists. |

**Rank freshness caveat:** rank fields on historical rows are frozen at the
time each day was computed. Only the newest day's ranks (and the
`iv-rank-latest` doc served by `partnerIvRankV2`) reflect full later
coverage — do not read old `ivRank` values as "what the rank is today".

---

## Limits and Expected Behavior

- `from`/`to` span is capped at **10 years** — wider → `400`.
- Response is capped at **10 MiB** — oversized ranges → `413
  RESPONSE_TOO_LARGE`; narrow the range or reduce `metrics`.
- Sparse corpus coverage is normal for backfilled symbols — `ivN` exposes
  the sample count rather than suppressing rows.
- Function timeout: **60 seconds**. Max instances: **10**.

---

## Error Handling

| HTTP | Code | Meaning / Consumer action |
|---|---|---|
| 200 | (none) | Success. |
| 400 | `BAD_REQUEST` | Missing/invalid `symbol`, malformed or inverted `from`/`to`, span > 10 years, `metrics=` with only unknown names. Correct the request. |
| 401 / 403 | (auth middleware) | Invalid or missing ID token, `aud` mismatch, email not allowlisted, or IAM invoker denied. |
| 403 | `FORBIDDEN` | A Firebase identity token was presented — service-account tokens only. |
| 403 | `OPTIONS_NOT_ENABLED` | Symbol is tracked but `optionsEnabled` is off. |
| 404 | `NOT_FOUND` | Symbol is not tracked. |
| 405 | `METHOD_NOT_ALLOWED` | Only `GET` is supported. |
| 413 | `RESPONSE_TOO_LARGE` | Response exceeded 10 MiB — narrow the range/fields. |
| 500 | `INTERNAL_ERROR` | Retry once or twice; report persistent failures with the response timestamp. |

---

## Integration Readiness Checklist

Before onboarding, partners should provide:

1. Environment name and service account email.
2. Confirmation the caller is a backend service, not browser code.
3. Expected request volume and typical symbol/range patterns.
4. Agreement that `ivN` gates downstream use of rank fields — thin windows
   are exposed, not hidden.

Savant will provide:

1. The deployed endpoint URL(s).
2. IAM invoker access and application allowlisting.
3. A known-good `symbol` + range for acceptance testing.

---

## Related Documents

- `iv-rank-discovery.md` — the cross-symbol latest-rank screener built on
  this same metric family.
- `partner-auth-and-audience.md` — dual-auth model and audience configuration.
- `partner-endpoint-inventory.md` — full partner endpoint index.
- `docs/topics/158-options-data/` — PRD/IMPL/UAT for the IV time-series and
  IV-rank threads (Topic #158).
