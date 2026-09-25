**Topic:** Swing-driven options corpus platform
**Topic Slug:** swing-driven-options-corpus
**Thread:** Symbol flags curation
**Thread Slug:** symbol-flags-curation
**Blueprint:** #135 (BE Blueprint)
**Task:** #142 (List endpoint flag filtering)
**Thread Parent:** #105
**Topic Parent:** #102
**Domain:** OPTIONS-DATA
**Type:** CODE-REVIEW
**Status:** Approved
**Created:** 2026-09-25
**Last Updated:** 2026-09-25

# Code Review — Task #142: list-endpoint flag filtering

## Scope reviewed

- `shared/alpha-vantage/av-symbol-search.ts` — `ListSymbolsOptions` + `parseSymbolFlagFilterParam`
- `functions/src/v2/alpha-vantage/services/symbol-manager.service.ts` — flag `where()` + `compareTrackedSymbolsByField` in-memory path
- `functions/src/v2/common/functions/listSymbolsV2.ts`, `functions/src/v2/partner/tracked-symbols-partner.ts`
- `functions/tests/shared/alpha-vantage/list-flag-filter.test.ts`, `functions/tests/v2/alpha-vantage/services/symbol-manager-flag-sort.test.ts`
- `functions/scripts/verify/options-data-142-list-flag-filtering.{ts,md}` + README row

## Findings and remediation

### Resolved during review

- **BLOCKER — flag fields stripped from responses (second pass).** `toTrackedSymbolV2` built the response field-by-field and never copied `optionable`/`optionsEnabled` or the probe/audit fields — filtered rows would have returned `optionsEnabled: undefined`, defeating the feature and breaking the verify script's asserts. Mapper now carries all six fields: `optionsEnabled` defaults `false` (#139 semantics); `optionable` + probe/audit fields copy only when present so the un-probed tri-state survives (`optionable=false` still reported as probed-negative). Regression test added.
- **`total` divergence documented.** The flag path counts sort-field-missing docs toward `total` (sorted last); the unfiltered path's `orderBy` excludes them — one-line note added at the branch.
- **BLOCKER — composite-index requirement (first pass).** First-pass design (`where(flag) + orderBy(sortField)`) would throw `FAILED_PRECONDITION` on every filtered request: `firestore.indexes.json` carries `_isActive+sortField` composites only, and covering 2 flags × 12 sortable fields × 2 directions is ~48 entries. **Fix (thermo's judo):** when any flag filter is present the query drops `orderBy`, fetches all matches (equality-only → zigzag merge, no composite needed), then sorts + paginates in memory via `compareTrackedSymbolsByField`. The tracked-symbols set is ~1k docs — cheap. Index explosion deleted rather than managed.
- **Verify script partition assert.** `true+false==total` would spuriously fail while pre-#139 docs still lack `optionsEnabled` (defaults only stamp on next write). Downgraded to WARN.
- **Tri-state semantics documented.** `?optionable=false` doesn't match un-probed docs (Firestore `==false` excludes absent fields) — now stated in the partner endpoint JSDoc.
- **Stable pagination.** Comparator tie-breaks on symbol; docs missing the sort field go last in both directions; Timestamps compare numerically.

- **Nested Timestamp serialization (third pass, low).** `serializeTrackedSymbols` only converted top-level `_createdAt`/`_lastUpdated` — `optionableCheckedAt` and `optionsEnabledHistory[].changedAt` would have serialized as `{_seconds,_nanoseconds}` objects, inconsistent with the ISO strings consumers already get. Serializer now converts both (same shape as pre-existing `_companyInfoLastUpdated` gap, but fixed here since these fields are new).

### Verified clean

- Parser binds only literal `'true'`/`'false'` — absent/malformed/repeated params ignored (consistent with `resolveTrackedSymbolSortField` leniency). Arrays rejected.
- Flag `where()` clauses reach the `count()` path on the non-filtered branch; identical param wiring in both endpoints; helper exported through the `@shared/alpha-vantage` barrel.
- `optionsEnabled==false` correctly excludes enabled docs — the curation UI's core use case.

### Accepted follow-ups

- **Judgement call — lenient-ignore of malformed params.** A typo returns unfiltered data rather than 400; consistent with existing endpoint conventions. If the UI ever wants strict validation, change `parseSymbolFlagFilterParam` — single seam.
- Verify script exercises only the partner endpoint (Firebase-authed `listSymbolsV2` shares the same service code path).
- In-memory path reads the full filtered set — fine at ~1k docs; would need revisiting if tracked-symbols grows an order of magnitude.

## Verification

- Full Functions suite: **645/645 passed** (13 parser + 6 comparator + 5 mapper/serializer tests new)
- `npm run build` + `tsc -p scripts/tsconfig.json` clean; `git diff --check` clean
- Deployed-endpoint verify script written; **runs after deploy** (filters are inert on the current revision)

## Verdict

**PASS** — both blockers resolved: composite-index requirement eliminated via in-memory sort/paginate under flag filters, and flag fields now survive the response mapper. All ACs met on all three axes; `total` semantics divergence between paths documented.
