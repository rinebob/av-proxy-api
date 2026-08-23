# Verification Guide: Task #41 — AvEarningsHandler

## Scripts

### earnings-41-earnings-handler.ts

**Purpose:** Verifies that `AvEarningsHandler.transformResponse` correctly transforms a real Alpha Vantage EARNINGS JSON response (NVDA, captured from a live API call) into the typed `AvEarningsResponse`.

**Pipeline stages verified:**
- Transform: real AV JSON → typed AvEarningsResponse
- reportTime preservation (pre-market / post-market)
- "None" string value handling (estimatedEPS, surprisePercentage — real AV edge case)
- Empty response handling

**Command:**
```bash
npx ts-node -r tsconfig-paths/register -P scripts/tsconfig.json scripts/verify/earnings-41-earnings-handler.ts
```

**What it checks (20 checks):**
1. Symbol extracted correctly (NVDA)
2. annualEarnings array has correct count (5)
3. First annual fiscalDateEnding correct
4. First annual reportedEPS correct
5. quarterlyEarnings array has correct count (4)
6. First quarterly fiscalDateEnding correct
7. First quarterly reportedDate correct
8. First quarterly reportedEPS correct
9. First quarterly estimatedEPS correct
10. First quarterly surprise correct
11. First quarterly surprisePercentage correct
12. First quarterly reportTime preserved ("post-market")
13. Third quarterly reportTime preserved ("pre-market")
14. Quarterly with "None" estimatedEPS preserved
15. Quarterly with "None" surprisePercentage preserved
16. Empty response: symbol is empty string
17. Empty response: annualEarnings is empty array
18. Empty response: quarterlyEarnings is empty array
19. Empty arrays response: symbol preserved
20. Empty arrays response: both arrays empty

**Passing result:** All 20 checks print `PASS:`, script exits with code 0.

**Failing result:** First failure prints `FAIL:` with details, script exits with code 1.

**Notes:**
- Uses a dummy API key (`verify-dummy-key`) since we're only testing `transformResponse`, not making real API calls.
- The response data was captured from a live AV EARNINGS API call for NVDA, then truncated to 5 annual + 4 quarterly entries (including one with "None" string values for estimatedEPS and surprisePercentage).
