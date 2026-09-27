**Topic:** IV time series  
**Topic Slug:** iv-time-series  
**Thread:** IV history for all tracked symbols  
**Thread Slug:** iv-history-tracked-symbols  
**Issue:** #179  
**Task:** #173  
**Thread Parent:** #159  
**Topic Parent:** #158  
**Domain:** OPTIONS-DATA  
**Type:** UAT  
**Status:** Complete  
**Created:** 2026-09-27  
**Last Updated:** 2026-09-27  

# UAT — Task #173: IV metrics production verify script

## What was verified

The script `options-data-173-iv-metrics-endpoint.ts` ran against **prod** —
real computeForDate write, Firestore read-back, and live authed calls to the
deployed `partnerIvMetricsV2` (token minted via `maintenance-bot`
impersonation, `--include-email`, aud = an existing allowlisted audience).

## Results — all PASS

```text
PASS: computeForDate wrote the day entry (fields: ["iv30","iv30Method","iv30Contracts"])
PASS: day entry read-back (iv30=0.16121999999999997)
PASS: no token → 401
PASS: range read 200
PASS: range returned 1 rows
PASS: rows ascending by date
PASS: target date 2024-01-05 present in range rows
PASS: endpoint iv30 matches stored (0.16121999999999997)
PASS: point read returns exactly one row
PASS: metrics=iv30 filters the row fields
PASS: untracked ZZZXQ → 404 NOT_FOUND
PASS: disabled symbol A → 403 OPTIONS_NOT_ENABLED
```

- `QQQ 2024-01-05` — same canonical record as Task #170 (recomputed, idempotent).
- `A` — real tracked symbol with `optionsEnabled=false`, found dynamically.
- README row added; companion `.md` guide documents token minting.

## Non-blocking observation (ops, not code)

`EXPECTED_GOOGLE_AUDIENCE` does **not** include the partnerIvMetricsV2 URL —
callers minting `aud=<the endpoint's own URL>` would be rejected; verification
passed because the auth check accepts **any** listed audience. If the
convention is "each partner endpoint's URL is registered," the secret needs a
`partnerIvMetricsV2` entry added. Endpoint owner decides.

## Traceability

| AC | Result |
|---|---|
| Script passes against prod | PASS (all checks) |
| README table updated | PASS |
| Day entry exists with iv30 fields | PASS |
| Endpoint range + point reads | PASS |
| Untracked/disabled error codes | PASS (404 / 403) |

## Verdict

**PASS** — task ship-eligible.
