**Topic:** IV time series  
**Topic Slug:** iv-time-series  
**Thread:** IV rank  
**Thread Slug:** iv-rank  
**Issue:** #189  
**Task:** #189  
**Blueprint Parent:** #184  
**Thread Parent:** #163  
**Topic Parent:** #158  
**Domain:** OPTIONS-DATA  
**Type:** Code Review  
**Status:** Complete  
**Created:** 2026-10-17  
**Last Updated:** 2026-10-17  

# Code Review — Task #189: partnerIvRankV2 screener endpoint

## Scope reviewed

- `functions/src/v2/partner/iv-rank-partner.ts`
- `functions/src/index.ts` — export
- `functions/tests/v2/partner/iv-rank-partner.test.ts` (10 tests)

## Findings (remediated in-review)

1. **`updatedAt` SDK-shape leak (minor → fixed)** — rows were raw
   `IvRankLatestDoc`s, so `updatedAt` serialized as Firestore's
   `{_seconds,_nanoseconds}`. → Mapped to ISO-8601 (null-safe), matching
   sibling partner convention. Test added.
2. **`minN` default — spec ambiguity (resolved, no code change)** — PRD
   says the screener "applies a min-n filter by default." Resolved with
   author input: the filter exists via `minN=`; the endpoint defaults to
   0 (return everything, `n` emitted) consistent with the thread's
   flag-don't-suppress decision. The param IS the filter; consumers set
   their own maturity threshold.

## Verified

- Auth/gating order + envelope identical to `partnerIvMetricsV2`
  (method → audience → dual auth → serviceAccountEmail → params)
- Sort whitelist strict (misspelled sort → 400, not silent unsorted);
  missing sort values sink either direction; `minN` maps to the sort
  field's `ivN{W}` window (`ivPct60` → `ivN60`), `ivN360` fallback
- `index.ts` export present; secrets in `functionOptions`
- Tests: method, non-SA 403, sort asc/desc, missing-sink, minN window
  mapping + fallback, 400 matrix, empty table, ISO serialization

## Deploy note

`EXPECTED_GOOGLE_AUDIENCE` needs both URL forms for `partnerIvRankV2`
appended (new secret version + function redeploy to re-pin) — same
procedure recorded for #225 in the ops runbook.

## Pass 2 (fresh-eyes on final state)

**NO FINDINGS.** Re-verified the `toIso` transform typing, corrupt-doc path
(missing `symbol` → caught 500, unreachable via own writer), `minN` NaN
handling, digit-suffix mapping, and row shape vs spec. Converged — a third
pass has no expected yield on a ~170-line read-only endpoint.

## Verdict

**PASS** — task → QA.
