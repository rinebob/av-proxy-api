# UAT — Intraday Signoff Emission (3 ticks)

| Meta | Value |
|---|---|
| **Doc Type** | UAT |
| **Blueprint** | [#202 — Backend — Ops SMS Alerts — Pipeline SMS Refresh](../../issues/202) |
| **Issue** | [#234 — QA: Intraday signoff emission — 3 ticks](../../issues/234) |
| **Task** | [#207 — Intraday signoff emission — 3 ticks](../../issues/207) |
| **Topic** | [#198 — Ops SMS Alerts](../../issues/198) |
| **Topic Parent** | #198 |
| **Topic Slug** | ops-sms-alerts |
| **Type** | UAT |
| **Status** | Complete |
| **Created** | 2026-10-28 |
| **Last Updated** | 2026-10-28 |

## Scope

Task #207 emits exactly one routine signoff alert per intraday tick (`0800`, `1000`, `1200` PT), immediately after that tick's PDR publish succeeds, on both the fast-completion and reconcile-completion paths. The signoff composes via `composeIntradaySignoff` (Task #205), claims exactly-once via the transactional guard (Task #206), and emits through the canonical `ops.alert` line + `ops-alerts` audit doc (Task #204). A `claim-error` path fails closed — the pipeline run itself can never be failed by signoff machinery.

**Out of scope:** POST final signoff (#208, planned), watchdog exception alerts (#210, planned), SMS delivery (#211, planned).

## Prerequisites

- Firebase Admin credentials with access to prod project `alpha-vantage-proxy-api` (ADC or service-account key per `scripts/verify/README.md`).
- `cd functions && npm install` completed.
- The verify script mutates production collections (`av-intraday-archive-meta`, `ops-alert-claims`, `ops-alerts`) — it uses only `verify-207-*` / `verify-207-{date}` doc IDs, creates `999-test-run`s, and cleans them up on exit.

## Start instructions

```bash
cd functions
npx ts-node -r tsconfig-paths/register -P scripts/tsconfig.json scripts/verify/ops-sms-alerts-207-intraday-signoff.ts
```

Full script contract: `functions/scripts/verify/ops-sms-alerts-207-intraday-signoff.md`. This script is **mutating** — it is excluded from `scripts/verify/run-all.ts` and must be invoked explicitly.

## Scenarios

### 1. Tick signoff claim + emit (production Firestore)

- **Confirms:** the complete signoff path end-to-end — claim transaction, canonical `ops.alert` emission, audit doc, run-doc stamp.
- **Start state:** no `ops-alert-claims/signoff:intraday:verify-207-{today}:0800` doc.
- **Steps:** run the start command above.
- **Expected:** 18 checks all PASS — claim doc created with `kind: "signoff"` and correct `runId`/`marketDate`/`claimedAt`; audit doc created with `smsText` naming the tick, market date, refreshed counts, and PDR confirmation; `emittedAt` stamped; the probe run doc carries `opsSms.claimed[alertKey]`; merge-write preserved pre-existing run-doc fields.
- **Result:** PASS — 18/18 checks, 2026-10-28 (second run, post-review remediation).

### 2. Exactly-once under re-invocation

- **Confirms:** duplicate invocations of `emitIntradayTickSignoff` for the same tick produce no second emit.
- **Steps:** same run — the script re-invokes the helper after the first emit and re-reads the audit doc.
- **Expected:** second invocation is a logged no-op (`already-claimed`); `ops-alerts/{key}.emittedAt` unchanged.
- **Result:** PASS — `second invocation did not re-emit` check green.

### 3. Non-tick gate

- **Confirms:** a publish carrying a `clockPt` outside `INTRADAY_SIGNOFF_TICKS` (heartbeat, manual, dev clock like `0947`) creates nothing.
- **Steps:** same run — script invokes with `clockPt: "0947"` and asserts absence.
- **Expected:** no claim doc, no audit doc for `signoff:intraday:verify-207-{date}:0947`.
- **Result:** PASS — both absence checks green.

### 4. Fail-closed and failure isolation (unit)

- **Confirms:** claim errors suppress emission and never throw; emit errors never propagate to the pipeline job.
- **Steps:** `cd functions && npx jest tests/v2/alpha-vantage/jobs/ --runInBand`
- **Expected:** all 23 tests pass — claim-before-emit ordering, `claim-error`/`already-claimed` no-ops, emit-rejection swallowed, non-tick gating, `didComplete=false` race, fast/reconcile PDR-failure suppression, `failedSymbols` in context but never in `smsText`.
- **Result:** PASS — 23/23 focused; 944/944 full suite.

### 5. Both completion paths

- **Confirms:** fast-path completion (last job doc written → immediate COMPLETE) and reconcile-path completion (queued-emptied reconcile → COMPLETE) each emit at most once and share the claim key.
- **Steps:** unit suite aggregator tests (`emits signoff on fast-path completion`, `emits signoff on reconcile completion with post-reconcile data`, `suppresses signoff when fast-path publish fails`, `suppresses signoff when reconcile-path publish fails`, `does not emit when run already complete`, `does not emit while jobs in flight`, `does not emit when completeRun reports didComplete=false`).
- **Expected:** one emit per completion path; zero on `didComplete=false`, already-complete, or in-flight states.
- **Result:** PASS.

## Negative / edge coverage

| Case | Covered by | Result |
|---|---|---|
| Re-invocation duplicate | Scenario 2 | PASS |
| Non-tick clockPt | Scenario 3 | PASS |
| Claim throws | Unit `claim-error` tests | PASS — no emit, no throw |
| Emit rejects | Unit `emit-rejection` test | PASS — job unaffected |
| PDR publish throws | Unit fast + reconcile tests | PASS — no signoff attempted |
| `didComplete=false` (completion race) | Unit race test | PASS — no emit |
| Failed-symbol list in SMS | Unit + prod audit read | PASS — symbols in context/run doc only |

## Traceability

| Acceptance criterion | Scenario(s) |
|---|---|
| One signoff per tick, only after PDR publish succeeds | 1, 4, 5 |
| Text carries tick, market date, counts, duration, PDR confirmation | 1 (audit `smsText`), 4 |
| Non-tick publishes emit nothing | 3, 4 |
| Emission/claim failure never fails the pipeline job | 4 |
| Failed-symbol list logged/audited, absent from SMS | 1, 4 |
| Exactly-once across fast/reconcile/redelivery | 2, 5 |
| Self-healing FAILED republish carries no routine signoff | Unit (deliberately unwired; watchdog exception path is #210) |

## Regression / smoke checklist

- [x] Aggregator suite regression-free — 8/8 PASS
- [x] Full functions suite — 944/944 PASS, `tsc --noEmit` clean
- [x] Mutating script excluded from `run-all.ts`; registered in `scripts/verify/README.md`
- [x] Signoff emission is post-publish and awaited — cannot outlive the GCF invocation

## Findings

None. (Bug #235 — pre-existing premature-completion race in the shared aggregator — is tracked separately; it affects pipeline correctness, not this task's acceptance criteria, and was dispositioned during review.)
