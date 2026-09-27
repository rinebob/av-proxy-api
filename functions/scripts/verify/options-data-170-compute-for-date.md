# Task #170 — repository + computeForDate

## What this verifies

The full build pipeline on real prod data: corpus chain (GCS) →
split-adjusted close (sa-time-series year doc) → METRIC_REGISTRY →
`symbol-metrics/{SYMBOL}/years/{YYYY}` merge write → repository read-back +
idempotent recompute.

## Scripts

| Script | Pipeline stage | What it checks |
|---|---|---|
| `options-data-170-compute-for-date.ts` | Fetch → Storage → Transform → back | `computeForDate` result `{written:true, fields:[iv30…]}`; readDay round trip; iv30 bounds/method; recompute dedupes by date key |

## ⚠ Mutating

Writes `symbol-metrics/{SYMBOL}/years/{YYYY}` `days.{date}` — the feature's
own output. Idempotent (dedupe-by-key); re-running is safe. Not in run-all.

## Usage

```
cd functions
$env:OPTIONS_CORPUS_BUCKET="av-hist-options-corpus-bucket"   # or unset — prod default is built in
npx ts-node -r tsconfig-paths/register -P scripts/tsconfig.json \
  scripts/verify/options-data-170-compute-for-date.ts [SYMBOL] [YYYY-MM-DD]
```

| Arg | Default | Values |
|---|---|---|
| `SYMBOL` | `QQQ` | optionsEnabled symbol with corpus + sa-time-series data |
| `YYYY-MM-DD` | `2024-01-05` | a date present in `historical-options/v1/{SYM}/` |

## Passing result

`result: {"symbol":"QQQ","date":"2024-01-05","written":true,"fields":["iv30","iv30Method","iv30Contracts"]}`
then PASS lines through `=== All verification checks passed ===`.

## Failing result

`FAIL: <check>` — corpus object or close bar missing (pick a seeded pivot
date), registry declined (thin chain), or the write/read-back mismatched.

## Setup/teardown

Requires Application Default Credentials. Leaves a `symbol-metrics` year doc
behind — that's production data the feature is designed to hold, so no
teardown is needed (delete `symbol-metrics/{SYM}/years/{YYYY}` manually if
you must).
