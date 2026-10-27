**Topic:** Options Corpus Bulk Ingest  
**Topic Slug:** options-corpus-bulk-ingest  
**Thread:** Full-Date Corpus Backfill (2026)  
**Thread Slug:** full-date-backfill-2026  
**Issue:** #231  
**Task:** #219  
**Thread Parent:** #214  
**Topic Parent:** #213  
**Domain:** OPTIONS-DATA  
**Type:** UAT  
**Status:** Complete  
**Created:** 2026-10-26  
**Last Updated:** 2026-10-26  

# UAT — Task #219: Grid config + pick types

## Scope

Shared `options-delta-picks` module: the canonical 380-cell pick grid
(`PICK_GRID`), the `DayPick`/`DayMiss`/`DayPickEntry`/`CellYearDoc` storage and
wire contract matching SPEC `213-215-SPEC-options-delta-picks-consumer-contract.md`,
the `{SYM}-{type}-{deltaPct}-{dte}` cellId codec, `cellYearDocPath`, and the
`isPickEntry`/`isMissEntry`/`isRepairableEntry` day-entry guards that tasks
#221–#226 (picker, writer, materialization, endpoint) will consume.

**No user-facing surface** — this task delivers shared types + a codec;
acceptance is via automated tests and the prod verification script.

## Prerequisites

- Repo: `av-proxy-api`, branch `prod`, from repo root.
- Node deps installed: `cd shared && npm install`, `cd functions && npm install`.
- Shared package compiled into the functions workspace:
  `cd functions && npm run copy-shared` (required after any `shared/` edit —
  jest and the verify scripts resolve `@shared/*` to `functions/lib/shared/`).
- **Scenario 2 only:** Application Default Credentials with read access to prod
  Firestore (`alpha-vantage-proxy-api`). Obtain via
  `gcloud auth application-default login` with the project selected. The query
  is read-only (`tracked-symbols` where `optionsEnabled == true`).
- On this workstation, outbound HTTPS may require the IPv4 workaround:
  prefix commands with
  `NODE_OPTIONS="--require C:\Users\bob\.config\node\ipv4-only.cjs"`
  if you see `oauth2.googleapis.com` connect errors.

## Scenarios

### 1. Unit tests — grid, codec, guards, doc shape

**Confirms:** all task acceptance criteria at the unit level.

```bash
cd functions && npx jest tests/shared/options/options-delta-picks.test.ts
```

**Expected:** `Tests: 20 passed` covering —

- `PICK_GRID` = 380 cells, delta pcts 5–95 step 5, DTE set
  `{7,14,21,30,45,60,90,120,180,365}`, both types, no duplicates.
- `buildCellId`/`parseCellId` round-trip incl. hyphenated symbols
  (`BRK-B-put-20-45`, `BF-B-call-30-30`); lowercase symbol normalization;
  rejection of malformed ids (bad segment count, non-`put|call` type,
  non-decimal/unsafe-integer numerics, zero/negative values); `buildCellId`
  throwing on inputs its parser would reject.
- `cellYearDocPath` → `options-delta-picks/{cell}/years/{YYYY}` with even
  segment count (valid Firestore doc reference).
- Entry guards: pick by `contractId`, miss by `status`,
  `isRepairableEntry` true only for `no_chain`/`no_match` misses and false
  for picks and corrupt pick+miss hybrids.
- `CellYearDoc` survives JSON round-trip (Firestore-writeable shape).

**Result:** PASS — `Tests: 20 passed, 20 total` (2026-10-26).

### 2. Prod verification script — real enabled-symbol universe

**Confirms:** the codec round-trips across the *real* `optionsEnabled`
universe, not just fixture symbols.

```bash
cd functions && npx ts-node -r tsconfig-paths/register -P scripts/tsconfig.json scripts/verify/options-data-219-pick-grid-types.ts
```

**Expected:** every check prints `PASS:` ending with
`=== All verification checks passed ===`:

- `prod tracked-symbols optionsEnabled universe loaded` (currently 130 symbols)
- `{N*380} cellIds round-tripped losslessly` (currently 49,400)
- `cellYearDocPath: options-delta-picks/QQQ-put-20-45/years/2026`
- `doc path has even segment count (valid doc reference)`

**Negative check:** the script exits 1 on the first failed assertion —
to observe the failure path, a tester may temporarily corrupt nothing;
the `FAIL:` branch is exercised by construction on any assertion failure.

**Result:** PASS — 130 symbols, 49,400 cellIds round-tripped, exit 0
(2026-10-26, run twice incl. once under the IPv4 workaround).

### 3. SPEC conformance — storage/wire contract

**Confirms:** every field the consumer contract defines exists with the
correct name/optionality.

- `DayPick`: `underlyingClose, contractId, expiration, dte, strike, delta,
  iv, mark, bid, ask, volume, openInterest` — no `status` field.
- `DayMiss`: `status: 'no_chain'|'no_match'`, optional `underlyingClose`,
  optional `reason`.
- `CellYearDoc`: `symbol, type, targetDelta` (signed — puts negative),
  `expiry:{mode:'nearestDte',dte}`, `gridVersion`, `firstDate, lastDate,
  pickCount, missCount, days, updatedAt`.
- Cell-id format `{SYM}-{type}-{deltaPct}-{dte}`, `deltaPct` = magnitude×100.

**Steps:** read `shared/options/options-delta-picks.types.ts` alongside
`docs/topics/213-options-data/213-215-SPEC-options-delta-picks-consumer-contract.md`
Document Schema; spot-check a `days` entry against the reference asset
`src/assets/data/options-delta-picks-QQQ-put-0.20-45-apr2026.example.json`.

**Result:** PASS — field-for-field match confirmed in code review (Spec axis)
and by the `CellYearDoc` JSON round-trip test.

### 4. Regression / smoke

**Confirms:** no collateral damage elsewhere.

```bash
cd functions && npx jest --silent && npx tsc --noEmit -p tsconfig.json
```

**Expected:** all suites pass; tsc emits nothing.

**Result:** PASS — 867 tests / 86 suites, `tsc` clean (2026-10-26).

## Traceability

| Acceptance criterion | Scenario |
|---|---|
| PICK_GRID = 380 cells (19×10×2), no dups | 1, 2 |
| cellId round-trips; invalid components rejected | 1, 2 |
| DayPick/CellYearDoc match SPEC fields | 1, 3 |
| Unit tests pass | 1, 4 |
| Prod verify script (real universe, README + run-all registered, guide written) | 2 |

## Findings

- Deferred (recorded in code review + QA issue): `PickOptionType` is a 4th
  `'call'|'put'` spelling in the codebase — converge later.
- Deferred: `CellYearDoc` carries no explicit `year` field — year lives in the
  doc id per SPEC.
