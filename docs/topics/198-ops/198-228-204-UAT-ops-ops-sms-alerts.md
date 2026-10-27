**Topic:** Ops SMS Alerts  
**Topic Slug:** ops-sms-alerts  
**Thread:** Pipeline SMS Refresh  
**Thread Slug:** pipeline-sms-refresh  
**Issue:** #228  
**Task:** #204  
**Thread Parent:** #199  
**Topic Parent:** #198  
**Domain:** OPS  
**Type:** UAT  
**Status:** Complete  
**Created:** 2026-10-25  
**Last Updated:** 2026-10-25  

# UAT — Task #204: Canonical alert event + fail-safe emitter

## Scope

BE module only — the `ops-alerts` canonical event seam (`OpsAlertEvent` + `emitOpsAlert`). No UI, no pipeline call sites yet (those land in #207/#208/#210). Acceptance is: canonical log emission, audit-doc persistence + dedupe, fail-safe contract.

## Prerequisites

- `gcloud`/`firebase` ADC authenticated (for the prod verify script)
- `cd functions && npm run copy-shared` if shared/ changed (it did — `OPS_ALERTS` enum member added)

## Test scenarios

### 1. Unit test suite for the emitter

- **Confirms:** AC1, AC3, AC4 (log line, never-throws, test coverage).
- **Steps:**
  ```bash
  cd functions && npx jest tests/v2/common/ops-alerts/ops-alert-emitter.test.ts
  ```
- **Expected:** 12/12 tests pass — canonical line content (smsText, `key=`, `ctx=`, runId, mktDate, level), audit doc fields + dedupe, audit-failure swallow, invalid-input rejections, circular-context survival, whitespace collapse.
- **Result:** **PASS** — 12/12 (2026-10-25).

### 2. Typecheck + full suite regression

- **Confirms:** shared enum + `betterLogger` extension (`alertKey`, `ctx`) break nothing elsewhere.
- **Steps:**
  ```bash
  cd functions && npx tsc --noEmit && npx jest
  ```
- **Expected:** typecheck clean; all suites pass.
- **Result:** **PASS** — tsc clean; 826/826 tests across 84 suites (2026-10-25).

### 3. Real-environment emission + audit persistence

- **Confirms:** AC1 + AC2 against prod (not mocks).
- **Steps:**
  ```bash
  cd functions
  npx ts-node -r tsconfig-paths/register -P scripts/tsconfig.json scripts/verify/ops-sms-alerts-204-emit-alert.ts
  ```
- **Expected:** `event=ops.alert` line with complete smsText + `key=`/`ctx=`; audit doc at `ops-alerts/verify:ops-204:{date}` with all fields; re-emit overwrites same doc; probe deleted; ends `=== All verification checks passed ===`.
- **Result:** **PASS** — ran 2026-10-25, all checks green on final code. (An earlier transient ADC token failure mid-run also demonstrated the fail-safe contract live: audit write failed → `ops.alert_emit_failed` logged, no throw.)

### 4. Audit-doc collection existence in prod

- **Confirms:** `ops-alerts` collection reachable/writeable in prod Firestore.
- **Steps:** covered by scenario 3 (doc write + read-back + delete succeeded against prod).
- **Result:** **PASS.**

### 5. Grep-ability of hard-down vs routine alerts

- **Confirms:** design requirement — exceptions greppable apart from signoffs.
- **Steps:** `event=ops.alert level=error` selects exceptions; `event=ops.alert level=info` selects signoffs; `event=ops.alert_emit_failed` catches emit-path failures (validation + internal errors, unified at error level).
- **Result:** **PASS** — covered by unit test asserting `level=error` on exception kind; verified in prod output.

## Traceability

| Acceptance criterion | Scenario(s) |
|---|---|
| Canonical `ops.alert` log containing complete `smsText` | 1, 3 |
| Audit record for dedupe/observability | 1, 3, 4 |
| Emitter failure logged, never propagates | 1, 3 (live demonstration) |
| Unit tests cover the above | 1, 2 |

## Regression / smoke

- `betterLogger` extension is additive-optional; every existing caller unaffected — proven by full-suite green (scenario 2).
- `OPS_ALERTS` enum addition is append-only; shared rebuilt + copied (`npm run copy-shared`).

## Findings

None.
