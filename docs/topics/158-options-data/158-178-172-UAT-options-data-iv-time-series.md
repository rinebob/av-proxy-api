**Topic:** IV time series  
**Topic Slug:** iv-time-series  
**Thread:** IV history for all tracked symbols  
**Thread Slug:** iv-history-tracked-symbols  
**Issue:** #178  
**Task:** #172  
**Thread Parent:** #159  
**Topic Parent:** #158  
**Domain:** OPTIONS-DATA  
**Type:** UAT  
**Status:** Complete  
**Created:** 2026-09-27  
**Last Updated:** 2026-09-27  

# UAT — Task #172: partnerIvMetricsV2 endpoint

## User-reviewable surface

`GET /partnerIvMetricsV2?symbol=QQQ&from=2024-01-02&to=2024-01-05&metrics=iv30`

Response:

```json
{ "ok": true, "symbol": "QQQ", "from": "…", "to": "…",
  "metrics": ["iv30"],
  "rows": [{ "date": "2024-01-05", "iv30": 0.1612 }],
  "timestamp": "…", "processingTimeMs": 12 }
```

Read-only against `symbol-metrics/{SYM}/years/{YYYY}` — deployable before
data lands (empty range → `rows: []`).

## Scope

ACs from Task #172:

- AC1 — range read returns ascending rows across year boundaries
- AC2 — `metrics=` whitelist-filters via `SYMBOL_METRIC_FIELDS` (default all)
- AC3 — 404 untracked; OPTIONS_NOT_ENABLED disabled; empty range → `[]`
- AC4 — handler-seam unit tests; prod smoke via Task #173 verify

## Scenarios

### 1. Handler suite

- `npx jest tests/v2/partner/iv-metrics-partner.test.ts` — 10 tests:
  405/400 (missing symbol, missing range, malformed from, inverted range),
  404 untracked, 403 OPTIONS_NOT_ENABLED, cross-year ascending rows,
  metrics filter, unknown-metric lenient ignore, empty `[]`, 500 on reader
  throw, auth-reject passthrough. Corrupt `days` fixture is skipped.
- **Result:** PASS.

### 2. Registration + typecheck + regression

- `partnerIvMetricsV2` exported from `index.ts`; `tsc --noEmit` clean;
  full suite 77/748.
- **Result:** PASS.

### 3. Prod smoke

- Deferred to Task #173 (deployed smoke). Post-deploy curl against a
  seeded symbol confirms 200 + rows; untracked symbol confirms 404;
  disabled symbol confirms 403 OPTIONS_NOT_ENABLED.
- **Result:** DEFERRED — read-only endpoint; no prod traffic yet.

## Negative / boundary

- Range > 10 years → 400; `from > to` → 400; all-unknown `metrics=` → 400.
- Non-service-account auth → 403 FORBIDDEN; missing auth → middleware 401.
- Year-shard docs absent → null → skipped (empty rows, not error).
- Corrupt `days` entry (null/non-object) → skipped, row omitted.

## Traceability

| AC | Scenario |
|---|---|
| AC1 (cross-year ascending) | 1 |
| AC2 (metrics whitelist) | 1 |
| AC3 (gates + empty) | 1 |
| AC4 (tests + prod smoke) | 1, 3 |

## Regression/smoke checklist

- [x] Handler suite green (10)
- [x] Full jest green (748) + `tsc` clean
- [ ] Post-deploy prod smoke (Task #173)
