**Topic:** Ops SMS Alerts  
**Topic Slug:** ops-sms-alerts  
**Thread:** Pipeline SMS Refresh  
**Thread Slug:** pipeline-sms-refresh  
**Issue:** #202  
**Task:** #206  
**Thread Parent:** #199  
**Topic Parent:** #198  
**Domain:** OPS  
**Type:** CODE-REVIEW  
**Status:** Complete  
**Created:** 2026-10-27  
**Last Updated:** 2026-10-27  

# Code Review — Task #206: Send-once guard for alert emission

## Scope

| File | Purpose |
|---|---|
| `functions/src/v2/common/ops-alerts/ops-alert.guard.ts` | `claimOpsAlert` — transactional send-once claim on `ops-alert-claims/{alertKey}` + optional run-doc stamp |
| `functions/src/v2/common/ops-alerts/ops-alert.types.ts` | Added shared `isValidAlertKey` (deduped from emitter/guard) |
| `functions/src/v2/common/ops-alerts/ops-alert.emitter.ts` | Adopted `isValidAlertKey` |
| `shared/firestore/firestore.ts` | `OPS_ALERT_CLAIMS` collection enum |
| `functions/tests/v2/common/ops-alerts/ops-alert-guard.test.ts` | 12 tests incl. concurrent-claim, no-fabrication, non-veto |
| `functions/scripts/verify/ops-sms-alerts-206-send-once-guard.ts` / `.md` | Mutating prod verify script + guide |
| `functions/scripts/verify/run-all.ts`, `README.md` | Registration + index |
| `docs/topics/198-ops/198-199-201-IMPL-…md` | Deviation documented on Design decision 5 |

## Axes

### Standards

Initial pass found two real contract-baseline problems, both remediated:

- **`runDocPath` was unvalidated** — an odd-segment path threw inside `db.doc()`, surfaced as `'error'`, and could veto the primary send-once claim over an observability-only parameter. → `isValidDocPath` pre-check; malformed paths log `ops.alert_stamp_skipped` (warn) and the claim still proceeds.
- **`tx.set(…, {merge:true})` fabricated stub run docs** — a missing run doc would be minted containing only `opsSms`, defeating every downstream `snap.exists` check (including the future `run_missing` detector). → `tx.get(runRef)` before any writes (Firestore requires reads-first anyway); stamp lands only on existing docs.

Also remediated: `alertKey` validation duplicated verbatim between emitter and guard → shared `isValidAlertKey` on `ops-alert.types.ts`; logger tag aligned to sibling `'opsAlert'`.

