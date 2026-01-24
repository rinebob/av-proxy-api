# Alpha Vantage API Call Sites - Audit & Rate Limiting Status

## Summary

This document tracks all places in the codebase where Alpha Vantage API calls are made, their rate limiting status, and potential risks.

**Last Updated:** 2026-01-08  
**AV Rate Limit:** 75 requests/minute (1.25 requests/second)  
**Our Safety Margin:** 60 requests/minute (1 request/second = 1000ms delay)

---

## Protected Call Sites (Rate Limited)

### ✅ 1. Time-Series Schedulers - Legacy Handler
**File:** `functions/src/v2/alpha-vantage/data-refresher/av-refresh-manager.ts`  
**Line:** 1191  
**Protection:** 1000ms delay before each call  
**Context:** Main per-symbol loop in `refreshForEndpoints()`  
**Risk Level:** 🟢 LOW (protected)

```typescript
const RATE_LIMIT_DELAY_MS = 1000;
await new Promise(resolve => setTimeout(resolve, RATE_LIMIT_DELAY_MS));
await handler.fetch(baseParams);
```

**Triggered by:**
- `refreshAvDailyTimeSeriesPostClose` (POST daily)
- `refreshAvWeeklyMonthlyTimeSeriesPostClose` (POST weekly/monthly)
- `refreshAvDailyTimeSeriesPreClose` (PRE daily)
- All daily retry schedulers (evening, morning)

---

### ✅ 2. Time-Series Job Worker
**File:** `functions/src/v2/alpha-vantage/jobs/time-series-jobs.worker.ts`  
**Line:** 107  
**Protection:** 1000ms delay before each call  
**Context:** Worker processing individual time-series jobs from Cloud Tasks  
**Risk Level:** 🟢 LOW (protected)

```typescript
const RATE_LIMIT_DELAY_MS = 1000;
await new Promise(resolve => setTimeout(resolve, RATE_LIMIT_DELAY_MS));
await handler.fetch({ symbol, outputsize: OutputSize.COMPACT, __phase: phase });
```

**Triggered by:**
- Cloud Tasks queue dispatching jobs
- Currently gated by `TS_TIME_SERIES_TASKS_ENABLED=true`

---

### ✅ 3. Acceleration Pass (Near-Complete Retry)
**File:** `functions/src/v2/alpha-vantage/data-refresher/av-refresh-manager.ts`  
**Line:** 1309  
**Protection:** 1000ms delay before each call  
**Context:** Retry logic for stragglers when only a few symbols remain  
**Risk Level:** 🟢 LOW (protected)

```typescript
const RATE_LIMIT_DELAY_MS = 1000;
await new Promise(resolve => setTimeout(resolve, RATE_LIMIT_DELAY_MS));
await handler.fetch(baseParams);
```

**Triggered by:**
- When `pendingCount > 0 && pendingCount <= 10` for DAILY POST
- Limited to max 20 symbols per run

---

### ✅ 4. Validation Remediation (Failed Symbol Retry)
**File:** `functions/src/v2/alpha-vantage/data-refresher/av-refresh-manager.ts`  
**Line:** 1451  
**Protection:** 1000ms delay before each call  
**Context:** Re-fetch symbols that failed validation  
**Risk Level:** 🟢 LOW (protected)

```typescript
const RATE_LIMIT_DELAY_MS = 1000;
await new Promise(resolve => setTimeout(resolve, RATE_LIMIT_DELAY_MS));
await handler.fetch({ symbol: s, outputsize: 'compact', __checkWriteToggle: false });
```

**Triggered by:**
- When daily validation fails for some symbols
- Only runs for failed symbols (typically small number)

---

## Unprotected Call Sites (Potential Risks)

### ⚠️ 5. On Symbol Added Trigger (FULL Backfill)
**File:** `functions/src/v2/alpha-vantage/triggers/on-symbol-added.function.ts`  
**Lines:** 50, 74, 112  
**Protection:** ❌ NONE  
**Context:** Backfills DAILY, WEEKLY, MONTHLY when new symbol is added  
**Risk Level:** 🟡 MEDIUM (low frequency, but 3 rapid calls per symbol)

