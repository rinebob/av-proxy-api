**Topic:** Options Corpus Bulk Ingest  
**Topic Slug:** options-corpus-bulk-ingest  
**Thread:** Full-Date Corpus Backfill (2026)  
**Thread Slug:** full-date-backfill-2026  
**Issue:** #218  
**Task:** #219  
**Thread Parent:** #214  
**Topic Parent:** #213  
**Domain:** OPTIONS-DATA  
**Type:** CODE-REVIEW  
**Status:** Complete  
**Created:** 2026-10-26  
**Last Updated:** 2026-10-26  

# Code Review — Task #219: Grid config + pick types

## Scope

| File | Purpose |
|---|---|
| `shared/options/options-delta-picks.types.ts` | Storage/wire contract: `DayPick`, `DayMiss`, `DayPickEntry`, `CellYearDoc`, path constants, `PICK_GRID_VERSION` |
| `shared/options/options-delta-picks.utils.ts` | `PICK_GRID` (19 delta pcts × 10 DTEs × put/call = 380), `buildCellId`/`parseCellId` codec, `cellYearDocPath`, entry guards, `isRepairableEntry` |
| `shared/options/index.ts` | Barrel exports for both new modules |
| `functions/tests/shared/options/options-delta-picks.test.ts` | 19 jest tests |
| `functions/scripts/verify/options-data-219-pick-grid-types.ts` / `.md` | Read-only prod verify script + guide |
| `functions/scripts/verify/README.md`, `run-all.ts` | Index row + execution-order entry + registration |

## Axes

### Standards

- Placement mirrors the `symbol-metrics` precedent: wire contract in `.types.ts`, codec/grid in `.utils.ts`, barrel export — the canonical shared-options seam.
- Verify script matches the #168 peer pattern (admin init `{projectId:'alpha-vantage-proxy-api'}`, `FirestoreCollection.TRACKED_SYMBOLS`, `TRACKED_SYMBOL_V2_FIELDS.OPTIONS_ENABLED`).
- No hard violations. Judgement calls found in review and fixed pre-gate: deep-path imports switched to the `@shared/options` barrel; `tracked_symbols`→`tracked-symbols` prose typo corrected in script comment, log line, and guide; ADC prerequisite added to the guide; README SHARED-area note amended to flag this script's single read-only prod query; `cellDocsPerYear` loop accumulator replaced by the direct product.

### Spec

All acceptance criteria accounted for against `213-215-SPEC-options-delta-picks-consumer-contract.md`:

