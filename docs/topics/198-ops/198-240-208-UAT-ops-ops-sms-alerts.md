# UAT — POST-A Last-Interval Signoff Emission

| Meta | Value |
|---|---|
| **Doc Type** | UAT |
| **Blueprint** | [#202 — Backend — Ops SMS Alerts — Pipeline SMS Refresh](../../issues/202) |
| **Issue** | [#240 — QA: POST-A last-interval signoff emission](../../issues/240) |
| **Task** | [#208 — POST-A last-interval signoff emission](../../issues/208) |
| **Topic** | [#198 — Ops SMS Alerts](../../issues/198) |
| **Topic Parent** | #198 |
| **Topic Slug** | ops-sms-alerts |
| **Type** | UAT |
| **Status** | Complete |
| **Created** | 2026-10-29 |
| **Last Updated** | 2026-10-29 |

## Scope

Task #208 emits exactly one routine signoff alert per trading day after the **POST-A** run — "our work is done for that run." When the last of the three A-pass intervals (DAILY, WEEKLY, MONTHLY) writes `partnerDataReady.messageSent`, `emitPostASignoff` reconstructs the two sibling runIds, requires all three `messageSent === true`, claims `signoff:post:{marketDate}:A` transactionally, and emits `composePostSignoff` through the canonical emitter. Wired into both aggregator completion paths (fast + reconcile). B/C retry passes and MANUAL A-passes emit nothing — hard-down conditions are watchdog territory (#210).

**Out of scope:** B/C watchdog coverage (#209), watchdog canonical events (#210), SMS delivery (#211), legacy cutover (#212).

## Prerequisites

- Firebase Admin credentials with access to prod project `alpha-vantage-proxy-api` (ADC or service-account key per `scripts/verify/README.md`).
- `cd functions && npm install` completed.
- The verify script mutates production collections (`realtime-runs`, `ops-alert-claims`, `ops-alerts`) — it uses only synthetic `2099-01-05`/`2099-01-06` marketDate probe docs and cleans them up on exit.

## Start instructions

```bash
cd functions
npx ts-node -r tsconfig-paths/register -P scripts/tsconfig.json scripts/verify/ops-sms-alerts-208-post-a-signoff.ts
```

Full script contract: `functions/scripts/verify/ops-sms-alerts-208-post-a-signoff.md`. This script is **mutating** — it is excluded from `scripts/verify/run-all.ts` and must be invoked explicitly.

## Scenarios

### 1. Partial completion emits nothing (production Firestore)

- **Confirms:** with 2/3 sibling `partnerDataReady.messageSent` true, the helper logs `post.signoff_pending` and creates no claim doc.
- **Start state:** three probe sibling docs seeded; DAILY + WEEKLY `messageSent: true`, MONTHLY false; no `ops-alert-claims/signoff:post:2099-01-05:A`.
- **Steps:** run the start command — the script invokes `emitPostASignoff` with the DAILY runId.
- **Expected:** zero claim/audit docs while any sibling PDR is pending.
- **Result:** PASS — `no claim doc while a sibling PDR is pending`, 2026-10-29.

### 2. Last-interval completion claims + emits exactly once

- **Confirms:** the full gate — claim transaction, canonical `ops.alert` emission, audit doc, run-doc stamp.
- **Steps:** same run — the script flips MONTHLY `messageSent` true, invokes the helper with the MONTHLY runId, reads claim + audit docs.
- **Expected:** claim doc `kind: "signoff"` with `runId` = last-finishing MONTHLY run + `claimedAt`; audit `smsText` names the POST A signoff, market date, `daily 9/10`-style per-interval counts, "All 3 partner data-ready messages sent"; failed symbols (`ZZTEST`) in `context.failedSymbols` only; triggering run doc carries `opsSms.claimed[alertKey]`.
- **Result:** PASS — 12/12 checks green.

### 3. Concurrent/redelivery dedupe

- **Confirms:** a second invocation from a different sibling runId (cross-interval contention) cannot double-emit — the claim key resolves it.
- **Steps:** same run — re-invokes with the WEEKLY runId; re-reads the audit doc.
- **Expected:** `post.signoff_skipped reason=already-claimed` logged; `emittedAt` unchanged.
- **Result:** PASS.

### 4. B/C + MANUAL gates (production Firestore)

- **Confirms:** retry sequences and manual passes are non-routine — no signoff key is ever claimed for them. MANUAL is the M1 remediation: a completed manual A-pass has all siblings sent but a `MANUAL` runId identity and must produce nothing.
- **Steps:** same run — (a) invokes with `sequence: 'B'` + retry runType, asserts no `signoff:post:{date}:B` claim; (b) seeds three all-sent MANUAL siblings on `2099-01-06`, invokes with the MANUAL runId, asserts no claim and no audit doc.
- **Expected:** zero writes on both paths.
- **Result:** PASS — `no claim doc for sequence B`, `MANUAL A-pass created no claim doc`, `MANUAL A-pass created no audit doc`.

### 5. Fail-closed, failure isolation, both completion paths (unit)

- **Confirms:** claim errors suppress emission and never throw; emit/claim/read rejections never reach the pipeline job; fast-path and reconcile-path both emit at most once.
- **Steps:** `cd functions && npx jest tests/v2/alpha-vantage/jobs/ --silent`
- **Expected:** all 51 tests pass — all-three gate ordering, claim-before-emit, `already-claimed`/`claim-error` no-ops, unparseable + MANUAL + B/C + wrong-runType + spoofed-doc-field runIds, pending sibling no-op, missing-sibling no-op, fail-safe rejections, reconcile `permanentFailureSymbols` write + ordering, `didComplete=false` race, publish-failure suppression.
- **Result:** PASS — 51/51 (4 suites), 2026-10-29.

## Negative / edge coverage

| Case | Covered by | Result |
|---|---|---|
| 1–2 intervals complete | Scenario 1 | PASS |
| Cross-sibling redelivery dedupe | Scenario 3 | PASS |
| B/C retry completion | Scenario 4a + unit | PASS |
| MANUAL A-pass (M1) | Scenario 4b + unit | PASS |
| Spoofed doc fields (B-doc claiming A key) | Unit `spoofed-doc-fields` | PASS — runId authoritative |
| Unparseable runId | Unit | PASS — logged, no-op |
| Missing sibling doc | Unit | PASS — pending no-op |
| Sibling-read / claim / emit rejection | Unit | PASS — swallowed, job unaffected |
| `didComplete=false` completion race | Unit | PASS — no emit |
| PDR publish or messageSent-write failure | Unit fast + reconcile | PASS — signoff unreachable (in `catch` boundary) |
| Failed-symbol list in SMS | Scenario 2 + unit | PASS — context/run doc only |

## Traceability

| Acceptance criterion | Scenario(s) |
|---|---|
| Exactly one POST-A signoff, only after all 3 interval PDRs sent | 1, 2, 5 |
| Partial completion (1–2 intervals) emits nothing | 1, 5 |
| Covered on both fast path and reconcile path | 5 |
| B and C sequence completions emit no signoff | 4a, 5 |
| Concurrent interval completion cannot double-emit | 3, 5 |
| (Remediation) MANUAL A-pass cannot claim the scheduled key | 4b, 5 |

## Regression / smoke checklist

- [x] Aggregator + signoff suites regression-free — 51/51 PASS
- [x] Full functions suite — 987/987 PASS, `tsc --noEmit` clean (post-remediation)
- [x] Mutating script excluded from `run-all.ts`; registered in `scripts/verify/README.md`
- [x] Emission awaited inside the completion `try` — cannot outlive the invocation or break the PDR write
- [x] Prod verify re-run post-remediation — 18/18 (extended with MANUAL gate)

## Findings

None. Deferred-by-design items are tracked elsewhere: missing-signoff watchdog coverage is Task #210 scope; `messageSent`-write-failure after a successful PDR is a pre-existing ordering hole noted in the review; sibling-counts TOCTOU is a consequence of Bug #235 (premature-completion race).