```typescript
await dailyHandler.fetch({ symbol, outputsize: OutputSize.FULL, ... });
await weeklyHandler.fetch({ symbol, outputsize: OutputSize.FULL, ... });
await monthlyHandler.fetch({ symbol, outputsize: OutputSize.FULL, ... });
```

**Triggered by:**
- Firestore onCreate trigger for `tracked-symbols/{symbol}`
- Typically 1 symbol at a time (manual adds)
- **Risk:** If bulk import adds many symbols rapidly, could hammer AV

**Recommendation:** Add 1000ms delay between the 3 calls (DAILY → WEEKLY → MONTHLY)

---

### ⚠️ 6. Alpha Vantage Gateway (User-Initiated)
**File:** `functions/src/v2/alpha-vantage/alpha-vantage-gateway.ts`  
**Line:** 85  
**Protection:** ❌ NONE (user-controlled)  
**Context:** HTTP gateway for direct AV API access  
**Risk Level:** 🟡 MEDIUM (depends on client behavior)

```typescript
const response = await handler.fetch(requestParams);
```

**Triggered by:**
- External HTTP requests to the gateway
- Used by partner applications (e.g., rel-str)
- **Risk:** Malicious or buggy client could hammer the gateway

**Recommendation:** 
- Add rate limiting at gateway level (per-client IP or API key)
- Consider using Cloud Armor or API Gateway for rate limiting
- Monitor usage patterns

---

### ✅ 7. Bulk Import Symbol Search
**File:** `functions/src/v2/alpha-vantage/bulk-import/bulk-import-symbols.function.ts`  
**Line:** 179  
**Protection:** ✅ 3000ms delay (line 191-196)  
**Context:** SYMBOL_SEARCH for each symbol during bulk import  
**Risk Level:** 🟢 LOW (protected with extra safety margin)

```typescript
const searchResponse = await symbolSearchHandler.fetch({ keywords: symbol });
// ... then:
const throttleMs = 3000;
await new Promise((resolve) => setTimeout(resolve, throttleMs));
```

**Triggered by:**
- `bulkImportSymbolsV2` function
- Processes arrays of symbols (potentially 100+ at once)
- **Protection:** 3000ms delay = 20 requests/minute (very safe)

**Note:** This has EXTRA protection (3x our standard delay) because bulk imports are high-risk operations.

---

### 🟢 8. Non-Time-Series Refresher (Already Has Throttling)
**File:** `functions/src/v2/alpha-vantage/data-refresher/av-refresh-manager.ts`  
**Line:** 387  
**Protection:** ✅ Existing throttling in `runRefreshAlphaVantageDataV2`  
**Context:** Refreshes non-time-series endpoints (OVERVIEW, EARNINGS, etc.)  
**Risk Level:** 🟢 LOW (already protected)

```typescript
const apiResponse = await handler.fetch(fetchParams);
```

**Note:** This is in `runRefreshAlphaVantageDataV2`, which already has throttling logic.

---

### 🟢 9. Intraday Pre-Close Capture
**File:** `functions/src/v2/alpha-vantage/data-refresher/av-refresh-manager.ts`  
**Line:** 736  
**Protection:** ✅ Part of scheduled run with controlled symbol list  
**Context:** Captures intraday snapshot at pre-close  
**Risk Level:** 🟢 LOW (scheduled, controlled)

```typescript
const resp = await handler.fetch({ symbol, interval: '1min' });
```

**Note:** This is in `capturePreCloseIntraday`, which processes a controlled list of symbols.

---

### 🟢 10. Bulk Quote Updater
**File:** `functions/src/v2/alpha-vantage/data-refresher/av-daily-time-series-bulk-updater.ts`  
**Line:** 78  
**Protection:** ✅ Batches symbols (up to 100 per call)  
**Context:** Uses REALTIME_BULK_QUOTES endpoint  
**Risk Level:** 🟢 LOW (batched, efficient)

```typescript
const response = await bulkQuoteHandler.fetch({ symbols: batch.join(','), ... });
```

**Note:** This is efficient - 1 API call for up to 100 symbols.

---

