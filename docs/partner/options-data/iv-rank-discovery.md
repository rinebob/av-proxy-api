# Partner IV Rank V2 — Discovery Document

**Status:** Deployed; serving the full options-enabled symbol universe  
**Audience:** Partner engineering and administrative teams  
**Last updated:** 2026-11-03

---

## Overview

`partnerIvRankV2` is a server-to-server HTTPS endpoint that answers, in one
GET: **the latest IV-rank snapshot for every options-enabled symbol** — a
cross-symbol screener table. It scans the `iv-rank-latest/{SYMBOL}` Firestore
collection, one doc per symbol, maintained by the nightly rank pass.

This is a **read-only, on-demand** API. It does not call Alpha Vantage.
There is **no `symbol` parameter** — the endpoint always returns the whole
table (~130 rows); filter client-side. For a *per-symbol daily series* use
[`partnerIvMetricsV2`](iv-metrics-discovery.md); this endpoint answers
"which underlyings have elevated IV *right now*".

Each row carries rank fields over four trailing calendar-day windows
(30/60/180/360) computed from that symbol's `iv30` series:

- `ivRank{W}` — where the latest `iv30` sits within the trailing window (0–100)
- `ivPct{W}` — percent of window observations with IV ≤ latest (0–100)
- `ivN{W}` — the window's IV30 sample count (data maturity)

---

## Deployed Endpoint

| Property | Value |
|---|---|
| Function name | `partnerIvRankV2` |
| HTTP method | `GET` |
| Request URL | `https://us-central1-alpha-vantage-proxy-api.cloudfunctions.net/partnerIvRankV2` |
| Direct Cloud Run URL | `https://partnerivrankv2-lsluydmucq-uc.a.run.app` |
| Authentication | Google OIDC ID token from an allowlisted service account |
| Data source | Firestore `iv-rank-latest` collection |
| Request scope | Whole table — no symbol parameter |
| Data delivery | Synchronous JSON response |
| Browser support | No. Server-to-server only. |

---

## Authentication Model

Identical service-account-only model to `partnerIvMetricsV2` — invoker IAM +
email allowlist + `aud` in `EXPECTED_GOOGLE_AUDIENCE` + `Authorization:
Bearer` with an `email` claim; Firebase user tokens → `403 FORBIDDEN`.

Mint against the **base-host** audience and reuse one token across all
partner endpoints:

```bash
SA="your-partner-sa@your-project.iam.gserviceaccount.com"
HOST="https://us-central1-alpha-vantage-proxy-api.cloudfunctions.net"

TOKEN="$(gcloud auth print-identity-token \
  --impersonate-service-account="${SA}" \
  --audiences="${HOST}" \
  --include-email)"

curl -H "Authorization: Bearer ${TOKEN}" \
  "${HOST}/partnerIvRankV2?sort=ivRank360&dir=desc&minN=20"
```

Full setup guide: [`partner-auth-and-audience.md`](../partner-auth-and-audience.md).

---

## Request Parameters

| Parameter | Required | Format | Description |
|---|---|---:|---|
| `sort` | No | `ivRank{30\|60\|180\|360}`, `ivPct{…}`, `ivN{…}` | Sort field — **strict whitelist**; anything else → `400` (a misspelled sort must not silently return an unsorted table). Omit → symbol ascending. |
| `dir` | No | `asc` \| `desc` | Sort direction. Default `desc` when `sort` is supplied (high-rank first — the typical screener use). |
| `minN` | No | Non-negative integer | Sample-count floor applied to the **sort window's** `ivN` (`sort=ivRank30` → floor on `ivN30`). When `sort` is omitted, falls back to `ivN360`. Default `0` (no filter). Rows failing the floor are removed entirely. |

Missing sort values always **sink to the bottom** of the table, in either
direction — a symbol whose window lacks enough samples never outranks a
measured one.

Unknown query parameters are ignored — including `symbol` (there is no
per-symbol mode; filter `rows[]` client-side).

---

## Response Semantics

