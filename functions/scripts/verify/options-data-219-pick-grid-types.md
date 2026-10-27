# Task #219 verify guide — delta-pick grid config + pick types

## Script: `options-data-219-pick-grid-types.ts` (read-only)

Verifies the compiled shared package exports and the `cellId` codec against
the **real** enabled-symbol universe in prod Firestore.

**What it checks**

1. `PICK_GRID` enumerates exactly 380 cells (19 delta magnitudes × 10 DTEs ×
   put/call), all unique, `PICK_GRID_VERSION = 1`.
2. Loads the live `tracked-symbols.optionsEnabled == true` universe (~130
   symbols), builds every cellId (`{SYM}-{type}-{deltaPct}-{dte}`), parses it
   back, and asserts a lossless round-trip (~49k ids).
3. `cellYearDocPath` produces
   `options-delta-picks/{cellId}/years/{YYYY}` — an even-segment document path.

**Usage**

```bash
cd functions
npx ts-node -r tsconfig-paths/register -P scripts/tsconfig.json scripts/verify/options-data-219-pick-grid-types.ts
```

**Pass:** every check prints `PASS:` then `=== All verification checks passed ===`
**Fail:** first failing check prints `FAIL:` and exits 1.

**Setup/teardown:** no writes; requires Application Default Credentials with
read access to prod Firestore (`gcloud auth application-default login`,
project `alpha-vantage-proxy-api`). Safe to re-run any time.