### 🟡 11. Firestore Helper Init (Backfill Utility)
**File:** `functions/src/v2/alpha-vantage/firestore/av-firestore-helper.ts`  
**Line:** 493  
**Protection:** ❌ NONE  
**Context:** Utility function for initializing time-series data  
**Risk Level:** 🟡 MEDIUM (utility, not scheduled)

```typescript
const response = await handler.fetch({ symbol, outputsize: OutputSize.FULL });
```

**Triggered by:**
- Manual scripts or admin functions
- Not part of scheduled runs
- **Risk:** If used in a loop without throttling, this FULL-history helper can still hit AV limits

**Recommendation:** Treat this helper as a one-off backfill primitive. When calling it from scripts or admin tools, add your own per-call delay (e.g., 1000ms) or batching to stay within AV rate limits, and consider adding a JSDoc warning in the helper to document this requirement.

---

### 🟡 12. Intraday Handler (Internal Call)
**File:** `functions/src/v2/alpha-vantage/handlers/alpha-vantage-timeseries-base.handler.ts`  
**Line:** 218  
**Protection:** ❌ NONE  
**Context:** Internal call to fetch intraday data for PRE phase  
**Risk Level:** 🟡 MEDIUM (depends on caller)

```typescript
const intradayApiResp: any = await intradayHandler.fetch({ symbol, interval: '1min' });
```

**Note:** This is called internally by time-series handlers during PRE phase processing.

---

## Immediate Action Items

### 🔴 CRITICAL (Do Now)

1. **Add rate limiting to bulk import** (`bulk-import-symbols.function.ts`)
   - This is the highest risk - designed for bulk operations with no throttling
   - Add 1000ms delay in the symbol loop
   - Add max batch size limit

### 🟡 HIGH PRIORITY (Do This Week)

2. **Add delays to onSymbolAdded trigger**
   - Add 1000ms delay between DAILY → WEEKLY → MONTHLY calls
   - Low frequency but could cause issues during bulk adds

3. **Add gateway-level rate limiting**
   - Protect against malicious/buggy clients
   - Consider Cloud Armor or API Gateway

### 🟢 MEDIUM PRIORITY (Do Next Sprint)

4. **Add JSDoc warnings to utility functions**
   - Document rate limiting requirements in `av-firestore-helper.ts`
   - Add examples showing proper throttling

5. **Configure Cloud Tasks queue limits**
   - Set `maxDispatchesPerSecond: 1.0` on the time-series job queue
   - This provides additional protection beyond per-worker delays

---

## Testing Recommendations

### Before Expanding Beyond AVGO

1. **Monitor rate-limit errors:**
   ```
   jsonPayload.message=~"rate limit"
   ```
   Should be ZERO

2. **Count AV calls per minute:**
   ```
   jsonPayload.component="av.handler.ts-base"
   jsonPayload.event="fetch.start"
   ```
   Should be ≤ 60 per minute

3. **Check for concurrent runs:**
   - Verify schedulers don't overlap
   - Check Cloud Tasks queue depth

### Load Testing

Before full rollout, test with 10-20 symbols:
- Remove `TS_JOB_TEST_SYMBOL` filter
- Monitor for 24 hours
- Verify no rate-limit errors
- Check job completion rates

---

## Architecture Notes

### Why 1000ms Delay?

- **AV Limit:** 75 requests/minute = 1.25 requests/second
- **Our Limit:** 60 requests/minute = 1.0 requests/second
- **Safety Margin:** 15 requests/minute (20% buffer)

### Future: Cloud Tasks Queue Config

The job pipeline design calls for queue-level rate limiting:

```yaml
av-timeseries-jobs:
  maxDispatchesPerSecond: 1.0
  maxConcurrentDispatches: 10
```

This would provide additional protection, but we still need per-call delays because:
1. Legacy handler runs outside Cloud Tasks
2. Multiple schedulers could run concurrently
3. Defense in depth

---

## Rollback Plan

If rate-limit errors occur:

1. **Immediate:** Set `TS_JOB_TEST_SYMBOL=AVGO` to limit to 1 symbol
2. **Short-term:** Increase delays to 2000ms (30 requests/minute)
3. **Long-term:** Disable problematic schedulers until fixed

---

## Contact

For questions or to report new AV call sites, update this document and notify the team.
