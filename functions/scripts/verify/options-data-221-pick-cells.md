# Task #221 verify guide — picker core (pickCellsForDate)

## Script: `options-data-221-pick-cells.ts` (read-only)

Cross-checks the pure picker against the **real** prod GCS corpus chains for
every day in the golden asset window (QQQ, April 2026 — 21 trading days).

**What it checks**

1. For each of the 21 days, downloads `historical-options/v1/QQQ/{date}.json.gz`
   (or `null` on 404 → `noChainPickEntries`) and runs `pickCellsForDate` —
   asserts exactly **380 entries** per day keyed by full cellId.
2. **Oracle cross-check:** an independent naive recomputation of the SPEC
   selection rule (nearest-DTE expiration, tie -> longer DTE; then argmin
   |observedDelta - signed target|, tie -> larger |delta| -> lowest
   contractId) must agree with the picker on **all 7,980 cells**, including
   identity-field eligibility (contractID/expiration/strike/delta must parse;
   quote fields are omitted when absent, never zero-fabricated). A bug in
   either side surfaces as an `ORACLE-DIFF`.
3. **Golden-diff (report-only):** the `QQQ-put-20-45` entry is compared to the
   validated example asset. Diffs print as `GOLDEN-DIFF (info)` warnings —
   they do **not** fail the run: the asset predates corpus self-repair
   (2026-04-14's hole has since been seeded) and interim-snapshot
   supersession, so live chains now hold contracts the golden generator never
   saw. Field-level reconciliation is Task #226's job.

**Usage**

```bash
cd functions
npx ts-node -r tsconfig-paths/register -P scripts/tsconfig.json scripts/verify/options-data-221-pick-cells.ts
```

**Pass:** `PASS: oracle agrees with picker on all 7980 cells` + pick/miss
totals, exit 0.
**Fail:** missing example asset, <380 entries/day, any oracle diff, or a GCS
read error — prints `FAIL:`/`ORACLE-DIFF:` and exits 1.

**Setup/teardown:** no writes. Requires ADC with read access to the options
corpus bucket (`av-hist-options-corpus-bucket`, overridable via
`OPTIONS_CORPUS_BUCKET` for non-prod). `gcloud auth application-default
login`, project `alpha-vantage-proxy-api`. ~21 object downloads; safe to
re-run.
