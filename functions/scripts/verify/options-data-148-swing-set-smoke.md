# Verification Guide — Task #148: swing-set platform post-deploy smoke

Topic: #102 (Swing-driven options corpus) · Thread: #103 (Swing-set generation platform) · Blueprint: #121 (BE)

## What this verifies

**Black-box checks against the DEPLOYED functions** — unlike the per-task verify scripts (which inject deps at the handler seam), this exercises the real HTTPS + secrets surface:

- `POST backfillSwingSets` `{dryRun:true}` with `x-admin-secret` → 200 + report; wrong-secret → 403 (no writes ever)
- `sweepSwingSets` + `generateSwingSetsTask` present in `firebase functions:list`

## Scripts

| Script | Pipeline stage | What it checks |
|---|---|---|
| `options-data-148-swing-set-smoke.ts` | Post-deploy smoke | Deployed secret mounting, admin gate, dry-run enumeration — read-only |

## Usage

```bash
cd functions
$env:SWING_SET_ADMIN_SECRET = '<value>'

npx ts-node -r tsconfig-paths/register -P scripts/tsconfig.json \
  scripts/verify/options-data-148-swing-set-smoke.ts [--symbol AAPL]
```

- `--symbol` (optional) narrows the dryRun report to one symbol; default enumerates all options-enabled symbols.

## Passing result

`PASS` lines for each check, ending `=== Smoke passed — deployed endpoints healthy ===` (exit 0).

## Failing result

- `backfillSwingSets` 403/500 → `SWING_SET_ADMIN_SECRET` not set in Secret Manager or wrong value locally
- `sweepSwingSets`/`generateSwingSetsTask` missing → `firebase deploy --only functions` hasn't run

## Setup/teardown

**Read-only** — the only POST is `dryRun:true` (freshness checks + enumeration, zero writes). Requires: deployed functions (#126/#127) and `SWING_SET_ADMIN_SECRET` in Secret Manager. Not in `run-all`.
