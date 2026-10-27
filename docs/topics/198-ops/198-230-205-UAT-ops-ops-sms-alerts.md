**Topic:** Ops SMS Alerts  
**Topic Slug:** ops-sms-alerts  
**Thread:** Pipeline SMS Refresh  
**Thread Slug:** pipeline-sms-refresh  
**Issue:** #230  
**Task:** #205  
**Thread Parent:** #199  
**Topic Parent:** #198  
**Domain:** OPS  
**Type:** UAT  
**Status:** Complete  
**Created:** 2026-10-26  
**Last Updated:** 2026-10-26  

# UAT — Task #205: Message composer — signoff + exception texts

## Scope

BE pure functions only — `ops-alert.composer.ts` (`composeIntradaySignoff`, `composePostSignoff`, `composeException`). No UI, no pipeline call sites yet (wired in #207/#208/#210). Acceptance is message content correctness, SMS budget/charset safety, and graceful degradation.

## Prerequisites

None — pure functions, no credentials or environment needed.

## Test scenarios

### 1. Unit test suite for the composer

- **Confirms:** all 4 ACs (pure, exact-string coverage, ≤ ~300 chars, graceful degradation).
- **Steps:** `cd functions && npx jest tests/v2/common/ops-alerts/ops-alert-composer.test.ts`
- **Expected:** 21/21 pass — intraday ×7, POST ×5, exceptions ×5, budget/charset/jargon ×4.
- **Result:** **PASS** — 21/21 (2026-10-26).

### 2. Typecheck + full suite regression

- **Confirms:** new module doesn't break the suite.
- **Steps:** `cd functions && npx tsc --noEmit && npx jest`
- **Result:** **PASS** — tsc clean; 847/847 tests, 85 suites (2026-10-26).

### 3. Composed texts — real output readability

- **Confirms:** texts are verbose-readable prose an operator can parse without a legend.
- **Steps:** `cd functions && npx ts-node -r tsconfig-paths/register -P scripts/tsconfig.json scripts/verify/ops-sms-alerts-205-compose-texts.ts`
- **Expected:** every message type printed with char count; all `PASS:` lines; ends `=== All verification checks passed ===`.
- **Result:** **PASS** — 31 checks passed; all texts 145–279 chars. Sample outputs reviewed for readability (2026-10-26):

```
Savant pipeline signoff: intraday 1000 PT run finished for market date 2026-10-23.
Refreshed 40 of 42 symbols in 4m 05s - 2 failed permanently; failed symbols are
listed in the run doc and logs. Partner data-ready message sent.

Savant pipeline ALERT: the POST C MONTHLY run for market date 2026-10-23 finished
but its partner data-ready message was never sent. Run doc rt-2026-10-23-c-monthly
has details. Needs attention.
```

### 4. GSM-7 charset safety (segment budget)

- **Confirms:** texts encode as GSM-7 (~160 chars/segment), not UCS-2 (~70 chars/segment).
- **Steps:** unit test asserting every composed text is printable ASCII (`/^[\x20-\x7E]+$/`).
- **Result:** **PASS** — caught the em-dash regression in implementation; now test-pinned.

### 5. Failed symbols as counts only

- **Confirms:** PRD requirement — symbol names never appear in SMS text.
- **Steps:** code has no symbol-list input field at all; failure phrasing is `N failed permanently; failed symbols are listed in the run doc and logs`.
- **Result:** **PASS.**

## Traceability

| Acceptance criterion | Scenario(s) |
|---|---|
| Pure functions — all inputs injected | 1 (module has zero imports/IO) |
| Exact-string tests per type: clean/partial/edge | 1, 3 |
| ≤ ~300 chars, legible without a legend | 1, 3, 4 |
| Graceful degradation — no undefined/NaN | 1, 3 |

## Regression / smoke

- Composer is a new leaf module; nothing calls it yet — zero blast radius. Full suite green (scenario 2).

## Findings

None.