- PICK_GRID = 380 cells (19 delta magnitudes × 10 DTEs × put/call): **MET**, verified against prod data.
- cellId encode/decode round-trips; malformed ids rejected: **MET** after fix — see findings.
- `DayPick`/`DayMiss`/`CellYearDoc` match every SPEC schema field, including signed `targetDelta`, `expiry:{mode:'nearestDte',dte}`, `gridVersion`, header counts, `days` map: **MET** — schema diffed field-by-field against the SPEC and the `QQQ-put-0.20-45` reference asset.
- Unit tests pass: **MET** (19/19).
- `isRepairableEntry` (née `isRepairableStatus`) slightly precedes its consumer — the IMPL assigns self-repair semantics to the cell writer (#222). Borderline scope note, kept because the repairable-status set is wire-contract knowledge the writer will import; it does not implement writer logic.

### Thermo-nuclear

Initial pass produced one structural finding, remediated before this verdict:

1. **Codec fragility (was the blocker):** `parseCellId` split on `-` and required exactly 4 segments, so `BRK-B-put-20-45` (real AV-normalized tickers `BRK-B`, `BF-B` exist in the tracked universe) returned null — writers in #221–#226 would have minted unparsable doc ids silently. Verified: no hyphenated symbol is `optionsEnabled` *today* (0 of 130 in prod), but the contract must not depend on universe composition. **Fixed:** parser now right-parses — last three segments are `{type}-{deltaPct}-{dte}`, the remainder is the symbol — so `BRK-B-put-20-45` round-trips. Tests added for `BRK-B`/`BF-B`.
2. **Numeric laxness (fixed):** `Number()` coercion accepted `1e2`, `0x14`, ` 20`. Now gated on `/^\d+$/` before coercion; tests added.
3. **Asymmetric normalization (fixed):** `buildCellId` uppercased but `parseCellId` didn't; parse now uppercases `symbol`, restoring `build(parse(id))` symmetry. Tests added.
4. **`buildCellId` minted unparsable ids (fixed):** `(…, 0.2, 45)` or `(…, 20, 0)` produced ids its own parser rejects; now throws on non-positive/non-integer components. Tests added.
5. **`isRepairableStatus` tautology (fixed):** enumerated every union member = `status != null`. Reshaped to `isRepairableEntry(entry): entry is DayMiss` over an explicit `REPAIRABLE_MISS_STATUSES` set — one call for the writer, and the set is where future non-repairable statuses get excluded. Test added.
6. **Test gap (fixed):** no `CellYearDoc` construction; added a JSON round-trip test matching the peer `symbol-metrics` convention.

**Deliberately not changed (recorded, non-blocking):**

- `PickOptionType` is a fourth spelling of `'call'|'put'` in the codebase (`contract-types.ts`, `contract-catalog.types.ts`, `contract-metadata.utils.ts`). Converging all sites to a canonical `OptionType` is cross-cutting refactor outside this task's scope; flagged as known debt for a future cleanup pass.
- `CellYearDoc` omits a `year` field that sibling `SymbolMetricsYearDoc` carries — year lives in the doc id per the SPEC schema; adding an unspecified field would diverge from the wire contract.
- `PICK_GRID_VERSION === 1` test is a literal-echo by design — a tripwire against bumping a wire constant without a migration plan; the verify script asserts the same.

## Findings

| Severity | Finding | Disposition |
|---|---|---|
| Major | `parseCellId` rejected hyphenated symbols (`BRK-B-put-20-45` → null) | Fixed — right-parse; tests added |
| Major | `Number()` coercion accepted `1e2`/`0x14`/` 20` | Fixed — `/^\d+$/` gate; tests added |
| Minor | parse/build uppercase asymmetry | Fixed |
| Minor | `buildCellId` could mint ids its parser rejects | Fixed — input validation throws |
| Minor | `isRepairableStatus` tautological | Reshaped to `isRepairableEntry` + status set |
| Nit | Missing `CellYearDoc` construction/serialization test | Fixed |
| Nit | Guide lacked ADC prerequisite; `tracked_symbols` typo; deep-path imports | Fixed |
| Nit | `PickOptionType` duplicates `'call'|'put'` unions | Deferred — cross-cutting, noted for cleanup |
| Nit | No `year` field on `CellYearDoc` (sibling precedent) | Deferred — SPEC schema is authoritative |

## Test results

- Focused suite: **19/19 pass**
- Full suite: **866 tests, 86 suites — all pass**
- `tsc --noEmit`: clean
- Verify script against prod: **all checks pass** — 130 `optionsEnabled` symbols, 49,400 cellIds round-tripped, valid even-segment doc path
- `functions/lib/shared` resynced via `npm run copy-shared` after the codec changes

## Second pass (post-remediation re-check)

Fresh-eyes pass over the post-fix codec, guards, and tests — hunting only for issues the first pass and its remediation introduced or missed.

| Severity | Finding | Disposition |
|---|---|---|
| Minor | Unsafe-integer hole: `parseCellId` accepted `99999999999999999999` (→ 1e20); `buildCellId(…, 1e21, …)` emitted `'1e+21'` its own parser rejects | Fixed — `Number.isSafeInteger` gate on both sides; tests added |
| Minor | `isRepairableEntry` returned true for corrupt pick+miss hybrids (`{contractId, status}`) — writer could overwrite a real pick | Fixed — `!isPickEntry` guard added; test added |
| Nit | Symbol charset unvalidated (`'-'`, `'Q QQ'` minted parseable garbage) | Fixed — `/^[A-Z0-9]+(-[A-Z0-9]+)*$/i` gate on `buildCellId` (keeps `BRK-B`) |
| Nit | `'QQQ-put--20-45'` comment misattributed the rejection reason | Fixed — comment corrected |
| Nit | `updatedAt` JSON round-trip models `{seconds,nanoseconds}`, not the admin `Timestamp` wire form (`_seconds`) | Recorded — matches `symbol-metrics` precedent; harmless for a storage-shape test |

**No further findings.** The remaining surface (~130 lines of pure functions) now has branch-exhaustive test coverage — 20 focused tests including hyphenated symbols, non-decimal numerics, unsafe integers, builder/parser symmetry, corrupt hybrids, and the full `CellYearDoc` wire shape.

## Test results (final, post-remediation)

- Focused suite: **20/20 pass**
- Full suite: **867 tests, 86 suites — all pass**
- `tsc --noEmit` (src + tests): clean
- Verify script against prod (hardened codec): **all checks pass** — 130 symbols, 49,400 cellIds

## Verdict

**PASS** — all acceptance criteria met; two review passes converged (first pass: codec robustness; second pass: integer-safety and hybrid-guard hardening). Recorded nits/deferred debt: `PickOptionType` union duplication (cross-cutting cleanup), no `year` field on `CellYearDoc` (SPEC authoritative).
