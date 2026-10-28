**Topic:** Options Corpus Bulk Ingest  
**Topic Slug:** options-data  
**Thread:** Full-Date Corpus Backfill (2026)  
**Thread Slug:** full-date-backfill-2026  
**Issue:** #233  
**Thread Parent:** #214  
**Topic Parent:** #213  
**Task:** #221  
**Domain:** BE  
**Type:** UAT  
**Status:** Complete  
**Created:** 2026-10-27  
**Last Updated:** 2026-10-28  

# UAT — Task #221: Picker core (pickCellsForDate)

## Scope

Pure picker core: `pickCellsForDate(chain, underlyingClose, date, symbol,
grid?) → Map<cellId, DayPickEntry>` plus `noChainPickEntries` for the
caller-emitted absent-chain case. ACs under test: one chain load → 380
cell entries; nearest-DTE expiration then argmin signed delta; actual
`dte` recorded; `no_match`/`no_chain` semantics; deterministic tie-breaks;
no fabricated fields.

## Prerequisites

- Repo checkout, `functions/node_modules` installed.
- For scenario 4 (prod verify): ADC with read access to
  `av-hist-options-corpus-bucket` (`gcloud auth application-default login`,
  project `alpha-vantage-proxy-api`).
- Node IPv4 preload if the gateway IPv6 issue applies:
  `NODE_OPTIONS="--require C:\Users\bob\.config\node\ipv4-only.cjs"`.

## Scenarios

### S1 — Unit suite (selection semantics)

- **Steps:** `cd functions && npx jest tests/v2/historical-options-corpus/options-delta-picker.service.test.ts`
- **Expected:** 21 tests pass — covers 380-cell output, put/call signed
  deltas, nearest-DTE expiry, actual `dte`, both tie-breaks, `no_match`
  variants, eligibility, field omission, malformed-date throw, hyphenated
  symbols, custom grid, aliasing.
- **Result:** PASS — 21/21 green (run 2026-10-27).

### S2 — No regression elsewhere

- **Steps:** `cd functions && npm test`
- **Expected:** all suites pass.
- **Result:** PASS — 88/88 suites, 900 tests (run 2026-10-27).

### S3 — Type safety

- **Steps:** `cd functions && npx tsc --noEmit`
- **Expected:** clean.
- **Result:** PASS — 0 errors.

### S4 — Prod-data oracle cross-check

- **Steps:** `cd functions && npx ts-node -r tsconfig-paths/register -P scripts/tsconfig.json scripts/verify/options-data-221-pick-cells.ts`
- **Expected:** `PASS: oracle agrees with picker on all 7980 cells across
  21 days (0 diffs)`; `GOLDEN-DIFF` lines are informational warnings only.
- **Result:** PASS — 0 oracle diffs on 7,980 cells / 21 real GCS chains;
  207 golden field diffs reported (report-only; Task #226 scope).

### S5 — Caller-side no_chain + fail-loud date (manual probe)

- **Steps:**
  ```
  npx ts-node -e "
    const { noChainPickEntries, pickCellsForDate } = require('./src/v2/historical-options-corpus/services/options-delta-picker.service');
    const m = noChainPickEntries('QQQ', 600);
    console.log(m.size, m.get('QQQ-put-20-45'));
    try { pickCellsForDate([], 600, 'not-a-date', 'QQQ'); } catch (e) { console.log('threw:', e.message); }
  " -r tsconfig-paths/register -P scripts/tsconfig.json
  ```
- **Expected:** 380 entries; `QQQ-put-20-45` = `{status:'no_chain',
  underlyingClose:600}`; malformed date throws.
- **Result:** PASS — see execution log below.

## Traceability

| AC | Scenario |
|---|---|
| One chain load → 380 cells | S1, S4 |
| Nearest-DTE + argmin signed delta | S1, S4 |
| `dte` = actual | S1, S4 |
| `no_match` / `no_chain` semantics | S1, S5 |
| Deterministic tie-breaks | S1, S4 |
| Fixture unit tests | S1 |
| TEST edge cases (missing close, calls-only, ties) | S1 |

## Regression / smoke

- `options-delta-picks.types.ts` widenings (optional fields) — shared
  suite `tests/shared/options/options-delta-picks.test.ts` green; all
  downstream consumers still typecheck (S2, S3).

## Execution log

```
S1: Test Suites: 1 passed, Tests: 21 passed, 21 total
S2: Test Suites: 88 passed, Tests: 900 passed
S3: tsc --noEmit → exit 0
S4: oracle agrees on all 7980 cells / 21 days (0 diffs); GOLDEN report-only
S5: size: 380 | put-20-45: {"status":"no_chain","underlyingClose":600}
    no-close: {"status":"no_chain"}
    threw: pickCellsForDate: malformed date: not-a-date
```

## Findings

- None blocking. Golden-asset field diffs (207) are report-only — the
  asset predates corpus self-repair; field-level reconciliation is Task
  #226's explicit scope.
