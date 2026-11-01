# Verification Guide — Task #225: partnerOptionsDeltaPicksV1 (pick-doc endpoint)

**Scope:** the partner HTTPS handler serving `options-delta-picks/{cellId}/years/{YYYY}`.
Covers everything testable **pre-deploy**: param validation matrix, method gate,
the real Firestore doc read, the optionsEnabled gate, and the response envelope.
The deployed-HTTPS smoke (401/405/OIDC token → 200) runs at QA after the
function is deployed.

## `options-data-225-pick-endpoint.ts`

Invokes `partnerOptionsDeltaPicksHandler` locally with the auth seam stubbed to a
service-account identity and the **default** `readCellYearDoc` — so the doc read
hits prod `options-delta-picks` for real. **Read-only — no writes.**

### Command

```powershell
cd functions
$env:GCLOUD_PROJECT='alpha-vantage-proxy-api'
npx ts-node -r tsconfig-paths/register -P scripts/tsconfig.json scripts/verify/options-data-225-pick-endpoint.ts [SYMBOL] [YEAR]
```

### Arguments

| Arg | Default | Description |
|---|---|---|
| `SYMBOL` | `QQQ` | Options-enabled symbol to read (`put 20Δ/45DTE` cell). |
| `YEAR` | `2026` | Year shard to serve. |

### Prerequisites

- ADC with Firestore read on prod (`gcloud auth application-default login`).
- `GCLOUD_PROJECT=alpha-vantage-proxy-api` — without it local ADC may resolve a
  different dev project and the optionsEnabled gate / doc read fail.

### What it checks

| # | Check | Expected |
|---|---|---|
| 1 | `POST` with valid params | `405 METHOD_NOT_ALLOWED` |
| 2 | Missing `symbol` | `400 BAD_REQUEST` naming `symbol` |
| 3 | `type=strangle` | `400 BAD_REQUEST` naming `type` |
| 4 | `delta=17` (off-grid) | `400 BAD_REQUEST` naming `delta` |
| 5 | `dte=63` (off-grid) | `400 BAD_REQUEST` naming `dte` |
| 6 | `year=20X6` | `400 BAD_REQUEST` naming `year` |
| 7 | `symbol=BRK.B` (codec-unencodable) | `400 BAD_REQUEST` naming `symbol` — never a 500 |
| 8 | `symbol=ZZZNOSUCH1` | `404 OPTIONS_NOT_ENABLED` (real gate) |
| 9 | `year=2099` shard | `404 NOT_FOUND` (real doc read) |
| 10 | `{symbol} put 20/45 {year}` | `200` + full cell-doc envelope |
| 11 | Day entries | every key `YYYY-MM-DD` inside shard; pick/miss counts match headers |
| 12 | `updatedAt` | ISO-8601 string — no `{_seconds,_nanoseconds}` leak |

### Passing output (2026-11-01 run)

```
PASS: POST → 405 METHOD_NOT_ALLOWED
PASS: missing symbol → 400 BAD_REQUEST naming symbol
PASS: invalid type → 400 BAD_REQUEST naming type
PASS: off-grid delta 17 → 400 BAD_REQUEST naming delta
PASS: off-grid dte 63 → 400 BAD_REQUEST naming dte
PASS: malformed year → 400 BAD_REQUEST naming year
PASS: dotted symbol (codec-unencodable) → 400 BAD_REQUEST naming symbol
PASS: ZZZNOSUCH1 → 404 OPTIONS_NOT_ENABLED
PASS: QQQ-put-20-45/years/2099 → 404 NOT_FOUND
PASS: GET QQQ put 20Δ/45DTE 2026 → 200
... (envelope + day-entry checks)
=== All verification checks passed — QQQ-put-20-45/years/2026 served 208 day entries ===
```

### Failing output

Any `FAIL:` line prints the offending status/code and exits 1. A 500 on the
`OPTIONS_NOT_ENABLED` or doc-read checks usually means wrong ADC project
(set `GCLOUD_PROJECT`) or missing Firestore permission.

### Teardown

None — read-only, no artifacts created.
