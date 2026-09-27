# Verify — Task #173: IV metrics end-to-end (pipeline + endpoint)

Production verification for the whole symbol-metrics feature: real
`computeForDate` write → stored day entry → deployed `partnerIvMetricsV2`
range/point reads + error paths.

## ⚠ Mutating

Step 1 writes `symbol-metrics/{SYMBOL}/years/{YYYY}` `days.{date}` — the
feature's own output, idempotent (dedupe-by-key). Endpoint reads are
read-only.

## Prerequisites

- ADC credentials with Firestore + GCS access (for the compute + read-back).
- `partnerIvMetricsV2` deployed (the endpoint ships with the next functions
  deploy — check for a `partnerivmetricsv2-*.a.run.app` function first).
- A Google OIDC ID token whose **email is in `ALLOWED_SERVICE_ACCOUNT_EMAILS`**
  and **aud is in `EXPECTED_GOOGLE_AUDIENCE`**. Mint via impersonation:

  ```powershell
  $env:IV_METRICS_ID_TOKEN = gcloud auth print-identity-token `
    --impersonate-service-account=<allowlisted-sa>@alpha-vantage-proxy-api.iam.gserviceaccount.com `
    --audiences=<expected-audience> `
    --include-email
  ```

  **`--include-email` is required** — without it the token has no `email`
  claim, so it never matches `ALLOWED_SERVICE_ACCOUNT_EMAILS` and every
  authed check will 401.

  (Requires `roles/iam.serviceAccountTokenCreator` on that SA. Without a
  token the script still verifies the compute + read-back + the unauthed
  401 path and skips the rest.)

- Env (all optional):
  - `IV_METRICS_ENDPOINT` — endpoint URL (defaults to the prod function URL)
  - `IV_METRICS_ID_TOKEN` — the minted token

## Run

```powershell
cd functions
npx ts-node -r tsconfig-paths/register -P scripts/tsconfig.json `
  scripts/verify/options-data-173-iv-metrics-endpoint.ts QQQ 2024-01-05
```

## Coverage caveat

The endpoint serves whatever dates the corpus has. Today corpus coverage is
pivot-driven/sparse; a 360-traded-day full-chain backfill is inbound — until
it lands, a range read returns only pivot dates (the script asserts only that
the seeded `date` is present, so it passes either way).

## What it checks

1. `computeForDate` writes a day entry (real corpus + real close).
2. `readDay` round-trips the entry (`iv30` finite).
3. No token → `401`.
4. Range read → 200, ascending rows, target date present, `iv30` matches stored.
5. Point read → exactly one row.
6. `metrics=iv30` → row carries only `iv30`.
7. Untracked symbol (`ZZZXQ`) → `404 NOT_FOUND`.
8. A symbol with `optionsEnabled=false` (found dynamically) →
   `403 OPTIONS_NOT_ENABLED`. Skipped with a note if none exists.
