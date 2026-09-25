# Verification Guide — Task #128: partnerSwingSetsV2

Topic: #102 (Swing-driven options corpus) · Thread: #103 (Swing-set generation platform) · Blueprint: #121 (BE)

## What this verifies

`swingSetsPartnerHandler` — the deployed handler behind `GET /partnerSwingSetsV2` — against prod Firestore with real `getTrackedFlags` + `SwingSetRepository` deps:

- Untracked symbol → `404 NOT_FOUND`
- Tracked, `optionsEnabled=false` → `403 OPTIONS_NOT_ENABLED`
- Enabled but no swing docs → `404 NOT_FOUND`
- `?paramsId=` → single `SwingSetDoc` in the `{ok, symbol, paramsId, source:'sa', data, timestamp, processingTimeMs}` envelope
- Omitted `paramsId` → all four canonical docs keyed by paramsId
- Unknown `paramsId` → `404 NOT_FOUND`

Auth paths (OIDC service-account required, Firebase-auth 403, audience gate, method gate) are covered by unit tests — the script stubs `authenticateRequest` at the documented deps seam since tokens can't be minted locally.

## Scripts

| Script | Pipeline stage | What it checks |
|---|---|---|
| `options-data-128-partner-swing-sets.ts` | Read path (partner endpoint) | Tracked/enabled gates, single + all-docs responses, envelope shape, error codes |

## Usage

```bash
cd functions
npm run copy-shared   # required if shared/ changed since last build
npx ts-node -r tsconfig-paths/register -P scripts/tsconfig.json scripts/verify/options-data-128-partner-swing-sets.ts
```

## Passing result

Per-check `PASS` lines ending with cleanup confirmations and `=== All verification checks passed ===` (exit 0).

## Failing result

Prints `FAIL: {description}` and exits 1. Cleanup still runs via `finally`.

## Setup/teardown

**Mutating** — writes then deletes `tracked-symbols/ZZTEST` and `options-swing-sets/ZZTEST_*` (aborts if `tracked-symbols/ZZTEST` already exists). Writing the tracked doc fires the `onSymbolAdded` trigger, which asynchronously recreates it — cleanup polls ~2min, re-deleting (incl. `symbol-data/ZZTEST`). Not in `run-all`. Requires Firestore read+write credentials.
