**Topic:** Ops SMS Alerts  
**Topic Slug:** ops-sms-alerts  
**Thread:** Pipeline SMS Refresh  
**Thread Slug:** pipeline-sms-refresh  
**Issue:** #202  
**Task:** #204  
**Thread Parent:** #199  
**Topic Parent:** #198  
**Domain:** OPS  
**Type:** Code Review  
**Status:** Final  
**Created:** 2026-10-25  
**Last Updated:** 2026-10-25  

# Code Review — Task #204: Canonical alert event + fail-safe emitter

Three-axis review (Standards / Spec / Thermo-nuclear, parallel sub-agents). Findings were remediated inline during this review and re-verified; none remain open.

## Standards

**Hard violations found — both fixed:**
- Verify script ended with non-standard `ALL CHECKS PASSED` → now `=== All verification checks passed ===` (matches all ~20 prior scripts).
- `scripts/verify/README.md` "Scripts by task" table missing the #204 row → added.

**Judgement calls — fixed:** dead `mockDocGet` removed; duplicated emit payload in verify script hoisted to `baseEvent`; `alertKey` now validated for `/` (would have produced an odd-segment `db.doc()` path → silent audit-doc loss).

**Clean:** `db.doc('ops-alerts/{key}')` parity correct; `FieldValue.serverTimestamp()` + `.set()` match repo prior art; `OPS_ALERTS` enum placement correct; mock surface covers the service's entire SDK use, complemented by the prod verification script.

## Spec

**AC1 (canonical `ops.alert` log carrying smsText + context) — was PARTIAL, now MET.** The log initially carried smsText/runId/marketDate but omitted `context` **and `alertKey`** — meaning the line couldn't be correlated to its audit doc. Fixed: `BetterLogPayload` gained optional `alertKey` (`key=`) and `ctx` (`ctx=`, pre-serialized JSON) fields; emitter passes both. Verified live in prod output.

**AC2 (audit record for dedupe/observability) — MET.** `ops-alerts/{alertKey}` with full payload + `emittedAt`; deterministic id = overwrite dedupe.

**AC3 (never throws) — MET.** Whole body in try/catch; null event safe via `?.`; `/`-in-alertKey rejected before `db.doc()`; undefined context values stripped; circular/BigInt context safe-stringified so the canonical line (and smsText) survives.

**AC4 (tests) — MET.** 12 tests; previously-under-asserting `event=ops.alert` substring (matched `ops.alert_emit_failed`) tightened to `event=ops.alert `; invalid-input paths now covered.

**No scope creep** — error-level logging for exceptions is justified by the hard-down/routine greppability requirement.

## Thermo-Nuclear

Verdict from axis: "small, correct, and honest — near simplest form; no judo deletion available, no structural regression."

**Should-fixes — both fixed:**
- `JSON.stringify(context)` inline in the log call could throw before the canonical line → safe-stringify returns `[unserializable context]`.
- Contract-test gaps (null event, missing smsText/alertKey, circular context) → added.

**Nits — fixed:** `context` field renamed `ctx` + JSDoc (pre-serialized contract); smsText whitespace collapsed in the log line (newline would split the greppable line); validation path unified to `level=error` with clearer null-event message. **Accepted as-is:** shallow context sanitize (deeper nesting still fails safe — comment softened).

## Test results

- `ops-alert-emitter.test.ts`: **12/12 pass**
- Full suite: **826/826 (84 suites)**; `npx tsc --noEmit` clean
- Prod verification `ops-sms-alerts-204-emit-alert.ts`: **all checks passed** — canonical line with `key=`/`ctx=` observed in prod output, audit doc persisted, dedupe overwrite confirmed, probe deleted. (One transient ADC token-refresh failure mid-run also accidentally proved the fail-safe contract live: audit write failed → `ops.alert_emit_failed` logged, pipeline continued.)

## Findings by severity

- Critical: none.
- Major: none remaining (context+alertKey absent from log — fixed).
- Minor: none remaining.
- Nit: none remaining.

## Second pass (post-remediation re-review)

Focused re-review of the final delta (safe-stringify, `ctx` rename, severity unification, whitespace collapse, 5 new tests) — requested to confirm nothing new was introduced by the fixes themselves.

- `ctx` rename consistent across `BetterLogPayload`, `betterLogger` render, emitter call site, and test assertions — no stale references.
- Validation short-circuit order correct (null event cannot reach `.includes`); rejection message precedence correct.
- Whitespace collapse applies only to the logged `message=`; the audit doc stores `smsText` verbatim — deliberate.
- Circular-context edge: canonical line emits with `ctx=[unserializable context]`; audit `.set()` may still throw → caught → `ops.alert_emit_failed`. Log + error visibility preserved; acceptable per fail-safe contract (documented: deeper failures fall to the catch).
- **No new findings.**

## Verdict

**PASS** — all ACs met, three axes clean after inline remediation, second pass found nothing, tests green, real-environment verification green.
