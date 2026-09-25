# Verify — Task #140: setOptionsEnabledV2 curation core

Verifies the guarded toggle against prod: `SYMBOL_NOT_FOUND` for untracked
symbols, false→true transition writes the flag + audit entry + enqueues,
idempotent re-enable (no history, no enqueue), true→false transition
without enqueue.

## Run

```powershell
cd functions
npx ts-node -r tsconfig-paths/register -P scripts/tsconfig.json scripts/verify/options-data-140-set-options-enabled.ts [SYMBOL]
```

Default symbol `AAPL` (must be `optionable === true`).

## Setup/teardown

**Mutating** — flips the symbol to the opposite state and restores its
prior state, leaving **two `optionsEnabledHistory` entries**
(`changedBy='verify-script'`, `reason='verify-140'`) as a visible audit of
the test run. Enqueue is stubbed so no swing-set task is created. Not in
`run-all`. Requires Firestore read+write.

Note: this exercises the curation **core**, not the deployed callable —
auth/arg validation in the onCall wrapper is verified by inspection. The
callable requires Firebase authentication; custom-claim admin enforcement
is deferred for the current single-operator deployment.
