# Verification Guide — Task #127: sweepSwingSets + backfillSwingSets

Topic: #102 (Swing-driven options corpus) · Thread: #103 (Swing-set generation platform) · Blueprint: #121 (BE)

## What this verifies

`runSwingSetSweep` — the shared core behind the `sweepSwingSets` scheduler and the `backfillSwingSets` operator endpoint — against prod Firestore:

- Enumerates only `tracked-symbols` with `optionsEnabled === true`
- Freshness skip when the corpus doc is within the TTL; stale/missing → generation runs
- `force` bypasses freshness; `symbols` subset still gates on optionsEnabled
- Per-symbol failure isolation and graceful no-data skip

The deployed wrappers are thin: `sweepSwingSets` = `onSchedule` (8 PM PT weekdays, after the daily-adjusted evening retry) wiring prod deps; `backfillSwingSets` = `onRequest` POST + `x-admin-secret` (`SWING_SET_ADMIN_SECRET`), optional `symbols`/`force`/`dryRun`.

## Scripts

| Script | Pipeline stage | What it checks |
|---|---|---|
| `options-data-127-swing-set-sweep.ts` | Maintenance (sweep/backfill) | optionsEnabled enumeration, freshness skip, stale regeneration, force, subset gating, disable removal |

## Usage

```bash
cd functions
npm run copy-shared   # required if shared/ changed since last build
npx ts-node -r tsconfig-paths/register -P scripts/tsconfig.json scripts/verify/options-data-127-swing-set-sweep.ts
```

## Passing result

Per-check `PASS` lines ending with cleanup confirmations and `=== All verification checks passed ===` (exit 0).

## Failing result

Prints `FAIL: {description}` and exits 1. Cleanup still runs via `finally`.

## Setup/teardown

**Mutating** — writes then deletes `tracked-symbols/ZZTEST` and `options-swing-sets/ZZTEST_*` (aborts if `tracked-symbols/ZZTEST` already exists). Writing the tracked doc fires the `onSymbolAdded` trigger, which asynchronously recreates it — cleanup polls up to ~2min, re-deleting until it stays absent. Also runs the baseline sweep against any real options-enabled symbols in prod (regenerates stale ones — intended). Not in `run-all`. Requires Firestore read+write credentials.
