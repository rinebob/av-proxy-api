# Task #169 — IV30 metric computer + registry

## What this verifies

The IV30 computer + registry run correctly against **real prod data** — a
stored corpus chain (GCS) plus the split-adjusted close (`CompactBar.c`) from
the sa-time-series year doc, through `computeDayMetrics` — the same call the
seed-worker hook will make.

## Scripts

| Script | Pipeline stage | What it checks |
|---|---|---|
| `options-data-169-iv30-computer.ts` | Transform (business logic) | Corpus read, close-bar lookup, `computeDayMetrics` output — finite in-bounds `iv30`, `iv30Method` ∈ {interpolated, nearest}, `iv30Contracts` > 0 |

## Usage

```
cd functions
$env:OPTIONS_CORPUS_BUCKET="av-hist-options-corpus-bucket"
npx ts-node -r tsconfig-paths/register -P scripts/tsconfig.json \
  scripts/verify/options-data-169-iv30-computer.ts [SYMBOL] [YYYY-MM-DD]
```

| Arg | Default | Values |
|---|---|---|
| `SYMBOL` | `QQQ` | any optionsEnabled symbol with corpus + sa-time-series data |
| `YYYY-MM-DD` | `2024-01-05` | a date present in `historical-options/v1/{SYM}/` (pivot dates) |

## Passing result

`entry: {"iv30":…,"iv30Method":"interpolated","iv30Contracts":…}` between the
close-bar and bounds assertions, then `=== All verification checks passed ===`.
(QQQ 2024-01-05 produced iv30 ≈ 0.161, interpolated, 10124 contracts.)

## Failing result

`FAIL: <check>` — corpus object missing (re-run pilot seeds), no close bar for
the date, or computer output invalid/null.

## Setup/teardown

Read-only — no writes. Requires Application Default Credentials
(`GOOGLE_APPLICATION_CREDENTIALS`) and `OPTIONS_CORPUS_BUCKET`.
