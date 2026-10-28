# Task #206 — Send-once guard verification

Verifies `claimOpsAlert` (`src/v2/common/ops-alerts/ops-alert.guard.ts`) against
prod Firestore.

## Script

`ops-sms-alerts-206-send-once-guard.ts` — **mutating, not in run-all.**

```bash
cd functions
npx ts-node -r tsconfig-paths/register -P scripts/tsconfig.json scripts/verify/ops-sms-alerts-206-send-once-guard.ts
```

## What it checks

1. First claim of `verify:ops-206:{date}` returns `claimed`.
2. Second claim of the same alertKey returns `already-claimed` — no second
   write (send-once under redelivery).
3. Claim doc persisted at `ops-alert-claims/{alertKey}` with `alertKey`,
   `kind`, `runId`, `marketDate`, `claimedAt` fields.
4. When `runDocPath` is provided, the same transaction stamps
   `opsSms.claimed[alertKey]` on the run doc (mirrors
   `partnerDataReady.messageSent` observability).
5. Four concurrent `Promise.all` claims of a fresh key → exactly one
   `claimed`, three `already-claimed` (transaction serializes contenders).
6. An alertKey containing `/` returns `error` without writing.

## Setup / teardown

Writes five prod docs and deletes all of them on success:

- `ops-alert-claims/verify:ops-206:{date}`
- `ops-alert-claims/verify:ops-206:{date}:concurrent`
- `ops-alert-claims/verify:ops-206:{date}:ghost`
- `ops-alert-claims/verify:ops-206:{date}:badpath`
- `ops-alerts-verify-scratch/ops-206-run`

The `:ghost` and `:badpath` claim docs are deleted mid-script; a failure
before that point leaves them behind — delete the paths above manually.

## Pass / fail

Pass: all `PASS:` lines, ending `=== All verification checks passed ===`,
exit 0. Fail: `FAIL:` line + exit 1 — probe docs may be left behind; delete
the paths above manually.
