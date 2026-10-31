# Verify — Task #246: partnerContractAvailabilityV1 deployed endpoint

Read-only verification of the deployed contract-availability endpoint — the
real path a partner consumer takes: OIDC auth → 405/401/400/404 gates →
response envelope + filtering. Complements
`options-data-244-availability-services.ts`, which verified the underlying
services directly; this script proves the HTTP surface end-to-end.

## Read-only

All calls are GET/POST reads — no Firestore or GCS writes. Eligible for
run-all: without credentials it verifies the unauthenticated paths and exits
0 with `SKIP`.

## Prerequisites

- `partnerContractAvailabilityV1` deployed (the #245 build — check for a
  `partnercontractavailabilityv1-*.a.run.app` function first; an undeployed
  function surfaces as `404` on the unauthenticated check and the script
  reports that explicitly).
- A Google OIDC ID token whose **email is in `ALLOWED_SERVICE_ACCOUNT_EMAILS`**
  and **aud is in `EXPECTED_GOOGLE_AUDIENCE`**. Provided any of:

  ```powershell
  # A) Pre-minted token — pass it straight through
  $env:AVAILABILITY_ID_TOKEN = (gcloud auth print-identity-token --impersonate-service-account=<sa> --audiences=<endpoint-url> --include-email)

  # B) Service-account key — the script mints the token via google-auth-library
  $env:GOOGLE_APPLICATION_CREDENTIALS='C:\path\sa-key.json'

  # C) gcloud impersonation (requires roles/iam.serviceAccountTokenCreator)
  $env:SMOKE_SERVICE_ACCOUNT='<allowlisted-sa>@alpha-vantage-proxy-api.iam.gserviceaccount.com'
  ```

  For (C) the script runs `gcloud auth print-identity-token
  --impersonate-service-account=<sa> --audiences=<endpoint-url>
  --include-email`. `--include-email` is required — without it the token has
  no `email` claim and never matches the allowlist.

- Env (all optional):
  - `AVAILABILITY_ENDPOINT` — endpoint URL (defaults to the prod run.app URL)
  - `AVAILABILITY_ID_TOKEN` — pre-minted Google OIDC id token

## Run

```powershell
cd functions
npx ts-node -r tsconfig-paths/register -P scripts/tsconfig.json `
  scripts/verify/options-data-246-contract-availability.ts [SYMBOL]
```

`SYMBOL` defaults to `COST` — a known options-enabled symbol whose catalog is
small enough to return well inside the 60s budget (unlike QQQ, which scans
~395k ts-contracts docs).

## What it checks

1. Unauthenticated `GET` → `401`. (`404` → function not deployed; `500` →
   `EXPECTED_GOOGLE_AUDIENCE` secret unset; Cloud-Run `403` → function lacks
   `allUsers` invoker — all reported distinctly.)
2. `POST` → `405 METHOD_NOT_ALLOWED` (method gate precedes auth; no token).
3. Authed `?symbol=<SYM>` → `200` envelope: `ok`, `symbol` echoed, `contracts`,
   `count === contracts.length`, `truncated` boolean, `corpusDates`,
   `corpusDateCount === corpusDates.length`.
4. Every contract entry carries `contractId` / `expiration` / `strike` /
   `type` / `firstObserved`; `lastUpdated` is absent everywhere.
5. `corpusDates` strictly ascending `YYYY-MM-DD`.
6. `type=<t0>` (derived from the first catalog entry) narrows the result set
   and every entry is a `t0` (falls back to an explicit `expirations` list
   for the single-type catalog edge case).
7. `type=<t0>&firstObservedGte=<d0>&firstObservedLte=<d0>` → `200`, every
   entry `firstObserved == d0` — exercises the `(type, firstObserved)`
   composite index through the real endpoint (type + date derived from the
   first catalog entry so a hit is guaranteed).
8. `type=<t0>&strikeGte=<s0>&strikeLte=<s0>` → `200`, every entry an exact
   `strike == s0` match — exercises the `(type, strike)` composite index
   (pinned to a known hit from the unfiltered page).
9. `expirations=<31 dates>` → `400 BAD_REQUEST` — the `MAX_EXPIRATIONS_LIST`
   boundary over the wire.
10. gcloud **user** identity token (never an allowlisted SA) →
    `403 FORBIDDEN` — the service-account allowlist exercised live (skips if
    no `gcloud` user login exists, or if the user identity lacks
    `run.invoker` — a Cloud-Run-level 403 carries no app envelope).
11. `type=bogus` → `400` with the V2 error envelope (`ok:false`, `code`,
    `timestamp`).
12. `ZZZNOSUCH1` (never tracked) → `404 OPTIONS_NOT_ENABLED` — the Task #150
    options-enabled gate, exercised live.

## Failure notes

- `401`/`403` on authed calls → SA not in `ALLOWED_SERVICE_ACCOUNT_EMAILS` or
  audience missing from `EXPECTED_GOOGLE_AUDIENCE` (mint with `--include-email`
  and the endpoint URL as audience).
- `403` from Cloud Run (not the app envelope) → SA lacks `run.invoker` on the
  function; grant it or use an SA that has it.
- Timeout on a large symbol (e.g. `QQQ` unfiltered) → expected until #251
  (bound primary-range reads) lands; use a smaller symbol.