**Non-blocking:** zero production callers — expected staging (identical for the emitter at #204 and composer at #205; wired in #207/#208/#210). New `ops-alert-claims` collection is a per-alert marker — arguably borderline vs PRD's "no dedup infrastructure beyond per-run markers," but it IS the per-alert marker and the run-doc shape couldn't express it.

### Spec

All four acceptance criteria met at the guard seam:

- Transactional claim; concurrent attempts emit once — **met** (unit concurrent test + real-prod `Promise.all`×4 in the verify script).
- Second call returns "already sent" without emitting — **met** (`'already-claimed'`, zero writes).
- Additive, no migration, readers unaffected — **met** (new collection + optional `opsSms.claimed` map).
- Concurrent-claim test coverage — **met**.

**Deviation, resolved in spec's favor:** the spec locates the marker *on* the run doc (`opsSms.sentAt`). Authority moved to `ops-alert-claims/{alertKey}` because a single `sentAt` can't distinguish 4+ alert keys per run doc, and `run_missing` exceptions have no doc. The run-doc marker survives as the `opsSms.claimed[alertKey]` stamp. Documented on IMPL Design decision 5 with the rule: signoff call sites MUST pass `runDocPath`; exceptions only when the doc should exist.

**Deferred:** end-to-end "emit once" and the aggregator-level concurrent-completion race belong to the emission tasks (#207/#208).

### Thermo-nuclear

Verdict after remediation — **the design is the simplest correct model**:

- Claim-doc-as-authority confirmed correct: the judo alternative (marker on run doc only) fails `run_missing`; one uniform authority beats two mechanisms.
- `'error'` as a third return state confirmed right — callers must distinguish "suppressed by dedupe" (silent) from "suppressed by unprovable" (page-worthy).
- The MAJOR (phantom run-doc fabrication) was caught independently by both Standards and this axis and fixed identically.
- Remaining minors all fixed: stamp renamed `sent`→`claimed` (asserts claim intent, not delivery); `kind` made required; invalid-key log now carries the `alertKey` field; mock merge deepened to real nested-merge semantics; added tests for already-claimed-skips-stamp and two-keys-one-run-doc.

## Findings

| Severity | Finding | Disposition |
|---|---|---|
| Major | Unvalidated `runDocPath` could veto the claim via `db.doc` throw | Fixed — warn + skip, claim proceeds |
| Major | Merge-write fabricated stub run docs, breaking `snap.exists` checks | Fixed — `tx.get` first, stamp only existing docs |
| Minor | `opsSms.sent` claimed delivery before emission | Fixed — renamed `opsSms.claimed` |
| Minor | `kind` optional → `null` on authority docs | Fixed — required |
| Minor | Invalid-key log omitted `alertKey` field | Fixed — `key=` now logged |
| Minor | Shallow mock merge + missing edge tests | Fixed — deep merge + 3 new tests |
| Nit | alertKey has no length bound (doc-id limit ~1500 B) | Noted; keys are short enums, not user input |

## Test results

- Focused: `tests/v2/common/ops-alerts/` — **46/46** (12 guard tests post-remediation)
- Full suite: **893/893**, 88 suites
- `npx tsc --noEmit` — clean
- Live verify vs prod — all checks PASS incl. real 4-way concurrent claim, no-fabrication, and malformed-`runDocPath` non-veto (first run hit a transient OAuth token error; rerun green)

## Verdict

**PASS** — all major findings remediated and re-verified (unit + live prod). Ready for `/proj qa 198 206`.

---

## Second pass — final-state review (2026-10-27)

All three axes re-ran against the remediated final code (protocol: review the final diff, not patch history).

| Axis | Result |
|---|---|
| Standards | **PASS** — tx reads-before-writes verified legal on every path; emitter `isValidAlertKey` adoption proven behavior-identical; 2 doc-accuracy minors (below) |
| Spec | **PASS** — all 4 ACs still met; IMPL:51 deviation note verified accurate against the code |
| Thermo-nuclear | **REQUEST CHANGES → resolved** — 2 minors |

### Pass-2 findings and dispositions

| Severity | Finding | Disposition |
|---|---|---|
| Minor | `db.doc(runDocPath)` could still throw client-side (reserved ids / segment limits) → observability param vetoing the claim | Fixed — `runRef` construction moved inside the runDocPath try/catch → warn + drop; comment honestly notes server-side write rejects still fail closed |
| Minor | JSDoc on `runDocPath` still said `opsSms.sent[alertKey]` after rename | Fixed — `opsSms.claimed` |
| Minor | Verify `.md` listed 3 probe docs; script writes 5 and a mid-run failure leaves `:ghost`/`:badpath` residue undocumented | Fixed — full list + residue note |

New test added: SDK-rejected `runDocPath` (`db.doc` throws) cannot veto the claim. Suite now **14 tests**, all green; `tsc --noEmit` clean; live prod verify re-run green.

### Pass-2 judgement calls noted (not blocking)

- `kind` unvalidated at runtime — TS-only enforcement; consistent with emitter, fails closed.
- `alertKey` `.`/`..` passes `isValidAlertKey` → `tx.set` throws → fail-closed `'error'`. Acceptable.
- Mock `tx.set` mutates the store eagerly (real Firestore buffers to commit) and doesn't enforce reads-before-writes — a future regression could pass unit tests but throw in prod; mitigated by the live verify script exercising the real SDK.
- Date-keyed `ALERT_KEY` in the verify script: a same-day rerun after failure could hit `already-claimed` on "first claim". Manual script; cleanup path documented.

**No further passes needed** — pass 2 findings were confined to the remediation surface itself; the claim doc, tx structure, and API contract had zero findings across both passes.
