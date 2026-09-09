**Topic:** Fix Intraday PRE Delivery Reliability  
**Topic Slug:** intraday-run-reliability  
**Issue:** #67  
**Task:** #68  
**Topic Parent:** #63  
**Domain:** AV-ENDPOINTS  
**Type:** Code Review  
**Status:** Complete  
**Created:** 2026-09-09  
**Last Updated:** 2026-09-09  

## Summary

Task #68 is a SHARED CHORE: move `market-holidays.data.ts` from `partner/` to `common/market-calendar/` and update the one import in `partner/market-holidays-partner.ts`. No content changes to the data file.

## Standards

- File size: `market-holidays.data.ts` is 77 lines, well within limits. No change in size — file was moved verbatim.
- Single responsibility: the data file exports holiday data and one accessor function. Clean.
- No duplication: the move eliminates the `partner/` location; no duplicate remains.
- No dead code: the old file was removed, not left as a stale copy.
- Consistent patterns: the new location `common/market-calendar/` follows the existing `common/` convention.
- Import path in `market-holidays-partner.ts` updated from `./market-holidays.data` to `../common/market-calendar/market-holidays.data` — correct relative path.
- Verification script follows existing convention (`scripts/verify/` directory, `assert` pattern, per-task `.md` guide, `run-all.ts` updated).

No Standards findings.

## Spec

Acceptance criteria from task #68:

- [x] `functions/src/v2/common/market-calendar/market-holidays.data.ts` exists with the same content as the old location — **met** (verified by build + verification script)
- [x] `functions/src/v2/partner/market-holidays-partner.ts` imports from the new path — **met** (line 6: `from '../common/market-calendar/market-holidays.data'`)
- [x] Old `functions/src/v2/partner/market-holidays.data.ts` is removed — **met** (git status shows `D`, verification script confirms)
- [x] Build passes — **met** (`npm run build` exit code 0)

No Spec findings.

## Thermo-nuclear

- Abstraction quality: N/A — file move, no new abstraction.
- File size: 77 lines, fine.
- Spaghetti detection: N/A — no new code paths.
- Test quality: verification script tests external behavior (file existence, import resolution, export function output, known holiday presence). Does not test implementation details.
- Edge cases: verification covers Labor Day (closed), Thanksgiving Friday (early_close), import path update, old file removal.

No Thermo-nuclear findings.

## Test results

- Build: PASS (`npm run build` exit code 0)
- Verification script: PASS (10/10 checks)
- Test suite: 366 passed, 6 failed (42 suites, 1 failed). The 6 failures are pre-existing in `contract-summary-aggregator.service.test.ts` — module resolution error unrelated to this task. The file `contract-summary-aggregator.service.ts` exists at the expected path; the test's `require()` path is incorrect. This is a pre-existing issue not introduced by task #68.

## Verdict: PASS

No critical or major findings. All acceptance criteria met. Build passes. Verification script passes. Pre-existing test failures are unrelated to this task.
