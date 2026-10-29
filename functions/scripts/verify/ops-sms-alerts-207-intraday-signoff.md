# Task #207 — Intraday signoff emission verification

Verifies `emitIntradayTickSignoff`
(`src/v2/alpha-vantage/jobs/intraday-ops-signoff.ts`) end-to-end against
prod Firestore — the same call site the aggregator invokes after a tick's
PDR publish succeeds.

## Script

`ops-sms-alerts-207-intraday-signoff.ts` — **mutating, not in run-all.**

```bash
cd functions
npx ts-node -r tsconfig-paths/register -P scripts/tsconfig.json scripts/verify/ops-sms-alerts-207-intraday-signoff.ts
```

## What it checks

1. A `clockPt=0800` invocation claims `signoff:intraday:{verifyDate}:0800`
   and emits — claim doc at `ops-alert-claims/{alertKey}` carries
   `kind`, `runId`, `marketDate`, `claimedAt`.
2. The audit doc at `ops-alerts/{alertKey}` carries the composed smsText —
   tick label, market date, refreshed counts, PDR confirmation — and an
   `emittedAt` timestamp.
3. The probe run doc gets the `opsSms.claimed[alertKey]` stamp without
   losing pre-existing fields.
4. A second invocation of the same tick is deduped — the audit doc's
   `emittedAt` is unchanged (no re-emit under redelivery).
5. A non-tick `clockPt=0947` invocation writes no claim doc and no audit
   doc (heartbeat/manual gating).

## Setup / teardown

Writes three prod docs and deletes all of them on success:

- `intraday-runs/verify-ops-207-{timestamp}` (probe run doc, status
  COMPLETE — invisible to the self-healing IN_PROGRESS query)
- `ops-alert-claims/signoff:intraday:verify-207-{date}:0800`
- `ops-alerts/signoff:intraday:verify-207-{date}:0800`

The verify marketDate/runId cannot collide with real pipeline identities
(`{marketDate}-{DOW}-LIVE-{clockPt}` / real ET dates).

## Side-effect note

The script emits a **real `ops.alert` signoff event** in prod. Today nothing
consumes it beyond the log line + audit doc, but once Task #211 wires the
SMS delivery route, running this script will send a real signoff text to
the ops phone — identifiable by its `verify-207-*` marketDate.

## Pass / fail

Pass: all `PASS:` lines, ending `=== All verification checks passed ===`,
exit 0. Fail: `FAIL:` line + exit 1 — probe docs may be left behind; delete
the paths above manually.
