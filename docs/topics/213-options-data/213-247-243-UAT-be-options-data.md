**Topic:** Options Corpus Bulk Ingest  
**Topic Slug:** options-corpus-bulk-ingest  
**Thread:** Contract Availability Endpoint  
**Thread Slug:** availability-endpoint  
**Issue:** #247  
**Thread Parent:** #237  
**Topic Parent:** #213  
**Task:** #243  
**Domain:** BE  
**Type:** UAT  
**Status:** Complete  
**Created:** 2026-10-30  
**Last Updated:** 2026-10-30

# UAT — Task #243: Shared types + request-param parser

QA issue: #247 · Code review: `213-242-243-CODE-REVIEW-be-options-data.md`
(verdict: PASS, 2 passes converged)

## Scope

Shared contract types (`ContractAvailabilityFilters`,
`ContractAvailabilityResponse`, `ContractAvailabilityErrorResponse`) and the
pure request-param parser (`parseContractAvailabilityQuery`,
`parseOptionalDateList`, `parseOptionType`) for
`partnerContractAvailabilityV1`. No endpoint exists yet — the handler and
data services are Tasks #244–#245. This task's user-visible surface is the
parser contract itself: what query params are accepted, normalized, and
rejected.

## Prerequisites

- Repo checkout at this branch; `cd functions && npm run copy-shared` once
  (builds `shared/` into `lib/shared` so `@shared/options` resolves).
- No credentials, emulators, or prod access needed — all checks are local
  and pure.

## Scenario execution log

### S1 — Focused parser suite — PASS

`cd functions && npx jest tests/v2/partner/contract-availability-request.utils.test.ts`
→ **15/15** green. Covers `parseOptionalDateList` (absent, trim, dedupe +
canonical sort, malformed element, non-calendar date) and
`parseContractAvailabilityQuery` (minimal, symbol validation, all filters,
`type` normalization ×4 forms + rejection, malformed-value rejection,
object-param rejection, inverted ranges ×3 pairs, `strikeStep <= 0` and
non-numeric, negative strike, `expirations` override + invalid list +
all-empty list + inverted-range-under-override regression).

### S2 — Direct parser exercise (live behavior) — PASS

Scratch script `.devin/tmp/uat-243-parser.ts` calling
`parseContractAvailabilityQuery` via `cd functions && npm run ts --
../.devin/tmp/uat-243-parser.ts`. Observed output for 10 cases:

- `' qqq '` → `{symbol:'QQQ'}` (trim + uppercase)
- full filter set → normalized params (`type:'c'`→`'call'`,
  strikes as numbers)
- `expirations` unsorted + dupes → sorted deduped list; range fields absent
  from output (override)
- inverted range **with** `expirations` present → `ok:false
  expirationGte must be <= expirationLte` (the pass-1 regression — locked)
- inverted range alone → same 400
- `type:'X'` → 400; `type:'Put'` → `{type:'put'}`
- `strikeStep:'0'` → 400; `strikeGte:{object}` → 400;
  `firstObservedLte:'not-a-date'` → 400

### S3 — Shared type contract resolution — PASS

- `npm run copy-shared` builds `shared/` clean; `@shared/options` exports
  `ContractAvailabilityFilters`, `ContractAvailabilityResponse`,
  `ContractAvailabilityErrorResponse` (alias of
  `ContractCatalogErrorResponse`), `CONTRACT_AVAILABILITY_MAX_CONTRACTS`.
- `cd functions && npx tsc --noEmit` — clean (the whole src tree resolves
  the new types; the earlier `TS2305` was stale `lib/shared`, fixed by
  rebuild).

### S4 — Regression: neighboring parser surfaces — PASS

`cd functions && npx jest tests/v2/partner/` → **11 suites / 136 tests**
green, including the new V2 `type`-boundary tests (`type=c`→200 `'call'`,
`type=call`/`put`→400) locking `parseOptionType(value, false)`. The shared
`parseOptionType` refactor changed `partner-contract-catalog-partner.ts`;
its full suite confirms zero drift. Full suite at code review: **96
suites / 1014 tests** green.

### S5 — Negative/empty/boundary spot-checks — PASS

- `expirations=','` (all-empty elements) → 400 (jest)
- `expirations` + malformed range → 400 (rejects even though overridden —
  strict-by-design)
- `?type=` / `?expirationGte=` (empty strings) → treated absent
  (documented divergence from V2's 400 — accepted in review)
- repeated/array params → first element used (`toFirstString` convention)

## Acceptance-criteria traceability

| Issue #243 AC | Scenario | Result |
|---|---|---|
| `ContractAvailabilityResponse` (7 fields) + `ContractAvailabilityErrorResponse` matching V2 shape | S3 (tsc + barrel) | PASS |
| `parseOptionalDateList`: trim, validate `YYYY-MM-DD`, dedupe | S1 + S2 | PASS |
| Rejects inverted ranges, `strikeStep<=0`, malformed dates, invalid `type` | S1 + S2 + S5 | PASS |
| `type` accepts `C|P|call|put` case-insensitive → `call|put` | S1 + S2 | PASS |
| Unit tests pass (`cd functions; npx jest`) | S1 + S4 | PASS |

| QA #247 checklist | Scenario | Result |
|---|---|---|
| Types exported + match PRD contract | S3 | PASS |
| Rejects incl. with `expirations` present | S1 + S2 | PASS |
| `type` normalization | S1 + S2 | PASS |
| `expirations` trims/validates/dedupes/sorts + overrides | S1 + S2 | PASS |

## Refinement pass

Not applicable — no user-facing surface (shared types + pure parser).

## Findings

None unresolved. Accepted-minor dispositions from the review (recorded in
the code review doc): empty-string params treated absent, array params
take first element, `expirations` unbounded at parse time (service-side
chunking is #244's concern), `type` vocabulary wider than V2's (`call|put`
words accepted — flag for the partner As-Built doc).

## Verdict: QA PASS
