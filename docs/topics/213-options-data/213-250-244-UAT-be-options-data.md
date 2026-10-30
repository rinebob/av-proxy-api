**Topic:** Options Corpus Bulk Ingest  
**Topic Slug:** options-corpus-bulk-ingest  
**Thread:** Contract Availability Endpoint  
**Thread Slug:** availability-endpoint  
**Issue:** #250  
**Thread Parent:** #237  
**Topic Parent:** #213  
**Task:** #244  
**Domain:** BE  
**Type:** UAT  
**Status:** Complete  
**Created:** 2026-10-30  
**Last Updated:** 2026-10-30

# UAT — Task #244: Availability data services (query + corpus-dates)

## Scope

The two services behind `partnerContractAvailabilityV1` (#245 wires
them into the handler):

- `ContractAvailabilityQueryService` — deterministic primary-range
  precedence (`expiration` > `firstObserved` > `strike`) server-side;
  all other dims post-filtered in memory; `expirations` list as chunked
  `in` queries (≤30) merged + deduped; `strikeStep` integer-cent grid;
  sorted `expiration asc → strike asc → contractId asc`; ordered-page
  early-exit at cap+1 on expiration-primary/unfiltered paths;
  `truncated` at 2,000; `lastUpdated` stripped.
- `CorpusDatesService` — `historical-options/v1/{SYMBOL}/` listing,
  strict `YYYY-MM-DD` calendar validation, nested/non-date objects
  excluded, dates sorted ascending.

## Prerequisites

- Repo at the post-review state of task #244 (working tree).
- `cd functions` — all commands run there.
- For S4 (prod): ADC credentials with Firestore read + GCS read.
- For S5: the two new composite indexes must be deployed
  (`firebase deploy --only firestore:indexes` — run by the user on
  2026-10-30; confirmed `READY` before S5 ran).

## Scenarios

### S1 — Focused unit suites

```
cd functions
npx jest tests/v2/historical-options-corpus/contract-availability-query.service.test.ts tests/v2/historical-options-corpus/corpus-dates.service.test.ts
```

Expected: both suites pass (23 tests — precedence, post-filters,
strikeStep grid, chunked `in` + dedupe, ordering, cap+1, `lastUpdated`
strip, ordered paging, corpus prefix/format/pagination/dedup/loop-guard).

### S2 — Full suite + typecheck

```
cd functions
npx jest
npx tsc --noEmit
npx tsc --noEmit -P scripts/tsconfig.json
```

Expected: all suites green; both typechecks clean.

### S3 — Index declaration check

```
node -e "JSON.parse(require('fs').readFileSync('firestore.indexes.json','utf8'))"
gcloud firestore indexes composite list --project alpha-vantage-proxy-api --database="(default)" | Select-String "firstObserved|strike"
```

Expected: valid JSON; `(type ASC, firstObserved ASC)` and
`(type ASC, strike ASC)` on `ts-contracts` exist (state `READY`).

### S4 — Prod verify script (read-only)

```
cd functions
npx ts-node -r tsconfig-paths/register -P scripts/tsconfig.json scripts/verify/options-data-244-availability-services.ts
```

Expected: all asserts PASS incl. the two new-index-path checks
(`type`+`firstObserved`, `type`+`strike`) and corpus dates; finishes in
seconds-to-a-minute (ordered paging early-exits at 2,001 matches — no
full-collection scan).

### S5 — Boundary spot-checks

Covered inside S4's asserts: unmatched symbol → empty + `truncated=false`;
corpus dates strictly ascending `YYYY-MM-DD`; `strikeStep` grid only
aligned strikes; `expirations` list returns only listed expirations.

## Traceability

| AC | Scenario |
|---|---|
| Primary-range precedence + server-side selection | S1, S4 |
| expirations override + chunked `in` + dedupe | S1, S4 |
| strikeStep integer cents | S1, S4 |
| Deterministic ordering | S1, S4 |
| Cap+1 → `truncated` | S1, S4 |
| `lastUpdated` stripped | S4 |
| Corpus dates: prefix/format/sort | S1, S4 |
| Composite indexes for `type`+range combos | S3, S4 |
| Fake-based unit tests | S1 |

## Results

| Scenario | Result | Evidence |
|---|---|---|
| S1 focused suites | PASS | 28/28 tests (both files) |
| S2 full suite + tsc | PASS | 98 suites / 1,050 tests green; `tsc --noEmit` clean (main + scripts) |
| S3 indexes | PASS | `firestore.indexes.json` valid; both new indexes reached `READY` after ~10 min build; empirically proven by S4's index-path asserts |
| S4 prod verify (QQQ) | PASS | 15/15 asserts — 2,000 contracts `truncated=true`; `type`+`expiration` 116 puts; `type`+`firstObserved` and `type`+`strike` (new indexes) both 2,000; expirations list 480; strikeStep $10 grid; unmatched symbol empty; 1,965 corpus dates strictly ascending `YYYY-MM-DD`; unknown symbol empty. No Firestore timeout — ordered-page early-exit bounded the unfiltered scan. |
| S5 boundaries | PASS | covered inside S4 (see above) |
