# options-data-244-availability-services.ts

Verifies Task #244 (availability data services) end-to-end on prod:
exercises both services behind `partnerContractAvailabilityV1` against real
data — `ContractAvailabilityQueryService` on the live
`options-file-index/{symbol}/ts-contracts` collection and
`CorpusDatesService` on the real corpus bucket
(`historical-options/v1/{SYMBOL}/` in `av-hist-options-corpus-bucket`).
Read-only — Firestore + GCS reads only, no writes.

## Command

```powershell
cd functions
npx ts-node -r tsconfig-paths/register -P scripts/tsconfig.json scripts/verify/options-data-244-availability-services.ts
# or with a different symbol:
npx ts-node -r tsconfig-paths/register -P scripts/tsconfig.json scripts/verify/options-data-244-availability-services.ts --symbol SPY
```

## Flags / arguments

| Flag | Required | Allowed values | Default |
|---|---|---|---|
| `--symbol` | no | Any symbol with populated `ts-contracts` catalog docs + corpus objects | `QQQ` |

## Setup / teardown

- **Auth:** ADC with Firestore read + GCS read on the corpus bucket.
- **Setup:** none — the symbol must have catalog docs (produced by the
  time-series build pipeline) and corpus objects (Topic-#213 backfill).
- **Teardown:** none — the script performs no writes.
- **Runtime note:** the service scans in response order and stops after
  `cap + 1` post-filtered matches — expect seconds even on QQQ.

## Expected passing output

```
PASS: QQQ returns contracts (2000)
PASS: every entry has contractId + expiration + strike
PASS: lastUpdated stripped from entries
PASS: entries in deterministic order (expiration → strike → contractId)
PASS: truncated flag consistent with 2000 cap
PASS: expiration=2019-01-04 + type=put → only matching contracts (116)
PASS: expirations=[2019-01-04,2019-01-11] → only listed expirations (480)
PASS: strikeStep=10 → all strikes on $10 grid (2000)
PASS: unmatched symbol → empty, not truncated
PASS: QQQ corpus dates present (1965)
PASS: all corpus dates are YYYY-MM-DD
PASS: corpus dates strictly ascending
PASS: unknown symbol → empty corpus dates

DONE: QQQ — 2000 contracts (truncated=true), 1965 corpus dates
```

Counts vary with catalog/corpus growth — the invariants are non-empty
results for a populated symbol, deterministic ordering, `lastUpdated`
absent, grid-aligned strikes for `strikeStep`, strict ascending dates, and
empty results for `ZZTEST-NOSUCH`.

## Expected failure output

Any `FAIL:` line followed by exit code 1, e.g.:

```
FAIL: entries in deterministic order (expiration → strike → contractId)
```

means the service's in-memory sort regressed.

```
FAIL: QQQ returns contracts (0)
```

means the catalog path or collection constants drifted from
`options-file-index/{symbol}/ts-contracts` — or the symbol genuinely has no
catalog docs (try `--symbol` with a populated one).

## Status

Read-only — registered in `run-all.ts`. The query service paginates in
response order (early exit at `cap + 1` matches) for unfiltered and
expiration-primary queries, so this script runs in seconds; selective
firstObserved/strike primaries still run one bounded `get()`.
