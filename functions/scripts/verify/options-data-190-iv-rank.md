# Verify — Task #190: IV rank end-to-end (pipeline + screener endpoint)

Production verification for the IV-rank feature: real `computeRankForDate`
write → rank fields on the stored day entry → `iv-rank-latest` doc →
deployed `partnerIvRankV2` screener table (`sort`/`dir`/`minN`) + error
paths + rank fields flowing through `partnerIvMetricsV2` rows.

## ⚠ Mutating

Steps 1–2 write `symbol-metrics/{SYMBOL}/years/{YYYY}` `days.{date}` —
first-order metric fields from `computeForDate`, then rank fields from
`computeRankForDate` — and may rewrite `iv-rank-latest/{SYMBOL}` when the
date is the newest observation (the feature's own output, idempotent and
latest-guarded). Endpoint reads are read-only.

**Run only against an `optionsEnabled` symbol** (default `QQQ`). The rank
service itself has no enabled gate — that check lives in the seed worker
this script bypasses — so computing rank for a disabled/untracked symbol
would write `iv-rank-latest/{SYM}` and inject it into the partner
screener table, with nothing that removes it (the disable cleanup hook
only fires on enable→disable transitions). The script refuses up front
when `tracked-symbols/{SYM}` is missing or `optionsEnabled !== true`.

## Prerequisites

- ADC credentials with Firestore + GCS access (for the compute + read-back).
- `partnerIvRankV2` deployed (`partnerivrankv2-*.a.run.app`).
- A Google OIDC ID token whose **email is in `ALLOWED_SERVICE_ACCOUNT_EMAILS`**
  and **aud is in `EXPECTED_GOOGLE_AUDIENCE`**. Mint via impersonation:

  ```powershell
  $env:IV_RANK_ID_TOKEN = gcloud auth print-identity-token `
    --impersonate-service-account=<allowlisted-sa>@alpha-vantage-proxy-api.iam.gserviceaccount.com `
    --audiences=https://us-central1-alpha-vantage-proxy-api.cloudfunctions.net `
    --include-email
  ```

  **Use the base-host aud**, not a function-scoped URL. The audience check
  is list-membership against the `EXPECTED_GOOGLE_AUDIENCE` secret version
  each function last pinned — and those versions drift independently.
  `partnerIvMetricsV2` pins an older version that does not contain
  `.../partnerIvRankV2`, so a rank-scoped aud gets a 403 from the metrics
  endpoint (observed during verification). The base host is a permanent
  entry present in every version, so one token covers step 9's
  `partnerIvMetricsV2` call as well as the rank endpoint.

  **`--include-email` is required** — without it the token has no `email`
  claim, so it never matches `ALLOWED_SERVICE_ACCOUNT_EMAILS` and every
  authed check will **403** (`Invalid or unauthorized token.`).

  (Requires `roles/iam.serviceAccountTokenCreator` on that SA. Without a
  token the script still verifies compute + read-back + the unauthed
  401 path and skips the rest.)

- Env (all optional):
  - `IV_RANK_ENDPOINT` — rank endpoint URL (defaults to the prod run.app URL)
  - `IV_METRICS_ENDPOINT` — metrics endpoint URL (defaults to prod run.app URL)
  - `IV_RANK_ID_TOKEN` — the minted token

## Run

```powershell
cd functions
npx ts-node -r tsconfig-paths/register -P scripts/tsconfig.json `
  scripts/verify/options-data-190-iv-rank.ts QQQ 2024-01-05
```

## Passing result

`=== All verification checks passed ===` (or the same line with
`(endpoint auth checks skipped)` when `IV_RANK_ID_TOKEN` is unset), exit 0.
One `SKIP:` line is acceptable when no table row has `ivN30 < ivN360` —
the sort-window mapping discrimination needs that shape in the data.

## Failing result

Any `FAIL:` line, exit 1. Two failure modes to expect before suspecting
the pipeline:

- **Live-seed race** — the nightly rank pass can advance `asOfDate`
  between the compute and the read-back, or rewrite the latest doc before
  the endpoint call. A FAIL on an `asOfDate` equality/parity check during
  a busy window is a rerun, not a regression.
- **Stale-field edge** — a day entry recomputed when its window shrank
  can carry a lingering `ivRank{W}` alongside the fresh `ivN{W} < 2`
  (documented upstream limitation: the merge write doesn't delete
  withheld fields). A presence-invariant FAIL on an old date may be that
  defect surfacing — correct behavior for the script to report.
- **Node fetch flakiness** — a `got 0` FAIL on an endpoint check means
  the transport failed before a response (DNS/IPv6 blips observed;
  `curl` may still reach the endpoint). Retry, or run with
  `NODE_OPTIONS=--dns-result-order=ipv4first`.

## What it checks

1. `tracked-symbols/{SYM}` exists and `optionsEnabled === true`
   (anti-pollution gate).
2. `computeForDate` writes a day entry (real corpus + real close) — or,
   if the compute is skipped (corpus/close unavailable), an existing
   day entry with `iv30` already materialized satisfies the check.
3. `computeRankForDate` writes rank fields (all four `ivN` in result).
4. Day entry read-back — contract invariants per window
   (30/60/180/360): `ivN` always finite, `ivRank` present iff `ivN >= 2`,
   `ivPct` present iff `ivN > 0`.
5. `iv-rank-latest/{SYM}` exists with a well-formed `asOfDate`:
   `=== date` when `latestUpdated`, strictly `> date` otherwise
   (forward-only); carries `ivN360`.
6. No token → `401`.
7. `?sort=ivRank360&dir=desc` → 200, `count === rows.length`, rows =
   non-increasing `ivRank360` prefix + missing-value suffix; the symbol's
   row present with `asOfDate` **and** `ivN360`/`ivRank360` matching the
   Firestore doc; `updatedAt` parses as ISO-8601 or is null. `dir=asc`
   rechecked (only direction that proves sink vs sort-as-0).
8. `minN` — `minN=999999` → `count === 0` (filter is wired to a numeric
   field); `minN=2` → non-vacuous `ivN360 >= 2` rows (no-sort fallback);
   `sort=ivRank30&minN=2` → non-vacuous `ivN30 >= 2` rows; when a row
   with `ivN30 < ivN360` exists, `sort=ivRank30&minN=ivN360` drops it and
   the no-sort fallback keeps it (proves the floor reads the sort
   window's `ivN`, not `ivN360`).
9. `partnerIvMetricsV2?metrics=ivRank360,ivN360` — rank fields flow
   through the series endpoint's metric whitelist (row keys ⊆ requested
   fields).
10. `sort=iv30` → 400 `BAD_REQUEST`, `dir=sideways` → 400, `minN=abc` →
    400, `minN=-1` → 400, `minN=2.5` → 400, `POST` → 405.

## Coverage caveat

Rank windows are calendar-day lookbacks over whatever corpus dates exist.
Sparse coverage is normal — `ivN` exposes the sample count rather than
suppressing the row; the script asserts the presence/absence invariants,
not specific rank values.

To exercise the `latestUpdated=true` branch of step 5, pass the newest
`asOfDate` in the table (e.g. `QQQ 2026-10-30`) — an older date verifies
the forward-only guard (`latestUpdated=false`, `asOfDate` strictly newer).
