# Verify — Task #208: POST-A last-interval signoff emission

**Script:** `ops-sms-alerts-208-post-a-signoff.ts`
**Type:** mutating (writes + deletes probe docs in prod) — **not** in `run-all.ts`, run manually.

## What it proves

End-to-end against real prod Firestore:

1. **Partial gate** — with 2/3 sibling `partnerDataReady.messageSent` true, `emitPostASignoff` creates no claim doc.
2. **Full gate + claim/emit** — after the third sibling's messageSent flips true, the helper claims `signoff:post:{marketDate}:A` transactionally, emits the canonical `ops.alert` event, and writes the `ops-alerts/{alertKey}` audit doc.
3. **Text content** — audit `smsText` names the POST A signoff, market date, per-interval counts, and the all-PDRs confirmation; failed symbols appear only in `context.failedSymbols`, never in the text.
4. **Run-doc stamp** — the triggering (last-finishing) run doc carries `opsSms.claimed[alertKey]`.
5. **Dedupe** — a second invocation (different sibling runId) leaves the audit doc `emittedAt` unchanged.
6. **B/C gate** — a retry-sequence invocation creates nothing.
7. **MANUAL gate (M1 fix)** — a fully-completed MANUAL A-pass (distinct `*-MANUAL-POST-*` runIds) creates no claim or audit doc; only LIVE identities may claim the scheduled signoff.

## Usage

```bash
cd functions
npx ts-node -r tsconfig-paths/register -P scripts/tsconfig.json scripts/verify/ops-sms-alerts-208-post-a-signoff.ts
```

**Pass:** every `PASS:` line prints and the run ends with `=== All verification checks passed ===`.
**Fail:** a `FAIL:` line prints and the process exits 1.

## Data touched

| Doc | Written | Deleted |
|---|---|---|
| `realtime-runs/2099-01-05-MON-A-{DAILY,WEEKLY,MONTHLY}-LIVE-POST-1335` | yes (probe fields + messageSent flips) | yes |
| `realtime-runs/2099-01-06-TUE-A-{DAILY,WEEKLY,MONTHLY}-MANUAL-POST-1335` | yes (MANUAL-gate probes) | yes |
| `ops-alert-claims/signoff:post:2099-01-05:A` | yes (by real claim tx) | yes |
| `ops-alerts/signoff:post:2099-01-05:A` | yes (by real emitter) | yes |

The synthetic marketDates `2099-01-05`/`2099-01-06` cannot collide with real pipeline identities. All probe docs carry `probe: true, task: 208` for easy identification.

## Side effects & rerun notes

- The emit produces a real canonical `ops.alert` log line in prod logs. Once Task #211 wires a delivery route to that event, **running this script can send a real SMS** — check whether a consumer is live before rerunning.
- `alertKey` is deterministic for the marketDate, so an interrupted run can leave claim/audit docs behind; a clean rerun overwrites them harmlessly but leftover `opsSms.claimed` stamps on probe run docs are deleted with the docs in cleanup.
- If a rerun fails on the dedupe check, delete the three probe run docs + claim + audit docs manually and rerun fresh.
