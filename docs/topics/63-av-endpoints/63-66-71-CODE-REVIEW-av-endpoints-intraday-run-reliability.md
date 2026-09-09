**Topic:** Fix Intraday PRE Delivery Reliability  
**Topic Slug:** intraday-run-reliability  
**Issue:** #66  
**Task:** #71  
**Topic Parent:** #63  
**Domain:** AV-ENDPOINTS  
**Type:** Code Review  
**Status:** Complete  
**Created:** 2026-09-09  
**Last Updated:** 2026-09-09  

## Summary

Task #71 adds `FAILED = 'failed'` to the `PartnerRunStatus` enum and updates `validateDataReadyPayload` to accept `runStatus: 'failed'`. This value will be used by the self-healing path (task #73) to signal that a stale run failed, not completed with errors. 7 unit tests cover the enum value and schema validation.

## Standards

- File size: `constants.ts` is 96 lines, `data-ready.schema.ts` is 253 lines — both within limits.
- Single responsibility: the enum change is a one-line addition in the right place. The schema change updates the type union and the allowed-values array in the validator.
- No duplication: the `allowedRunStatuses` array in the validator is the only place that lists the string literals (besides the enum itself). The type union on the interface is updated to match.
- No dead code: `FAILED` will be consumed by task #73 (self-healing). Not dead yet.
- Consistent patterns: the enum addition follows the existing pattern. The schema update follows the existing pattern for `allowedRunStatuses`.
- Clean type contracts: the `runStatus` field type union now includes `'failed'`, matching the enum value.
- Security defaults: N/A.

No Standards findings.

## Spec

Acceptance criteria from task #71:

- [x] `PartnerRunStatus.FAILED` exists with value `'failed'` — **met** (line 80 of `constants.ts`)
- [x] `validateDataReadyPayload` accepts a payload with `runStatus: 'failed'` — **met** (line 148-151 of `data-ready.schema.ts`, test confirms)
- [x] Build passes — **met**

Test plan coverage:
- `PartnerRunStatus.FAILED` is a valid enum value — **met** (2 tests)
- PDR payload with `runStatus: FAILED` is accepted by `validateDataReadyPayload` — **met** (1 test + 3 regression tests for existing values + 1 negative test)

No Spec findings.

## Thermo-nuclear

- Abstraction quality: N/A — small enum extension, no new abstraction.
- File size: fine.
- Spaghetti detection: N/A — no new code paths.
- Code judo: the `FAILED` status is a good addition — it distinguishes "stale run that never completed" from "completed with errors", which is semantically different and important for the self-healing path.
- Test quality: tests verify external behavior (enum value, schema acceptance/rejection). No implementation detail testing.
- Edge cases: regression tests confirm existing values still work. Negative test confirms invalid values still rejected.

No Thermo-nuclear findings.

## Test results

- Unit tests: 7/7 passed
- Build: PASS

## Verdict: PASS

No critical, major, or minor findings. All acceptance criteria met. Build and tests pass.
