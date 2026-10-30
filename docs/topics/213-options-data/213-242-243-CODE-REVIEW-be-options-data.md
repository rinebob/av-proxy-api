**Topic:** Options Corpus Bulk Ingest  
**Topic Slug:** options-corpus-bulk-ingest  
**Thread:** Contract Availability Endpoint  
**Thread Slug:** availability-endpoint  
**Issue:** #242  
**Thread Parent:** #237  
**Topic Parent:** #213  
**Task:** #243  
**Domain:** BE  
**Type:** CODE-REVIEW  
**Status:** Complete  
**Created:** 2026-10-30  
**Last Updated:** 2026-10-30

# Code Review — Task #243: Shared types + request-param parser

Scope: `shared/options/contract-availability.types.ts` (new),
`shared/options/index.ts`, `functions/src/v2/partner/partner-request.utils.ts`
(+`parseOptionalDateList`, +`parseOptionType`),
`functions/src/v2/partner/contract-availability-request.utils.ts` (new),
`functions/src/v2/partner/partner-contract-catalog-partner.ts`
(`parseOptionalType` deduped onto `parseOptionType`),
`functions/tests/v2/partner/contract-availability-request.utils.test.ts` (new).

## Standards — PASS (after fixes)

**Found and fixed:**

- Duplicated canonical error type — `ContractAvailabilityErrorResponse`
  copied `ContractCatalogErrorResponse` field-for-field → now a type alias
  (`contract-availability.types.ts`).
- Duplicated option-type parser — second `C|P→call|put` parser → canonical
  `parseOptionType(value, acceptWords)` added to `partner-request.utils.ts`;
  V2's `parseOptionalType` now delegates with `acceptWords: false`
  (preserves its documented letters-only contract); the availability parser
  uses `acceptWords: true` per its PRD vocabulary (`C|P|call|put`).
- O(n²) `dates.includes` dedupe in `parseOptionalDateList` → `Set`.
- Anonymous `'call' | 'put'` union in `ContractAvailabilityFilters` → reuses
  `PickOptionType`.
- Duplicated error literals → `EXPIRATIONS_ERROR` constant.

**Accepted judgement calls:**

- `rawScalar` overlaps `toFirstString` but exists for the tri-state
  (absent / provided-but-unusable / value) semantics the override ordering
  requires — kept private to the parser.
- `parseOptionalDateList` unit tests live in the availability test file
  rather than a nonexistent `partner-request.utils.test.ts`.

## Spec — PASS (after fixes)

All five acceptance criteria met. **Found and fixed:**

- **Inverted range silently accepted under `expirations`** — the override
  `delete`d `expirationGte/Lte` before the inversion check ran, so
  `expirationGte=2026-08-01&expirationLte=2026-05-01&expirations=…` returned
  `ok: true`. Fixed: the explicit list is now applied only after all
  provided params pass validation; regression test added.
- Untested edges added: `expirations` + inverted range (400),
  `strikeStep='abc'` (400), negative `strikeGte` (400), `expirations=','`
  (400), object-valued params (400).

**Accepted:**

- Empty-string params (`?type=`) treated as absent rather than V2's 400 —
  deliberate divergence, documented.
- Repeated/array query params take the first element — matches the
  existing `toFirstString` convention.
- `parseOptionalDateList` sorts ascending (canonical order beyond the
  AC's trim/validate/dedupe) — justified, deterministic for downstream
  `in`-chunking.

## Thermo-nuclear — PASS (after fixes)

Structural skeleton verified right: layering canonical, file sizes healthy
(63/84/135/152 lines), tests behavior-driven (no `as any`, no `setTimeout`,
no assert-free tests).

**Found and fixed:** the MAJOR `expirations` ordering finding (same as
Spec above) — override now applies after full validation instead of
validate-then-delete.

**Accepted (minor/nit):**

- `string | {error}` plumbing via `isError` — small, readable, kept.
- Two similar param loops — a spec table would trade clarity for
  brevity; kept.
- `expirations` list is unbounded at parse time — chunking is a #244
  service concern; a parser cap can be added if prod shows abuse.
- `type` vocabulary asymmetry vs V2 (`call|put` words accepted) — PRD
  sanctioned; call out in the partner As-Built doc.

## Test results

- `cd functions && npx jest` — **96 suites / 1014 tests, all green**
  (includes the refactored `partnerContractCatalogV2` suite and the new
  15-test availability parser suite).
- `cd functions && npx tsc --noEmit` — clean.

## Verdict

**PASS** — all critical/major findings fixed and regression-tested; minors
accepted with reasons recorded above.

## Pass 2 (re-review after fixes)

All three axes re-ran on the post-fix code. Standards: **clean** — all five
pass-1 fixes verified real, no hard violations. Spec: **clean** — major bug
confirmed fixed by control-flow trace + regression test; all five ACs met;
zero #244–#246 scope creep. Thermo-nuclear: **clean** — fix verified, V2
delegation checked for drift. Pass-2 minors addressed: redundant
`raw === ''` branches collapsed to one error path; V2 `type` flag boundary
now tested (`type=c → 200 call` / `type=call → 400`) in
`partner-contract-catalog-partner.test.ts`. Remaining nits (thin V2
wrapper, trailing-comma leniency in `expirations`, asymmetric
object-param coverage) accepted — no further passes needed.
