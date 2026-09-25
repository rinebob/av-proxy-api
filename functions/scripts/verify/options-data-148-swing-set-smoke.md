# Verification Guide — Task #148: swing-set platform post-deploy smoke

Topic: #102 (Swing-driven options corpus) · Thread: #103 (Swing-set generation platform) · Blueprint: #121 (BE)

## What this verifies

**Black-box checks against the DEPLOYED functions** — unlike the per-task verify scripts (which inject deps at the handler seam), this is the surface ST actually hits:

- `GET partnerSwingSetsV2` with a real Google OIDC token → 200 + `{ok, source:'sa', data}` envelope; single `paramsId` read; optional `OPTIONS_NOT_ENABLED` assertion
- `POST backfillSwingSets` `{dryRun:true}` with `x-admin-secret` → 200 + report; wrong-secret → 403 (no writes ever)
- `sweepSwingSets` present in `firebase functions:list`

## Scripts

| Script | Pipeline stage | What it checks |
|---|---|---|
| `options-data-148-swing-set-smoke.ts` | Post-deploy smoke | Deployed auth wiring, secrets mounting, envelope, enabled gates — read-only |

## Usage

```bash
cd functions

# OIDC auth — pick ONE; the SA must be in ALLOWED_SERVICE_ACCOUNT_EMAILS:
$env:GOOGLE_APPLICATION_CREDENTIALS = 'C:\path\to\sa-key.json'          # SA key file
# or
$env:SMOKE_SERVICE_ACCOUNT = 'sa-email@project.iam.gserviceaccount.com' # gcloud impersonation

$env:SWING_SET_ADMIN_SECRET = '<value>'   # for the backfill dryRun check

npx ts-node -r tsconfig-paths/register -P scripts/tsconfig.json \
  scripts/verify/options-data-148-swing-set-smoke.ts --symbol AAPL [--also-disabled MSFT]
```

## Passing result

`PASS` lines for each check, ending `=== Smoke passed — deployed endpoints healthy ===` (exit 0).

## Failing result

- `partnerSwingSetsV2` 403 → SA email not in `ALLOWED_SERVICE_ACCOUNT_EMAILS`
- `partnerSwingSetsV2` 404 → symbol untracked, or no swing docs generated yet (run the backfill first)
- `backfillSwingSets` 403/500 → `SWING_SET_ADMIN_SECRET` not set in Secret Manager or wrong value locally
- `sweepSwingSets` missing → `firebase deploy --only functions` hasn't run

## Setup/teardown

**Read-only** — the only POST is `dryRun:true` (freshness checks + enumeration, zero writes). Requires: deployed functions (#127/#128), `SWING_SET_ADMIN_SECRET` in Secret Manager, a service account in `ALLOWED_SERVICE_ACCOUNT_EMAILS`, and at least one options-enabled symbol with generated swing docs. Not in `run-all`.
