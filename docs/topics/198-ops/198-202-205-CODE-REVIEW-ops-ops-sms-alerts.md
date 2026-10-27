**Topic:** Ops SMS Alerts  
**Topic Slug:** ops-sms-alerts  
**Thread:** Pipeline SMS Refresh  
**Thread Slug:** pipeline-sms-refresh  
**Issue:** #202  
**Task:** #205  
**Thread Parent:** #199  
**Topic Parent:** #198  
**Domain:** OPS  
**Type:** CODE-REVIEW  
**Status:** Complete  
**Created:** 2026-10-26  
**Last Updated:** 2026-10-26  

# Code Review — Task #205: Message composer — signoff + exception texts

## Scope

| File | Purpose |
|---|---|
| `functions/src/v2/common/ops-alerts/ops-alert.composer.ts` | Pure message formatters (3 exported functions + shared helpers) |
| `functions/tests/v2/common/ops-alerts/ops-alert-composer.test.ts` | 21 exact-string unit tests |
| `functions/scripts/verify/ops-sms-alerts-205-compose-texts.ts` / `.md` | Read-only verify script + guide |
| `functions/scripts/verify/run-all.ts`, `README.md` | Registration + index |

## Axes

### Standards

- File placement follows the `ops-alerts/` module seam from the IMPL doc; function names match the component table exactly (`composeIntradaySignoff`, `composePostSignoff`, `composeException`).
- Pure module — no imports, no I/O, no clock; fully deterministic.
- Verify artifacts complete per convention: script, guide, run-all entry (read-only tier), README index row + execution-order entry.
- **Nits (not blocking):** `failureTail`'s `docNoun` param is only ever `'run doc'`; intraday says "N failed permanently" while POST says "N failures total" (POST aggregates across intervals, so the different phrasing is defensible); the empty-intervals fallback still appends "Partner data-ready message sent." (impossible in practice — caller always passes the 3 A-pass intervals).

### Spec

Every acceptance criterion accounted for:

- Pure functions, all inputs injected — **met** (no Firestore, no clock).
- Exact-string unit tests for every message type: clean, partial-failure, edge — **met** (intraday ×7, POST ×5, exceptions ×5).
- Every message ≤ ~300 chars and legible without a legend — **met** (all composed texts 145–279 chars; verified live by the verify script).
- Graceful degradation on missing fields — **met** (counts → "not recorded", date → "unknown", duration clause omitted, empty intervals handled).
- TEST doc extras: no runIds/log jargon in signoff prose — asserted; large failure counts — asserted (113 within budget); zero jobs / 0% failures / missing duration — all covered. "Missing PDR time" is not a composer input (PDR confirmation is constant by design — emission happens post-publish).

### Thermo-nuclear

- Deep-ish leaf module: all phrasing/segment/charset policy hidden behind 3 call sites; callers in #207/#208/#210 need zero knowledge of SMS formatting.
- `failureCount` inference (created − success when `permanentFailureJobs` absent) is correct at terminal state and guarded against corruption (`Math.max(0,…)`).
- GSM-7-safe output is test-pinned (printable ASCII only) — prevents the UCS-2 segment-budget regression found in the second implementation pass.
- No structural findings.

## Findings

| Severity | Finding | Disposition |
|---|---|---|
| — | None (nits above are informational) | — |

A second implementation pass (pre-review) already found and fixed the two real issues: non-GSM-7 em dashes breaking the ~2-segment budget, and a malformed empty-`intervals` edge.

## Test results

- Composer suite: **21/21 pass**
- Full suite: **847/847 pass** (85 suites)
- `tsc --noEmit`: clean
- Verify script `ops-sms-alerts-205-compose-texts.ts`: **all checks passed** — prints every composed text with char counts for human readability review

## Second pass (post-review re-check)

Focused re-check of the final code for anything the first pass missed. Note: unlike Task #204, the fixes (GSM-7 charset, empty-intervals guard) landed *before* the gate, so all three axes already reviewed the shipped state — this pass hunted for overlooked edges only.

- `runLabel` precedence: `{sequence}` without `{interval}` falls through to the clockPt/fallback branches — graceful; watchdogs always pass both for POST. Nit, not a finding.
- `runId` injection in `pdr_missing` — repo-controlled ~25-char ids, cannot break the 300-char budget.
- `createdJobs: 0` intervals render `daily 0/0` — ugly but truthful; unreachable in practice (zero-work intervals aren't in the A-pass grid).
- Duration edge (`59s` → `1m 00s` boundary), corrupted counts (`success > created` → `Math.max(0,…)`), `NaN` inputs — all handled.
- `run-all.ts`/`README.md` coexist cleanly with concurrent Topic #213 additions.

**No new findings.**

## Verdict

**PASS** — all ACs met, three axes clean, second pass found nothing, tests green, verification green.
