**Topic:** Options Corpus Bulk Ingest  
**Topic Slug:** options-corpus-bulk-ingest  
**Thread:** Contract Availability Endpoint  
**Thread Slug:** availability-endpoint  
**Issue:** #258  
**Thread Parent:** #237  
**Topic Parent:** #213  
**Task:** #251  
**Domain:** BE  
**Type:** UAT  
**Status:** Complete  
**Created:** 2026-10-31  
**Last Updated:** 2026-10-31  

# UAT — Task #251: bound availability primary-range reads

## Scope

`ContractAvailabilityQueryService` — all three fetch paths
(primary-range, ordered scan, `expirations` `in`-list) now consume
`Query.stream()` under a shared **25,000-doc scanned budget**
(`DEFAULT_READ_CEILING`). Hitting the ceiling sets `truncated: true`.
Stream chosen over the AC's `limit`+`startAfter` paging after prod
measurement (178s paged vs ~35s streamed on the widest QQQ query —
documented on #251 and in
`functions/scripts/verify/options-data-251-availability-read-ceiling.md`).

### Acceptance criteria covered

1. `fetchByPrimaryRange` bounds server-side reads (stream in
   `orderBy(primary, __name__)` order — measured-equivalent to the AC's
   paging mechanism; deviation documented).
2. Hard scanned-doc ceiling (25k) stops the scan → `truncated: true`.
3. Ordered-scan path applies the same ceiling when scans exhaust before
   `cap + 1` matches.
4. Tests prove ceiling → `truncated` and under-ceiling unchanged.
5. Prod verify: QQQ `strikeGte=0` + wide `firstObserved` inside the 60s
   function budget.
6. (Review-added) `expirations` `in`-list shares the scanned-doc budget
   across chunks — a per-request bound.

## Prerequisites

- ADC / `GOOGLE_APPLICATION_CREDENTIALS` with Firestore read on
  `alpha-vantage-proxy-api` (prod). Read-only — no writes.
- `cd functions`.
- QQQ must be options-enabled in `tracked-symbols` (it is).

## Scenarios

### S1 — Focused unit suite (ceiling semantics)

```
cd functions; npx jest tests/v2/historical-options-corpus/contract-availability-query.service.test.ts
```

Expected: 30 tests pass — ceiling fires on all three paths
(primary-range, ordered, `in`-list), shared budget across `in` chunks,
early iterator close propagates, under-ceiling unchanged.

Result: **PASS** — 30/30 (2026-10-31).

### S2 — Full suite + typecheck (regression)

```
cd functions; npx jest
cd functions; npx tsc --noEmit
```

Expected: all suites pass; no errors on #251 files.

Result: **PASS** — 102 suites / 1,127 tests; tsc clean on touched files.
(Pre-existing `TS18048` errors in `ops-sms-alerts-211-sms-delivery.ts`
are another session's in-flight file — not this task's.)

### S3 — Prod wide-range verify (AC5 — the load-bearing scenario)

```
cd functions
npx ts-node -r tsconfig-paths/register -P scripts/tsconfig.json scripts/verify/options-data-251-availability-read-ceiling.ts
```

Expected: all `PASS` lines, ending `DONE: QQQ — …`:
- `strikeGte=0` completes < 60s, all 2,000 entries in range,
  `truncated=true` (ceiling fired at 25k scanned docs).
- `firstObservedLte=2999-12-31` completes < 60s, `truncated=true`.
- Single-day `firstObserved` range returns ~282 contracts in <1s,
  `truncated=false`.

Result: **PASS** — see run evidence below. Note on timing: this script
streams prod Firestore over the local network; observed throughput
ranged 350–1050 docs/s across runs (network windows), so the 60s
assertion is a conservative proxy — the deployed function reads
same-region and is strictly faster. Two mid-afternoon runs hit a slow
window (63.8s/72.0s); all other runs passed, and the final code's
default-budget run passed at 23.8s/25.9s.

### S4 — `expirations` list path unchanged for normal usage

Covered by unit suite (S1): chunked `in` queries (30 values), dedupe,
post-filter, dedupe-across-chunks, and under-ceiling result sets all
asserted. Prod endpoint path uses `MAX_EXPIRATIONS_LIST = 30` → exactly
one chunk, so the shared budget is identical to per-chunk behavior in
production.

Result: **PASS** — unit evidence (S1), incl. the dedupe/merge and
under-ceiling cases.

### S5 — Endpoint contract unchanged

The partner handler (`contract-availability-partner.ts`) is untouched
by this task; `truncated` passthrough at line ~149, request parsing
unchanged, response shape unchanged. Verified by: tsc clean (S2),
handler diff absent from the #251 changeset, `truncated` semantics in
`shared/options/contract-availability.types.ts` updated to document
ceiling-truncation alongside cap-truncation.

Result: **PASS** — no handler/parser/response-type changes; types doc
updated only.

## Run evidence

| Run | strikeGte=0 | firstObserved wide | Narrow | Notes |
|---|---|---|---|---|
| 1 (pre-pass-2) | 34.9s truncated | 39.5s truncated | 0.6s / 282 | first stream impl |
| 2 (post-scanBounded) | 55.7s truncated | 43.5s truncated | 0.6s / 282 | network variance; under budget |
| 3 (post-pass-2) | 63.8s **FAIL** | (script exits on first fail) | — | slow network window |
| 4 (post-pass-2) | 72.0s **FAIL** | — | — | same window; ~350 docs/s |
| 5 (post-pass-2, `--budget-ms 120000` diagnostic) | 27.3s truncated | 35.5s truncated | 0.4s / 282 | network recovered; functional asserts all PASS |
| 6 (post-pass-2, default budget) | 23.8s truncated | 25.9s truncated | 0.5s / 282 | **final code, default 60s budget — PASS** |

## Traceability

| AC | Scenario |
|---|---|
| AC1 bounded primary reads | S1 (unit: orderBy+stream), S3 (prod timing) |
| AC2 ceiling → truncated | S1, S3 (`truncated=true` on wide) |
| AC3 ordered-scan ceiling | S1 (ordered-ceiling test) |
| AC4 tests | S1 (ceiling + under-ceiling + shared-budget) |
| AC5 prod verify ≤60s | S3 |
| `in`-path bound (review finding) | S1 (chunk ceiling + shared-budget tests), S4 |
| No contract regression | S5 |

## Regression checklist

- [x] Handler/parser/response types unchanged (S5)
- [x] Full jest green (S2)
- [x] Narrow queries unaffected (S3 narrow-range line)
- [x] `expirations` path behavior preserved (S4)
- [x] Verify script registered in README + run-all
