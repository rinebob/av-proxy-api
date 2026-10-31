# Verify: ops-sms-alerts-210-watchdog-exceptions

**Task:** #210 — Watchdogs emit canonical alert events
**Type:** Mutating (prod). **Not** part of `run-all.ts` — run manually.

## What it exercises

Calls the real watchdog check cores against prod Firestore using probe
run docs on a real future trading day (`2026-12-30`, Wednesday — no real
run docs can exist yet, and the market calendar covers the year):

1. **POST A check** with a seeded DAILY run doc (jobs, PDR not sent) and
   absent WEEKLY/MONTHLY docs:
   - `ops-alerts/exception:post:{date}:A:daily:pdr_missing` written with
     exception text naming the run, expected-vs-actual, and next step
   - `ops-alerts/exception:post:{date}:A:{weekly,monthly}:run_missing`
     written for the two missing intervals
   - `ops-alert-claims/` docs written for all three keys (kind: exception)
   - the existing DAILY run doc stamped `opsSms.claimed[alertKey]`
   - WEEKLY/MONTHLY run docs **not** fabricated
   - the POST health doc still written alongside the events
2. **Duplicate check re-run** — `emittedAt` on the audit doc is
   unchanged, proving the send-once guard suppressed re-emission.
3. **Zero-job DAILY probe** — emits `orchestrator_no_start` (distinct
   key + text from `run_missing`).
4. **Intraday 0800 check** with a seeded zero-job run doc →
   `exception:intraday:{date}:0800:orchestrator_no_start` + claim +
   run-doc stamp.
5. **Intraday 1000 check** with no run doc →
   `exception:intraday:{date}:1000:run_missing`; no stamp, no fabricated
   run doc.

## Run it

```
cd functions
GCLOUD_PROJECT=alpha-vantage-proxy-api npx ts-node -r tsconfig-paths/register -P scripts/tsconfig.json scripts/verify/ops-sms-alerts-210-watchdog-exceptions.ts
```

**REQUIRES `GCLOUD_PROJECT=alpha-vantage-proxy-api`** — without the
override, local ADC resolves the dev project (`rel-str`) and the checks
would pass against the wrong database while leaving probe docs behind.
The script refuses to run without it.

## Safety

- The script is **idempotent**: it deletes every probe alert/claim doc at
  the top before seeding, so leftovers from a crashed prior run can't
  make a rerun pass vacuously (stale claims suppressing re-emission) or
  fail spuriously (stale stamps satisfying assertions).
- All probe docs carry `runCreatedAt` so the 4-day TTL cleanup reclaims
  any strays left by a crashed run.
- `try/finally` deletes every probe doc (run docs, health docs, audit
  docs, claim docs) even when an assertion fails — `assert` throws
  rather than calling `process.exit` inside `main`.
- Assertions use `Timestamp.isEqual` for the dedupe check.
- Probe alert keys are namespaced to the future probe date — no
  collision with real alert keys.