```json
{
  "ok": true,
  "count": 130,
  "sort": "ivRank360",
  "dir": "desc",
  "minN": 20,
  "rows": [
    {
      "symbol": "QQQ",
      "asOfDate": "2026-10-30",
      "ivRank30": 82.7, "ivPct30": 85.7, "ivN30": 14,
      "ivRank60": 82.7, "ivPct60": 85.7, "ivN60": 14,
      "ivRank180": 82.7, "ivPct180": 85.7, "ivN180": 14,
      "ivRank360": 82.7, "ivPct360": 85.7, "ivN360": 147,
      "updatedAt": "2026-10-30T21:05:12.000Z"
    }
  ],
  "timestamp": "2026-11-03T01:47:00.000Z",
  "processingTimeMs": 88
}
```

| Field | Type | Description |
|---|---|---|
| `count` | number | `rows.length` — rows after `minN` filtering. |
| `sort` / `dir` / `minN` | echo | The effective parameters applied. |
| `rows[].symbol` | string | Options-enabled symbol. |
| `rows[].asOfDate` | `YYYY-MM-DD` | The trading date the snapshot was computed from — ranks are only as fresh as the latest corpus observation. |
| `rows[].ivRank{W}` | number? | Rank-in-range over the trailing W-day window (0–100). **Absent when `ivN{W} < 2`** — withheld fields are missing keys, not zeros. |
| `rows[].ivPct{W}` | number? | Percent of observations ≤ current (0–100). Absent when `ivN{W} = 0`. |
| `rows[].ivN{W}` | number | Sample count in the window — always present. |
| `rows[].updatedAt` | ISO-8601 \| null | When the latest doc was written (serialized Timestamp). |

Membership tracks the enabled set: disabling `optionsEnabled` deletes the
symbol's `iv-rank-latest` doc, so it drops out of the table automatically.

---

## Interpreting the numbers

- `ivRank360 = 82` → the latest `iv30` is higher than ~82% of the trailing
  year's observations — **elevated for this symbol**, which is the question
  an IV-rank screen exists to answer.
- Always read `ivN` with the rank — `ivRank30 = 95` on `ivN30 = 3` is a thin
  window; gate with `minN` server-side or `ivN` client-side.
- Sparse corpus coverage is exposed via `ivN`, never suppressed — a symbol
  with 10 days of history legitimately has `ivN360 = 10`.

---

## Limits and Expected Behavior

- Table size tracks the enabled universe (~130 rows today); there is no
  paging — the full filtered table returns in one response.
- Function timeout: **60 seconds**. Max instances: **10**.

---

## Error Handling

| HTTP | Code | Meaning / Consumer action |
|---|---|---|
| 200 | (none) | Success. |
| 400 | `BAD_REQUEST` | `sort` outside the rank-field whitelist, `dir` not `asc`/`desc`, `minN` negative or non-integer. Correct the request. |
| 401 / 403 | (auth middleware) | Invalid or missing ID token, `aud` mismatch, email not allowlisted, or IAM invoker denied. |
| 403 | `FORBIDDEN` | A Firebase identity token was presented — service-account tokens only. |
| 405 | `METHOD_NOT_ALLOWED` | Only `GET` is supported. |
| 500 | `INTERNAL_ERROR` | Retry once or twice; report persistent failures with the response timestamp. |

---

## Integration Readiness Checklist

Before onboarding, partners should provide:

1. Environment name and service account email.
2. Confirmation the caller is a backend service, not browser code.
3. Expected request volume and refresh cadence (the table updates once per
   trading day in the weekday-evening corpus rank pass — polling faster
   yields nothing new).
4. Agreement to gate on `ivN`/`minN` for data maturity and to filter
   `rows[]` client-side when a single symbol is wanted.

Savant will provide:

1. The deployed endpoint URL(s).
2. IAM invoker access and application allowlisting.
3. A known-good acceptance query (e.g. `?sort=ivRank360&dir=desc&minN=20`).

---

## Related Documents

- `iv-metrics-discovery.md` — the per-symbol daily IV series (companion).
- `partner-auth-and-audience.md` — dual-auth model and audience configuration.
- `partner-endpoint-inventory.md` — full partner endpoint index.
- `docs/topics/158-options-data/` — PRD/IMPL/UAT for the IV-rank thread
  (Topic #158, Thread #163).
