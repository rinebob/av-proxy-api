**Topic:** Add Company Overview Data to Symbol Manager  
**Topic Slug:** symbol-manager-company-overview  
**Thread:** Add Company Overview Data to Symbol Manager  
**Thread Slug:** add-company-overview  
**Issue:** #95 (BE Blueprint)  
**Task:** #97  
**Topic Parent:** #88  
**Domain:** SYMBOL-MANAGER  
**Type:** CODE-REVIEW  
**Status:** Approved  
**Created:** 2026-09-20  
**Last Updated:** 2026-09-20  

# Code Review — Task #97: companyInfo numeric marketCap/beta write-back

## Scope reviewed

- `shared/alpha-vantage/av-company-overview.ts` — `TrackedSymbolCompanyInfo` + `marketCap?`/`beta?`
- `functions/src/v2/alpha-vantage/logic/company-info.builder.ts` — **new** pure builder module
- `functions/src/v2/alpha-vantage/handlers/av-company-overview.handler.ts` — write-back calls builder
- `functions/tests/v2/alpha-vantage/logic/company-info.builder.test.ts` — new, 10 tests
- `functions/scripts/verify/symbol-manager-97-companyinfo-writeback.{ts,md}` — prod verification
- `functions/scripts/verify/README.md`, `run-all.ts` — index entries

## Round 2 (final state)

Re-review after round-1 remediation plus one new finding:

### Thermo-nuclear (new finding, remediated)

- ~~`set(merge)` deep-merges `companyInfo` — fields AV stops returning would persist stale forever~~ → write-back switched to `update()`, replacing the map wholesale (snapshot semantics). Also fails safely when the tracked-symbol doc is missing instead of creating a stray doc. Invariant documented on `TrackedSymbolCompanyInfo`.
- `parseAvNumeric` tightened to `string | null | undefined` (was over-general `unknown`).
- Test renamed to `logic/company-info.builder.test.ts` to match what it actually tests.
- Added completeness test asserting the builder emits every `TrackedSymbolCompanyInfo` field.

### Standards

All round-1 violations verified gone. Remaining items are pre-existing debt, not introduced by this task (dead `string[]` branch in handler `fieldMappings`, `TRACKED_SYMBOL_V2_FIELDS` living in `av-symbol-search.ts`, unused `CompanyOverviewResponse` type).

### Spec

All 5 acceptance criteria met. Sole partial: no Jest test of `fetch()`'s write-back itself — covered by the prod verify script (real update() + read-back type assertions), per project convention.

## Round 1 findings (all remediated)

- Tautological `|| true` assert → real doc-root Timestamp assertion
- Hardcoded field-name literals in verify script → shared constants
- `as any`/`as unknown as` fixtures → `Partial<AvCompanyOverview>` signature
- Firebase-init side effect in test import chain → builder extracted to pure `logic/` module
- Redundant `data as AvCompanyOverview` cast → removed

## Test results

- New suite: 10/10 green.
- `tsc --noEmit` (tests project): clean.
- Prod verification: 11/11 checks pass (NVDA write-back via `update()`, read-back confirms Firestore numbers + doc-root Timestamp).
- Full suite: 450/456 — 6 failures in `contract-summary-aggregator.service.test.ts` are pre-existing (module resolution, verified failing without this change).

## Verdict

**PASS**
