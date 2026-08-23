# AV 600 req/min Premium Tier — Impact Analysis

Analysis of what would change in this repo if we upgraded to Alpha Vantage's 600 req/min premium tier for realtime stock and options data. Produced as research for Topic #6 (Realtime Options Chain Endpoint, paused) and Topic #5 (Alpha Vantage Endpoint Expansion).

- Date: 2026-08-14
- Related: Topic #6 (paused), Topic #5

---

## Current Rate Limiting

The entire AV pipeline is throttled to ~60-66 req/min across four layers, all designed to stay under the current 75 req/min tier.

| Layer | File | Current value | Effective rate |
|---|---|---|---|
| Refresh manager inter-request delay | `functions/src/v2/alpha-vantage/data-refresher/av-refresh-manager.ts` (lines 60-67) | 900ms | ~66 req/min |
| Cloud Tasks queue dispatch rate | `functions/src/v2/alpha-vantage/jobs/job-config.ts` (lines 53-56) | 1.0/sec | 60 req/min |
| Per-job execution delay | `functions/src/v2/alpha-vantage/jobs/job-config.ts` (lines 15-18) | 1000ms | 60 req/min |
| Corpus throttle (options seed/build) | `functions/src/v2/historical-options-corpus/services/av-throttle.service.ts` (lines 38-50) | 1000ms | 60 req/min |

Environment variable override: `ALPHAVANTAGE_MIN_INTERVAL_MS` in `functions/env.functions-sample` (default 1000).

---

## Cloud Functions That Benefit

### Data Refreshers (direct 10x throughput gain)

| Function | What it does | Current bottleneck | With 600 req/min |
|---|---|---|---|
| `refreshAvDailyTimeSeriesPostClose` | Post-close daily bars for all tracked symbols | 696 symbols x 3 intervals = 2,088 jobs at 60/min = ~35 min | ~3.5 min (10x) |
| `refreshAvDailyTimeSeriesIntradayHourly` | Intraday snapshots (currently 3x/day: 8am, 10am, 12pm PT) | Limited to hourly snapshots due to rate | Could run every few minutes |
| `refreshAvWeeklyTimeSeriesPostClose` | Weekly bars | Same queue, same throttle | 10x faster |
| `refreshAvMonthlyTimeSeriesPostClose` | Monthly bars | Same queue, same throttle | 10x faster |
| `refreshAlphaVantageDataV2` | Non-time-series endpoints (OVERVIEW, etc.) | 900ms delay between calls | 100ms delay |
| `refreshHistoricalOptionsCorpusNightly` | Nightly options corpus for QQQ/TQQQ | 1 dispatch/sec | Could expand to more symbols |

### Cloud Task Workers (queue throughput)

| Function | Current limit | With 600 req/min |
|---|---|---|
| `processTimeSeriesJobTask` | 1 dispatch/sec, 20 concurrent | 10 dispatches/sec, 20 concurrent |
| `processIntradaySnapshotJobTask` | Same queue | Same 10x |
| `processFullBackfillRunTask` | Same queue (batch size 50) | Could increase batch size |
| `processHistoricalOptionsCorpusSeedTask` | 1 dispatch/sec, 1 concurrent | 10 dispatches/sec, could raise concurrency |
| `processHistoricalOptionsTsBuildTask` | 1 dispatch/sec, 1 concurrent | 10 dispatches/sec |

### Partner Endpoints (freshness improves)

| Function | Current data source | With 600 req/min |
|---|---|---|
| `partnerHistoricalOptionsV2` | Live AV fetch on every request (no cache) | Could cache results, reducing AV calls and latency |
| `partnerIntradaySnapshotV2` | Firestore (refreshed 3x/day) | Could be refreshed every few minutes -> near-realtime intraday |
| `partnerTimeSeriesV2` | Firestore (refreshed post-close) | Post-close refresh completes in 3.5 min instead of 35 min |

---

## Endpoints That Become Newly Viable

