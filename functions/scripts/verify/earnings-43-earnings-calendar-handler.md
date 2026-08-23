# Verification Guide: Task #43 — AvEarningsCalendarHandler

## Scripts

### earnings-43-earnings-calendar-handler.ts

**Purpose:** Verifies that `AvEarningsCalendarHandler.fetch` correctly fetches the global CSV response from AV, parses it, filters to tracked symbols, and saves the filtered result. Uses mocked axios, saveAvData, and Firestore since we can't call the real AV API or Firestore locally.

**Pipeline stages verified:**
- Fetch: AV called with function=EARNINGS_CALENDAR, horizon=12month, no symbol
- Parse: CSV response parsed using parseCsv() with all 7 fields mapped correctly
- Filter: entries filtered to tracked symbols only
- Save: saveAvData called with filtered entries (not full response), empty symbol (global doc)
- Edge cases: empty CSV (headers only), all entries filtered out
- Deprecated: transformResponse throws

**Command:**
```bash
npx ts-node -r tsconfig-paths/register -P scripts/tsconfig.json scripts/verify/earnings-43-earnings-calendar-handler.ts
```

**What it checks (22 checks across 4 tests):**

**Test 1: Parse CSV and filter to tracked symbols (13 checks)**
1. Filtered to 2 entries
2. First entry is AAPL
3. Second entry is NVDA
4. Name correct (Apple Inc)
5. reportDate correct (2025-11-01)
6. fiscalDateEnding correct (2025-09-30)
7. estimate correct (1.80)
8. currency correct (USD)
9. timeOfTheDay correct (after close)
10. saveAvData called with 2 entries
11. saveAvData called with empty symbol
12. saveAvData called with correct endpoint (EARNINGS_CALENDAR)
13. AV called with function=EARNINGS_CALENDAR
14. AV called with horizon=12month
15. AV called with no symbol (undefined)

**Test 2: Empty CSV (headers only) (2 checks)**
16. Empty CSV returns 0 entries
17. saveAvData called with empty array

**Test 3: All entries filtered out (2 checks)**
18. No matches returns 0 entries
19. saveAvData called with empty array

**Test 4: transformResponse throws (deprecated) (2 checks)**
20. Error message includes "deprecated"
21. transformResponse throws

**Passing result:** All checks print `PASS:`, script exits with code 0.

**Failing result:** First failure prints `FAIL:` with details, script exits with code 1.

**Notes:**
- Uses a dummy API key (`verify-dummy-key`) since we're mocking the API call.
- Mocks saveAvData via module patching to capture what would be saved.
- Mocks Firestore db via module patching to return controlled tracked symbols.
- The CSV response is a realistic 5-row AV EARNINGS_CALENDAR response with AAPL, MSFT, NVDA, GOOGL, TSLA.
