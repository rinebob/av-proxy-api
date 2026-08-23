# Verification Guide: Task #42 — AvEarningsEstimatesHandler

## Scripts

### earnings-42-earnings-estimates-handler.ts

**Purpose:** Verifies that `AvEarningsEstimatesHandler.transformResponse` correctly transforms a realistic AV EARNINGS_ESTIMATES JSON response into the typed `AvEarningsEstimatesResponse`. Uses a realistic mock because the AV API key is only available in the Cloud Functions runtime (Secret Manager), not locally.

**Pipeline stages verified:**
- Transform: AV JSON → typed AvEarningsEstimatesResponse
- Nullable field preservation (revision counts can be null)
- horizon field preservation (fiscal year / fiscal quarter)
- Empty response handling

**Command:**
```bash
npx ts-node -r tsconfig-paths/register -P scripts/tsconfig.json scripts/verify/earnings-42-earnings-estimates-handler.ts
```

**What it checks (22 checks):**
1. Symbol extracted correctly (AAPL)
2. estimates array has correct count (2)
3. First estimate date correct
4. First estimate horizon correct ("fiscal year")
5. First estimate eps_average correct
6. First estimate eps_high correct
7. First estimate eps_low correct
8. First estimate eps_analyst_count correct
9. First estimate revenue_average correct
10. First estimate revenue_analyst_count correct
11. First estimate revision_up_7d correct (non-null)
12. First estimate revision_up_30d correct (non-null)
13. First estimate revision_down_30d correct (non-null)
14. First estimate revision_down_7d is null
15. Second estimate horizon correct ("fiscal quarter")
16. Second estimate revision_up_7d is null
17. Second estimate revision_down_7d is null
18. Second estimate revision_up_30d is null
19. Second estimate revision_down_30d is null
20. Empty response: symbol is empty string
21. Empty response: estimates is empty array
22. Empty estimates response: symbol preserved, array empty

**Passing result:** All 22 checks print `PASS:`, script exits with code 0.

**Failing result:** First failure prints `FAIL:` with details, script exits with code 1.

**Notes:**
- Uses a dummy API key (`verify-dummy-key`) since we're only testing `transformResponse`, not making real API calls.
- The mock response includes both non-null and null revision count fields to verify null preservation.
