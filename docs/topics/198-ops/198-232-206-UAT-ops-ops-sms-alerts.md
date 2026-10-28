**Topic:** Ops SMS Alerts  
**Topic Slug:** ops-sms-alerts  
**Thread:** Pipeline SMS Refresh  
**Thread Slug:** pipeline-sms-refresh  
**Issue:** #232  
**Task:** #206  
**Thread Parent:** #199  
**Topic Parent:** #198  
**Domain:** OPS  
**Type:** UAT  
**Status:** Complete  
**Created:** 2026-10-28  
**Last Updated:** 2026-10-28  

# UAT — Task #206: Send-once guard for alert emission

## Scope

`claimOpsAlert` (`functions/src/v2/common/ops-alerts/ops-alert.guard.ts`) — the
transactional send-once seam every signoff/exception call site will invoke
before `emitOpsAlert`. Claims `ops-alert-claims/{alertKey}` as the dedupe
authority; optionally stamps `opsSms.claimed[alertKey]` on an existing run doc.
Fail-closed on transaction error: callers must not emit on `'error'`.

Acceptance criteria under test:

- Marker claimed inside a Firestore transaction — concurrent attempts emit exactly one alert
- Second/subsequent calls return "already sent" without emitting
- Marker is additive; no schema migration, existing readers unaffected
- Unit/integration tests cover the concurrent-claim case

## Prerequisites

- Repo at the #206 working state (guard + tests + verify script present)
- `npm run build:shared && cd functions && npm run copy-shared` after any `shared/` change
- Application Default Credentials with Firestore access for the live verify
  script (the project has a single environment — the script writes + deletes
  `verify:`-prefixed probe docs in prod)

## Scenarios

### 1. Unit suite — claim / dedupe / concurrency (mocked Firestore)

```bash
cd functions
npx jest tests/v2/common/ops-alerts/ops-alert-guard.test.ts
```

Expected: **14/14 pass**, covering first-claim, already-claimed (zero writes),
independent keys, run-doc stamp on existing doc, nested-merge coexistence of
two stamps, no run-doc fabrication, malformed + SDK-rejected `runDocPath`
non-veto, concurrent claim → one winner, `/`-key and empty-key rejection,
fail-closed tx error.

**Result: PASS** — 14/14.

### 2. Full regression — no blast radius

```bash
cd functions && npx jest
cd functions && npx tsc --noEmit
```

Expected: full suite green; typecheck clean. **Result: PASS** — 893/893
tests, 88 suites; tsc clean. Emitter tests confirm `isValidAlertKey` adoption
is behavior-identical.

### 3. Live prod verify — real transaction semantics

```bash
cd functions
npx ts-node -r tsconfig-paths/register -P scripts/tsconfig.json scripts/verify/ops-sms-alerts-206-send-once-guard.ts
```

Expected `PASS:` on every check: first claim `claimed`; second `already-claimed`;
claim doc read-back (`alertKey`, `kind`, `runId`, `marketDate`, `claimedAt`);
`opsSms.claimed[alertKey]` stamp on the seeded run doc with pre-existing
fields preserved; **real** `Promise.all`×4 concurrency → exactly one winner;
absent run doc not fabricated; malformed `runDocPath` still `claimed`;
`/` alertKey → `error`; probe cleanup. Ends `=== All verification checks
passed ===`.

**Result: PASS** — all 18 checks green (2026-10-28 run; one transient OAuth
token error on an earlier attempt, retried green — environmental, not the
code under test).

### 4. Additive / no-migration check

New collection `ops-alert-claims` + optional nested `opsSms.claimed` map —
no changes to existing doc shapes or readers. `OPS_ALERT_CLAIMS` added to the
single-source `FirestoreCollection` enum.

**Result: PASS** — verified by code review and the run-doc merge-preservation
check in scenario 3.

## Refinement pass

Not applicable — no user-facing surface. Operator-facing observability
covered instead: claim doc field names and `opsSms.claimed` stamp shape were
reviewed for Firestore-console readability (`key=` correlates to the
`ops-alerts` audit doc and canonical log line).

## Traceability

| Acceptance criterion | Scenario |
|---|---|
| Transactional claim; concurrent → one alert | 1 (concurrent test), 3 (real Promise.all×4) |
| Second call "already sent", no emit | 1 (zero-writes test), 3 (re-claim) |
| Additive; no migration; readers unaffected | 3 (merge preserves fields), 4 |
| Concurrent-claim test coverage | 1, 3 |

## Findings

None. Two majors + five minors found and remediated during `/proj review`
(two passes — see `198-202-206-CODE-REVIEW-ops-ops-sms-alerts.md`); nothing
outstanding.

## Verdict: PASS

Ship-eligible — `/proj ship 198 206`.
