# Verification Guide: Task #44 — Factory registration + refresh manager fix

## Scripts

### earnings-44-factory-registration.ts

**Purpose:** Verifies that the AlphaVantageHandlerFactory correctly creates handler instances for all three earnings endpoints, and that the `isGlobalEndpoint` helper correctly identifies endpoints with no `{symbol}` in their firestorePath.

**Pipeline stages verified:**
- Factory: createHandler() returns correct handler types for EARNINGS, EARNINGS_ESTIMATES, EARNINGS_CALENDAR
- Factory: unregistered endpoints throw "No handler found"
- Refresh manager: isGlobalEndpoint() correctly identifies global vs per-symbol endpoints

**Command:**
```bash
npx ts-node -r tsconfig-paths/register -P scripts/tsconfig.json scripts/verify/earnings-44-factory-registration.ts
```

**What it checks (14 checks across 2 tests):**

**Test 1: Factory registration (4 checks)**
1. EARNINGS creates AvEarningsHandler
2. EARNINGS_ESTIMATES creates AvEarningsEstimatesHandler
3. EARNINGS_CALENDAR creates AvEarningsCalendarHandler
4. IPO_CALENDAR throws "No handler found" (unregistered)

**Test 2: isGlobalEndpoint helper (10 checks)**
5. EARNINGS_CALENDAR config exists
6. EARNINGS_CALENDAR is global endpoint (no {symbol} in path)
7. IPO_CALENDAR config exists
8. IPO_CALENDAR is global endpoint (no {symbol} in path)
9. EARNINGS config exists
10. EARNINGS is NOT global (has {symbol} in path)
11. EARNINGS_ESTIMATES config exists
12. EARNINGS_ESTIMATES is NOT global (has {symbol} in path)
13. OVERVIEW config exists
14. OVERVIEW is NOT global (has {symbol} in path)

**Passing result:** All checks print `PASS:`, script exits with code 0.

**Failing result:** First failure prints `FAIL:` with details, script exits with code 1.

**Notes:**
- Uses a dummy API key (`verify-dummy-key`) since handler constructors need it.
- The isGlobalEndpoint helper is the key abstraction for the refresh manager fix — it detects endpoints whose firestorePath has no `{symbol}` placeholder, meaning they should be processed once globally rather than once per tracked symbol.
