**Topic:** Options Corpus Bulk Ingest  
**Topic Slug:** options-data  
**Thread:** Full-Date Corpus Backfill (2026)  
**Thread Slug:** corpus-backfill-2026  
**Issue:** #262  
**Thread Parent:** #214  
**Topic Parent:** #213  
**Task:** #226  
**Domain:** BE  
**Type:** UAT  
**Status:** Complete  
**Created:** 2026-11-01  
**Last Updated:** 2026-11-01  

# UAT — Golden-file pick verification

## Scope

Task #226 (Golden-file pick verification) delivers the permanent
verification gate for the options-delta-picks materialization pipeline:
`functions/scripts/verify/options-data-226-golden-picks.ts` regenerates
the `QQQ-put-20-45` April-2026 window through the production path (real
GCS corpus + real adjusted closes + real writer on an in-memory
Firestore) and asserts strict day-for-day equality against the golden
asset `src/assets/data/options-delta-picks-QQQ-put-0.20-45-apr2026.example.json`
— which was regenerated during this task after the original fixture was
proven not to be pipeline output. The golden carries a `provenance`
block; `--write-asset` re-blesses baselines under three guards.

## Prerequisites

- Windows/PowerShell, repo at `C:\aa\projects\av-proxy-api`, `functions/`
  deps installed.
- ADC with read access to the corpus bucket and `symbol-data` bars
  (`gcloud auth application-default login`, project
  `alpha-vantage-proxy-api`).
- IPv6-broken networks (this dev machine): set
  `$env:NODE_OPTIONS="--require C:\Users\bob\.config\node\ipv4-only.cjs"`
  or transient `oauth2.googleapis.com/token` failures surface as
  `loadFailures` — re-run.

## Start

```powershell
cd functions
$env:NODE_OPTIONS="--require C:\Users\bob\.config\node\ipv4-only.cjs"
```

## Scenarios

### S1 — Normal verification run passes (AC1, AC2, AC4)

- **Confirm:** the gate holds against prod data.
- **Run:** `npx ts-node -r tsconfig-paths/register -P scripts/tsconfig.json scripts/verify/options-data-226-golden-picks.ts`
- **Expected:** exit 0; output contains
  `PASS: regenerated doc matches the golden day-for-day`,
  `INPUTS: 0 of 21 recorded corpus fingerprints drifted`,
  `LIVE-DOC: 0 missing days, 0 field diffs vs regenerated`,
  `RECONCILED: 21/21 days identical to golden`;
  `GOLDEN-ROLLS` and `REGEN-ROLLS` lines are identical (17 rolls).
- **Result:** ___

### S2 — Golden asset carries provenance (AC3 — data corrected)

- **Confirm:** `src/assets/data/options-delta-picks-QQQ-put-0.20-45-apr2026.example.json`
  is self-describing.
- **Check:** top-level `provenance` object with `generatedBy`,
  `generatedAt`, `pipeline`, `corpusBucket`, `adjustedCloseSource`, and
  `corpusInputs` — 21 dated entries each with `object` path
  (`historical-options/v1/QQQ/{date}.json.gz`), `generatedAt`
  (2026-07-22T08:1x), `sha256`.
- **Expected:** all present; `pickCount: 21`, `missCount: 0`, 21 `days`.
- **Result:** ___

### S3 — `--write-asset` guard rails (code-path verification)

- **Confirm:** the three bless guards exist and execute before any write.
- **Check** `functions/scripts/verify/options-data-226-golden-picks.ts`:
  1. `inputs.size === dates.length` assert before writing (degenerate
     baseline refused);
  2. per-day oracle loop: `assert(entry !== undefined)` then every blessed
     pick equals `specWinner(...)`'s contract and every blessed miss has
     `winner === null`;
  3. defect refusal: `reconcileDay(...).explained` filter over all dates —
     `regression`/`unexplained` blocks the write.
- **Also confirm:** `writeFileSync` is the last statement — all asserts
  precede it, so no half-written asset is possible.
- **Result:** ___

### S4 — Classifier + drift-guard tests green (AC3)

- **Confirm:** the pure core is tested, including the oracle-vs-production
  agreement test.
- **Run:** `npx jest tests/scripts-verify/options-data-226-golden-picks.core.test.ts --runInBand`
- **Expected:** 28 tests pass, including `oracle vs production
  pickCellsForDate — drift guard` ×6 and the three `specWinner` tie-break
  tests.
