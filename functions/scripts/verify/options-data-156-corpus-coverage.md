# Task #156 — Corpus coverage report surface (read-only)

Verifies the live, computed corpus-coverage report: per symbol, the swing-doc
pivot plan diffed against stored GCS corpus objects plus the latest
`options_corpus_runs` item status per date.

## Scripts

### `options-data-156-corpus-coverage.ts` — read-only

**Pipeline stage:** read surface (plan + GCS + run-item fold)

**Command**

```powershell
cd functions
npx ts-node -r tsconfig-paths/register -P scripts/tsconfig.json scripts/verify/options-data-156-corpus-coverage.ts
```

**Arguments**

| Arg | Values | Description |
|---|---|---|
| `--symbols=A,B,C` | comma-separated symbols | Report only this subset instead of the full enabled set. |

**What it does**

1. Runs `runCorpusCoverage` with production deps — real `options-swing-sets`
   docs, real corpus bucket listing, real `options_corpus_runs` item scan
   (`symbols array-contains` + per-run items query — no collectionGroup index
   needed). No writes anywhere.
2. Prints one line per symbol: planned / seeded / missing / failed /
   in_flight / unplanned + current interim date.
3. Asserts the count invariant `seeded + missing + failed + in_flight ==
   planned`, known per-date statuses, ascending sort, run-status presence on
   failed rows, and that `currentInterimDate` maps to a planned interim row.
4. Re-runs on a `{oneEnabled, ZZTEST}` subset and asserts the subset is
   honored and the non-enabled symbol is reported with
   `optionsEnabled=false` (flagged, not dropped).

**Passing result** — per-symbol lines plus `PASS:` checks, ending with
`=== All verification checks passed ===`.

**Failing result** — `FAIL: {check}` and exit code 1.

**Setup/teardown** — none. Read-only; needs ADC credentials (`gcloud auth
application-default login`) with access to prod Firestore + the corpus GCS
bucket. Full-set scans take on the order of a minute; use `--symbols` for a
quick check.

## Endpoint smoke (post-deploy)

The admin HTTP wrapper (`getHistoricalOptionsCorpusCoverage`) is verified
after deploy — it needs the `HISTORICAL_OPTIONS_COVERAGE_ADMIN_SECRET` secret
provisioned first:

```powershell
$base = (gcloud functions describe getHistoricalOptionsCorpusCoverage --region us-central1 --gen2 --format="value(serviceConfig.uri)")
# Wrong secret → 403
Invoke-WebRequest -Method POST -Uri $base -Headers @{ 'x-admin-secret' = 'wrong' } -Body '{}' -ContentType 'application/json' -SkipHttpErrorCheck | % StatusCode
# Right secret → 200 with { ok: true, report }
Invoke-WebRequest -Method POST -Uri $base -Headers @{ 'x-admin-secret' = $env:HISTORICAL_OPTIONS_COVERAGE_ADMIN_SECRET } -Body '{"symbols":["AAPL"]}' -ContentType 'application/json'
```