| Capability | Why it's not possible today | What 600 req/min enables |
|---|---|---|
| GLOBAL_QUOTE at true 10-30s TTL | `ttl: 0`, handled by scheduled updaters. 696 symbols at 60 req/min = 11.6 min per cycle (can't hit 30s) | 696 symbols at 600 req/min = 1.16 min per cycle. True sub-minute quote freshness for all symbols |
| REALTIME_BULK_QUOTES integration | Handler exists but not wired into refresh pipeline. Could fetch 100 symbols/call x 7 calls = all 696 in ~7 seconds | Becomes the preferred mechanism for quote refresh — 7 calls vs 696 individual calls |
| REALTIME_OPTIONS (Topic #6, paused) | Premium cost not justified for options data alone | The 600 req/min tier is the reason to eventually activate it — it's not just about the options data, it's about the rate limit that comes with it |
| HISTORICAL_OPTIONS beyond QQQ/TQQQ | Skipped in refresh manager (options chains exceed Firestore 1MB doc limit). Corpus seed at 1/sec makes expanding to 696 symbols impractical | 10x seed throughput. Could expand the GCS corpus to more symbols (though the 1MB Firestore limit is a separate issue — GCS storage would need to be the path) |

---

## Config Changes Required (5 files)

1. `functions/src/v2/alpha-vantage/data-refresher/av-refresh-manager.ts` — `AV_INTER_REQUEST_DELAY_MS`: 900 -> 100
2. `functions/src/v2/alpha-vantage/jobs/job-config.ts` — `maxDispatchesPerSecond`: 1.0 -> 10.0
3. `functions/src/v2/alpha-vantage/jobs/job-config.ts` — `JOB_EXECUTION_DELAY_MS`: 1000 -> 100
4. `functions/src/v2/historical-options-corpus/handlers/corpus-seed.task.ts` — `maxDispatchesPerSecond`: 1.0 -> 10.0
5. `functions/env.functions-sample` — `ALPHAVANTAGE_MIN_INTERVAL_MS`: 1000 -> 100

---

## Functional Changes

1. Re-enable HISTORICAL_OPTIONS in refresh manager (remove skip at line 266-269 of av-refresh-manager.ts)
2. Enable REALTIME_BULK_QUOTES integration for bulk quote refresh
3. Reduce TTLs for time-series endpoints from 5 minutes to 1 minute
4. Expand options corpus from QQQ/TQQQ to all tracked symbols
5. Implement caching for `partnerHistoricalOptionsV2` (currently live fetch)

---

## Performance Improvements Summary

- Full refresh cycle: ~35 minutes -> ~3.5 minutes (10x faster)
- Intraday snapshots: 3x/day -> continuous
- Options data: 2 symbols -> 696 symbols
- Realtime quotes: 11.6 min cycle -> 1.16 min cycle (true sub-minute freshness)

---

## Key Insight

The real value proposition of the 600 req/min tier is not the realtime options data — it's a 10x throughput upgrade across the entire AV pipeline. The options data (REALTIME_OPTIONS) is a bonus that comes along with it. The decision framework should be: "is a 10x pipeline throughput upgrade worth the premium cost?" rather than "is realtime options data worth the premium cost?"

The highest-impact single integration would be REALTIME_BULK_QUOTES — 7 bulk calls to refresh quotes for all 696 symbols in seconds, far more efficient than 696 individual GLOBAL_QUOTE calls.

---

## Caveats

- **Pricing**: AV premium tier pricing was not verified from primary sources. Check https://www.alphavantage.co/premium/ for current pricing before making cost decisions.
- **696 symbols**: Figure from `docs/operations/backend-functions-overview.md` dated 2026-01-04. Actual count may have changed.
- **Firestore 1MB limit**: Separate constraint from rate limits. Full options chains can't be stored in Firestore documents regardless of rate limit. GCS corpus approach (or subcollection strategy) still needed.
- **Robinhood**: Free realtime options data is available from Robinhood (confirmed via RS, usable from hosted cloud function). This covers the realtime options use case without AV premium. The 600 req/min question is therefore about pipeline throughput, not options data access.
