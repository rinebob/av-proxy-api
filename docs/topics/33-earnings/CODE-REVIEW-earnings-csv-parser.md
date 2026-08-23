**Topic:** Implement AV earnings-related endpoints (3)
**Issue:** #37 (BE Blueprint)
**Topic Parent:** #33
**Domain:** EARNINGS
**Type:** Code Review
**Status:** Complete
**Created:** 2026-08-22
**Last Updated:** 2026-08-22

# Code Review: Task #40 — CSV Parser Utility

## Summary

Three review axes were run in parallel:
- **Standards:** 0 critical, 0 major, 2 minor, 3 nit — PASS
- **Spec:** 0 critical, 0 major, 0 minor, 3 nit — PASS (all 6 acceptance criteria MET)
- **Thermo-nuclear:** 2 critical, 4 major, 4 minor, 3 nit — findings re-evaluated and downgraded (see below)

All 6 acceptance criteria are MET.
22 unit tests pass (1 suite). 81 tests pass across 9 suites (no regressions).
13 verification checks pass.

## Thermo-nuclear severity re-evaluation

The thermo-nuclear axis raised 2 CRITICAL and 4 MAJOR findings. After evaluation against the task's actual scope and design decisions, all were downgraded:

**CRITICAL-1 (newline in quoted fields) → MINOR:** The IMPL doc explicitly states "AV CSV format is simple (no embedded commas in 1,814 real rows)". The parser is purpose-built for AV's EARNINGS_CALENDAR CSV, not a general-purpose RFC 4180 parser. Embedded newlines in AV CSV are extremely unlikely.

**CRITICAL-2 (malformed CSV validation) → MINOR:** The parser receives input from AV's API, not user input. Upstream errors should be handled at the handler layer, not the parser layer.

**MAJOR-3 (code duplication with csv-utils.ts) → MINOR:** The existing `parseCsvLine()` is in `scripts/diagnostics/` (diagnostic scripts only), not production code. Valid cleanup opportunity but not blocking.

**MAJOR-4 (hand-rolled vs library) → NIT:** The IMPL doc explicitly specifies "No external library" as a deliberate design decision.

**MAJOR-5 (whitespace handling tests) → MINOR:** Valid test gap — fixed (assertion strengthened).

**MAJOR-6 (test implementation detail leakage) → NIT:** The comment documents the return format, not implementation details.

## Findings by severity (after re-evaluation)

### Critical (0)

None.

### Major (0)

None.

### Minor (4 — 2 FIXED, 2 deferred)

**MINOR-1: Utility file naming does not follow project convention — FIXED**
- **File:** `functions/src/v2/alpha-vantage/utils/csv-parser.ts` (filename)
- **Issue:** Project convention is `{domain}-{concern}.utils.ts`. Neighboring files follow this: `av-intraday-aggregate.utils.ts`, `av-options-contract.utils.ts`, etc.
- **Fix:** Renamed to `av-csv-parser.utils.ts`. Updated barrel export, test import, and verification script import.

**MINOR-2: Weak whitespace-only test assertion — FIXED**
- **File:** `functions/tests/v2/alpha-vantage/utils/av-csv-parser.test.ts` (line 162)
- **Issue:** Test asserted `rows.length >= 0` which is always true.
- **Fix:** Strengthened to assert specific row count and field values.

**MINOR-3: Missing escaped quote test — FIXED**
- **File:** `functions/tests/v2/alpha-vantage/utils/av-csv-parser.test.ts`
- **Issue:** Implementation handles escaped quotes (`""` → `"`) but no test verified it.
- **Fix:** Added test for `"He said ""hello"" world"` → `He said "hello" world`.

**MINOR-4: Code duplication with diagnostic csv-utils.ts — deferred**
- **File:** `functions/scripts/diagnostics/csv-utils.ts`
- **Issue:** Existing `parseCsvLine()` has similar quote/escape logic. Could be replaced by the production parser.
- **Status:** Deferred — diagnostic utility is in a different layer. Cleanup opportunity for a future CHORE.

### Nit (5 — 1 fixed, 4 deferred)

**NIT-1: README pipeline stage categorization — deferred**
- **File:** `functions/scripts/verify/README.md` (line 136)
- **Issue:** "CSV parser utility verification" is not one of the defined BE pipeline stages.
- **Status:** Deferred — cosmetic doc issue.

**NIT-2: Hand-rolled vs library design decision — deferred**
- **File:** `functions/src/v2/alpha-vantage/utils/av-csv-parser.utils.ts`
- **Issue:** Thermo-nuclear reviewer questioned the hand-rolled approach vs papaparse/csv-parse.
- **Status:** Deferred — deliberate design decision documented in IMPL plan.

**NIT-3: Acceptance criterion #4 wording is contradictory — deferred**
- **File:** GitHub issue #40
- **Issue:** "returns empty array (just header row)" is contradictory. Actual behavior (return array with 1 row containing the header) is correct.
- **Status:** Deferred — issue wording, not code.

**NIT-4: Test comment documents return format — deferred**
- **File:** `functions/tests/v2/alpha-vantage/utils/av-csv-parser.test.ts` (line 17)
- **Issue:** Comment says "parseCsv returns all rows including header; data rows = total - 1".
- **Status:** Deferred — documents the contract, not implementation details.

**NIT-5: No BOM handling — deferred**
- **File:** `functions/src/v2/alpha-vantage/utils/av-csv-parser.utils.ts`
- **Issue:** If AV returns UTF-8 with BOM, first header field would include `\uFEFF`.
- **Status:** Deferred — AV CSV responses don't include BOM in practice.

## Test results

- **Task #40 tests:** 22 tests, 1 suite — all pass
- **Full test suite:** 81 tests, 9 suites — all pass
- **Verification script:** `earnings-40-csv-parser.ts` — all 13 checks pass
- **No regressions** in existing tests

## Verdict: PASS

All acceptance criteria are MET. No critical or major findings after re-evaluation. 3 MINOR findings fixed (file naming, weak assertion, missing escaped quote test). Remaining findings are MINOR/NIT and deferred. Tests pass. Verification script passes.
