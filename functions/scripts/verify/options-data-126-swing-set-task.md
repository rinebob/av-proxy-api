# Verification Guide — Task #126: generateSwingSetsTask

Topic: #102 (Swing-driven options corpus) · Thread: #103 (Swing-set generation platform) · Blueprint: #121 (BE)

## What this verifies

The Cloud Task's testable internals against prod Firestore:

- `enqueueSwingSetGeneration` — the `optionsEnabled` gate: enqueues `{symbol}` only when `tracked-symbols/{SYMBOL}` exists with `optionsEnabled === true`; skips untracked/disabled symbols. (The actual `getFunctions().taskQueue().enqueue` is stubbed — real enqueue requires the deployed function + service-account token signing; the gate + payload shape are what this script proves.)
- `handleGenerateSwingSets` — invalid payload acked without throw (no retry); no-data symbol → graceful generation skip; all-four-fresh → `skipped-fresh`; stale or partial canonical set → generation runs.

The deployed `onTaskDispatched` wrapper is thin — it wires `admin.firestore()` → `SwingSetRepository` + `SwingSetGenerationService` into `handleGenerateSwingSets`, with `retryConfig.maxAttempts: 3` for transient failures.

## Scripts

| Script | Pipeline stage | What it checks |
|---|---|---|
| `options-data-126-swing-set-task.ts` | Orchestration (trigger + handler) | optionsEnabled enqueue gate, payload normalization, invalid-payload ack, freshness TTL skip, stale/partial regeneration |

## Usage

```bash
cd functions
npm run copy-shared   # required if shared/ changed since last build
npx ts-node -r tsconfig-paths/register -P scripts/tsconfig.json scripts/verify/options-data-126-swing-set-task.ts
```

## Passing result

Per-check `PASS` lines ending with cleanup confirmations and `=== All verification checks passed ===` (exit 0).

## Failing result

Prints `FAIL: {description}` and exits 1. Cleanup still runs via `finally`.

## Setup/teardown

**Mutating** — writes then deletes `tracked-symbols/ZZTEST` and `options-swing-sets/ZZTEST_*` (refuses to run if `tracked-symbols/ZZTEST` already exists). Writing the tracked doc fires the `onSymbolAdded` trigger, which asynchronously recreates it — cleanup waits 8s and deletes again. Not in `run-all`. Requires Firestore read+write credentials.
