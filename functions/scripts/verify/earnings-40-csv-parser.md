# Verification Guide: Task #40 — CSV Parser Utility

## Scripts

### earnings-40-csv-parser.ts

**Purpose:** Verifies `parseCsv()` against a real AV EARNINGS_CALENDAR CSV sample, plus edge cases (empty fields, headers-only, quoted fields, trailing newline, empty input).

**Command:**
```bash
npx ts-node -r tsconfig-paths/register -P scripts/tsconfig.json scripts/verify/earnings-40-csv-parser.ts
```

**What it checks:**
1. Real 12-month AV CSV sample: row count (11), header fields (7), data row values
2. Empty fields: middle field returns empty string
3. Headers-only input: returns 1 row
4. Quoted fields: embedded comma parsed correctly
5. Trailing newline: no empty trailing row
6. No trailing newline: correct row count
7. Empty input: returns empty array

**Passing result:** All 13 checks print `PASS:`, script exits with code 0.

**Failing result:** First failure prints `FAIL:` with details, script exits with code 1.
