# Verification Guide — Task #142: list-endpoint flag filtering

Topic: #102 (Swing-driven options corpus) · Thread: #105 (Symbol flags curation) · Blueprint: #135 (BE)

## What this verifies

`partnerListTrackedSymbolsV2` accepts `?optionable=` / `?optionsEnabled=` opt-in
equality filters on the tracked-symbol doc fields (deployed build required —
the filters are silently ignored on older revisions).

- `optionsEnabled=true/false` partition the full set (true + false = total —
  every doc carries the field since #139 defaults)
- `optionable=true` returns only probed-positive docs
- malformed values are ignored, not 400s
- filters compose with `activeOnly`/`limit`

## Scripts

| Script | Pipeline stage | What it checks |
|---|---|---|
| `options-data-142-list-flag-filtering.ts` | Post-deploy read check | Deployed endpoint filtering via real OIDC — read-only |

## Usage

```bash
cd functions

$env:SMOKE_SERVICE_ACCOUNT='rel-str-partner-caller-prod@rel-str.iam.gserviceaccount.com'
# or $env:GOOGLE_APPLICATION_CREDENTIALS='C:\path\sa-key.json'

npx ts-node -r tsconfig-paths/register -P scripts/tsconfig.json \
  scripts/verify/options-data-142-list-flag-filtering.ts [--enabled-symbol AAPL]
```

`--enabled-symbol` must be an options-enabled symbol (AAPL was enabled during
the #148 smoke run).

## Passing result

All `PASS` lines + `=== Verify passed ===` (exit 0).

## Failing result

- 401/403 → SA not in `ALLOWED_SERVICE_ACCOUNT_EMAILS` or audience missing from `EXPECTED_GOOGLE_AUDIENCE`
- `true+false != total` → docs without `optionsEnabled` exist (older docs pre-#139 — expected until they get default-stamped on write; the assert flags it so you notice)
- `bogus` count differs → filter isn't being ignored correctly

## Setup/teardown

**Read-only** — GETs only. Requires deployed `partnerListTrackedSymbolsV2` with the #142 change and a service account in `ALLOWED_SERVICE_ACCOUNT_EMAILS`. Not in `run-all`.