- **Result:** ___

### S5 — Doc consistency (AC3 — docs updated)

- **Confirm:** SPEC/TEST docs reflect the regenerated baseline.
- **Check:** `213-215-SPEC-...md` example shows
  `QQQ260515P00541000`/delta `-0.20074`/`underlyingClose 583.6665865823986`;
  miss example marked illustrative; roll narrative says "May-29 expiry to
  Jun-05 on Apr 23"; provenance parenthetical present.
  `213-214-216-TEST-...full-date-backfill-2026.md` J1 references the
  regenerated, provenance-stamped baseline.
- **Result:** ___

### S6 — Registration (AC4)

- **Confirm:** the script is discoverable.
- **Check:** `functions/scripts/verify/README.md` table row + execution-order
  entry for #226 mention strict equality + `--write-asset`;
  `run-all.ts` lists `options-data-226-golden-picks.ts` in the active list.
- **Result:** ___

### S7 — Negative: tamper detection (boundary/recovery)

- **Confirm:** the gate actually fails on a mismatch (not a vacuous PASS).
- **Method (non-destructive):** copy the asset to
  `.devin/tmp/golden-backup.json`, change one `days."2026-04-01".mark`
  value, re-run S1 → expect `DIFF` lines, a non-`identical` category, exit
  1. Restore the file from backup.
- **Expected:** exit 1 with classification output; restore verified.
- **Result:** ___

## Traceability

| Criterion | Scenario |
|---|---|
| AC1 day-for-day match (all fields incl. close) | S1, S7 |
| AC2 contract rolls reproduced | S1 (`GOLDEN-ROLLS`/`REGEN-ROLLS`) |
| AC3 root-cause + data corrected + docs updated | S2, S3, S4, S5 |
| AC4 script under `scripts/verify/` per convention | S1, S6 |

## Regression / smoke

- [ ] `npx jest` full suite green (no adjacent test breakage)
- [ ] `npx tsc --noEmit` clean
- [ ] Sibling verify script `options-data-221-pick-cells.ts` untouched by
  this change (golden regeneration changes its report-only diff to 0 — no
  code dependency)

## QA result log — 2026-11-01 (all executed by Devin, live vs prod)

- **S1 — PASS.** Exit 0. `PASS: regenerated doc matches the golden
  day-for-day`; `INPUTS: 0 of 21 recorded corpus fingerprints drifted`;
  `LIVE-DOC: 0 missing days, 0 field diffs`; `RECONCILED: 21/21 days
  identical`; `GOLDEN-ROLLS`/`REGEN-ROLLS` identical (17 rolls).
- **S2 — PASS.** `pickCount: 21`, `missCount: 0`, 21 `days`; `provenance`
  with `generatedBy`/`generatedAt`/`pipeline`/`corpusBucket`/
  `adjustedCloseSource`/`corpusInputs`; 21 dated inputs each with object
  path, `generatedAt: 2026-07-22T08:1x`, sha256 (e.g. 04-01 `ba954485a3c9`).
- **S3 — PASS (code inspection).** Guards at runner lines 189
  (`inputs.size === dates.length`), 199–200 (`entry !== undefined` +
  `specWinner` oracle check), 221 (defect refusal via
  `reconcileDay().explained`); `writeFileSync` is the last write-path
  statement (line 245) — no partial write possible.
- **S4 — PASS.** 28/28 tests green incl. 6 `pickCellsForDate`-vs-`specWinner`
  drift-guard cases and 3 tie-break tests.
- **S5 — PASS.** SPEC example = real values (`QQQ260515P00541000`,
  −0.20074, 583.67); miss marked illustrative; roll says May-29→Jun-05;
  provenance parenthetical present; TEST J1 references regenerated
  baseline.
- **S6 — PASS.** README table row + execution-order entry;
  `run-all.ts:25` registers the script.
- **S7 — PASS.** `mark` 7.25→7.99 tamper → script exit **1** (DIFF +
  non-identical classification); file restored from backup (verified
  `7.25` present).

**Regression:** full suite 106 suites / 1,222 tests green; `tsc --noEmit`
clean; `options-data-221-pick-cells.ts` unmodified.

**Result: QA PASS**
