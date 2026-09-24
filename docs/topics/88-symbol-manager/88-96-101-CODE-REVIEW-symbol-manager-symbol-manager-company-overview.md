**Topic:** Add Company Overview Data to Symbol Manager  
**Topic Slug:** symbol-manager-company-overview  
**Thread:** Add Company Overview Data to Symbol Manager  
**Thread Slug:** add-company-overview  
**Issue:** #96 (FE Blueprint)  
**Task:** #101  
**Topic Parent:** #88  
**Domain:** SYMBOL-MANAGER  
**Type:** CODE-REVIEW  
**Status:** Approved  
**Created:** 2026-09-24  
**Last Updated:** 2026-09-24  

# Code Review — Task #101: client-side sort + fetch-cap + optionable columns + probe

## Scope reviewed

- `src/app/feat/symbol-manager-view/utils/symbol-sort.{ts,spec.ts}` — comparator + multi-level sort
- `src/app/feat/symbol-manager-view/components/symbol-manager/symbol-manager.component.{ts,html,scss,spec.ts}` — sort stack, indicators, pageSize 100, scroll-to-top, Optionable/Options Enabled columns
- `src/app/feat/symbol-manager-view/store/symbol-manager.store.ts` — `v2Total`
- `shared/alpha-vantage/av-symbol-search.ts` — `optionable`/`optionsEnabled`/`optionableCheckedAt`/`optionableProbeSummary`/`optionsEnabledHistory` + `TRACKED_SYMBOL_V2_FIELDS` entries
- `functions/scripts/backfill/backfill-optionable.ts` — AV probe backfill

## Findings and remediation

### Remediated during review

- **Spec field-name fork**: `optionsSummary` → **`optionableProbeSummary`** per Thread #105 PRD §75/§80; added `expirations` count (was missing). Prod docs re-probed + stale field deleted.
- **`optionsEnabled` default missing**: §76 requires every tracked symbol default `optionsEnabled=false` — script now patches `optionsEnabled`/`optionsEnabledHistory` on docs lacking them (verified: AAPL `optionsEnabled:false, history:[]`).
- **Quota abort gap**: AV returns `Information` (→ `UPSTREAM_ERROR`) for premium-gating/quota notes — script only aborted on `RATE_LIMITED` and would burn quota. Now aborts on quota-ish `Information` messages too.
- **Error path skipped throttle**: sleep moved outside try — consecutive errors no longer hammer AV.
- **Store drift**: duplicated inline `listSymbolsV2` refresh → `this.listSymbolsV2()` (matches `this.listSymbols()` precedent).
- **A11y regression**: custom headers lost `mat-sort-header`'s `aria-sort` — restored via `[attr.aria-sort]` on all 11 headers + comment explaining the custom-header deviation (Mat sorts single-column only).
- **Misc**: dead `SortableField` type removed; `resetToFirstPage()` extracted; `--delay 0` parse fix; lazy service construction (skip-only runs need no API key).

### Verified clean

- All 6 task ACs: sort-before-slice (page 2 continues ranking), missing-last both directions, filter/search composition, zero network on sort, fetch-cap banner, unit + component tests.
- Multi-level semantics: first click = primary, append secondary levels, asc→desc→remove cycle, `▲1`/`▲2` indicators, `symbol` final tiebreak — standard multi-sort UX.
- `instanceof AlphaVantageUpstreamError` across `require()` boundary — single module instance under ts-node, ES2020 class.
- `update()` exists-gated; finite-only summary fields; no NaN/undefined writes.

### Accepted (documented, non-blocking)

- `INFORMATION`-vs-`RATE_LIMITED` classification — ambiguous AV responses (e.g. `{}` for delisted symbols) count as errors, not `optionable=false` — deliberate (don't stamp false on ambiguous data).
- Middle-level removal renumbers sort ordinals (▲1▲3→▲1▲2) — self-consistent.
- `paginator.firstPage()` inside sort also triggers scroll-to-top — acceptable UX.
- Options Enabled checkbox is disabled/unwired per user direction — Thread #105 owns the toggle + downstream trigger.
- Probe needs `shared/lib` built (scripts tsconfig maps `@shared` there) — documented pattern.
- `_isActive` accessor retained for sort completeness though column removed — harmless.

## Test results

- 26/26 FE specs (format + sort + component pipeline).
- `ng build` clean; `tsc --noEmit` clean on functions.
- Probe verified on prod: AAPL/QQQ/SPY → `optionable=true` (3600/10608/12206 contracts), `optionableProbeSummary` incl. `expirations`, defaults patched; re-run skips with 0 API calls.

## Verdict

**PASS**
