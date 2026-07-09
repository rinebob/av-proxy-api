# Planning Doc: Daily Intraday OHLCV Bar Aggregation

**Audience:** Backend / partner data team
**Last updated:** 2026-07-09
**Status:** Implemented — under rollout observation

---

## 1. Goal

Give consuming systems (e.g., RS) a single, reasonably current **daily intraday OHLCV bar** that reflects regular-trading-hours activity from the 09:30 ET open through the latest available timestamp.

This bar uses the **existing bar OHLCV fields** (`o`, `h`, `l`, `c`, `v`). The nightly POST run will overwrite those fields with finalized EOD values, which is acceptable.

---

## 2. Current State

Right now the pre-close snapshot path fetches `TIME_SERIES_INTRADAY` with:

- `interval=1min`
- `outputsize=compact` (latest 100 data points)
- `entitlement=delayed`
- `extended_hours=true` (default)
- `adjusted=true` (default)

It then picks only the **latest close** and stores it as `ip`. It does **not** produce a full OHLCV bar because:

- `compact` only covers ~1.5 hours of regular trading, so it cannot reach the 09:30 ET open or a 06:30 ET pre-market anchor.
- No aggregation logic exists to roll 1-minute bars into a higher-level bar.

See `@c:\aa\projects\av-proxy-api\functions\src\v2\alpha-vantage\handlers\alpha-vantage-timeseries-base.handler.ts:226-302` for the current pre-close intraday snapshot implementation.

---

## 3. Proposed Approach

Switch the intraday snapshot fetch to:

- `interval=15min`
- `outputsize=compact`
- `extended_hours=false` — regular trading hours only (09:30–16:00 ET).
- Keep `adjusted=true` unless we specifically want raw values.
- Use `entitlement=delayed` (no API plan change).

With `outputsize=compact`, Alpha Vantage returns the **latest 100** 15-minute bars. RTH has 26 15-minute bars per day, so 100 bars covers roughly the last four trading sessions. That is more than enough to capture today’s full RTH bar while keeping the payload small.

### 3.1 Aggregation algorithm

1. Receive raw AV 15-minute series.
2. Determine today's ET date and the RTH anchor time (`09:30:00 ET`).
3. Filter all bars whose ET timestamp is `>= 09:30 ET today`.
4. Compute and write directly into the daily bar's existing fields:
   - `o` = `open` of the first filtered bar.
   - `h` = max `high` across filtered bars.
   - `l` = min `low` across filtered bars.
   - `c` = `close` of the last filtered bar.
   - `v` = sum of `volume` across filtered bars.

The existing `i*` fields (`ip`, `io`, `it`, `ic`, `ipc`) are still populated alongside the new OHLCV bar during the rollout period. They will be retired once the OHLCV path is stable.

### 3.2 Output destination

Write the aggregated values directly into the **existing daily bar fields** (`o`, `h`, `l`, `c`, `v`).

- During trading hours these fields represent the intraday indicative bar.
- The nightly POST run overwrites them with the finalized EOD bar from Alpha Vantage.
- The previous `i*` intraday overlay fields are still populated alongside the new fields during the rollout period so existing consumers have a migration window.

### 3.3 When to run

The current intraday schedule is:

```text
TS_DAILY_INTRADAY_HOURLY_SCHEDULE = '0 8,10,12 * * 1-5'  // 8/10/12 PM PT = 11/13/15 ET
TS_INTRADAY_RTH_CLOSE_1615 = '15 16 * * 1-5'             // 4:15 PM ET
```

The new aggregation runs on the same schedule. On early-close days the bar naturally stops at the latest available 15-minute RTH bar; no schedule change is required.

---

## 4. Decisions

| Decision | Value |
|---|---|
| Interval / outputsize | `15min` / `compact` |
| Extended hours | `false` — RTH only |
| Entitlement | `delayed` (no plan change) |
| Anchor | 09:30 ET |
| Output | Existing daily bar `o/h/l/c/v` fields |
| Symbol scope | All tracked symbols |
| Volume accuracy | Low priority; summed 15-minute volume is acceptable for now |
| i* fields | Keep populating `ip/io/it/ic/ipc` alongside `o/h/l/c/v` until the OHLCV path is stable (both written atomically by `upsertAvDailyIntradayBar`) |
| Daily write atomicity | Single Firestore transaction writes OHLCV and `i*` fields together |
| Shared fetch/store path | `services/av-intraday-daily.service.ts::fetchAndStoreDailyIntradayBar` is used by the intraday worker and the base handler DAILY PRE path |
| W/M overlay parallelism | Weekly and monthly snapshots run concurrently via `Promise.all` |
| Unit tests | `functions/tests/v2/alpha-vantage/utils/av-intraday-aggregate.test.ts` (excluded from deployable build) |
| Weekly/Monthly intraday overlay | Continue existing ratcheting logic: close updates to latest bar, `h`/`l` ratchet, `o` unchanged except on period-start placeholder |

### Resolved Decisions

1. **Run cadence** — Keep the existing `8/10/12 PT + 4:15 ET` schedule for now. No hourly RTH runs until the path is stable.
2. **Early closes** — Expected. The aggregator anchors at 09:30 ET and naturally stops at the latest available 15-minute bar, so the intraday bar will reflect the shorter trading day without schedule changes.

---

## 5. Risks

| Risk | Mitigation |
|---|---|
| API quota/cost | Use 15-minute compact instead of 1-minute compact; one call per symbol per run. Consider batched or throttled runs. |
| Delayed data | Fixed decision: stay on `delayed`. The latest bar is ~15 minutes behind market time. |
| Timezone bugs | Centralize ET timestamp parsing; reuse `parseAvEtTimestampMs` and `Intl.DateTimeFormat`. |
| Consumer confusion | Clearly distinguish "intraday indicative" bar from finalized EOD bar via status/field naming. |

---

## 6. Proposed Tasks

1. **Spike** — Make a manual `TIME_SERIES_INTRADAY` call with `interval=15min&outputsize=compact&extended_hours=false` for one symbol and inspect the response shape.
2. **Design decision** — Keep current 8/10/12 PT + 4:15 ET schedule; early-close days naturally stop at the latest 15-minute bar.
3. **Implement aggregator** — Add a pure function `aggregateIntradayRthBar(rawSeries, dateEt, params) -> IntradayBar`.
4. **Implement fetch path** — Add or extend an intraday handler to call `15min compact` with `extended_hours=false` and run the aggregator.
5. **Persistence** — Write aggregated `o/h/l/c/v` directly into the existing daily bar fields; continue populating `i*` fields until the OHLCV path is stable. Preserve W/M ratcheting intraday overlay logic.
6. **Schedule** — No change; existing schedule is sufficient.
7. **Tests** — Unit tests for aggregator edge cases: empty series, single bar, weekend, DST, missing anchor.
8. **Docs** — Update internal and partner docs; notify RS of new field semantics.

---

## 7. Success Criteria

- A tracked symbol added during trading hours has an intraday OHLCV bar available within one scheduler tick after the anchor time.
- The bar's `o/h/l/c/v` are derived from actual 15-minute AV data from 09:30 ET onward.
- Consumers can distinguish the intraday indicative bar from the finalized EOD bar.
- No regression in existing daily/weekly/monthly POST runs.

---

## 8. Affected Files (tentative)

- `@c:\aa\projects\av-proxy-api\functions\src\v2\alpha-vantage\handlers\av-intraday.handler.ts`
- `@c:\aa\projects\av-proxy-api\functions\src\v2\alpha-vantage\handlers\alpha-vantage-timeseries-base.handler.ts`
- `@c:\aa\projects\av-proxy-api\shared\alpha-vantage\av-endpoint-configs.ts`
- `@c:\aa\projects\av-proxy-api\functions\src\v2\alpha-vantage\firestore\av-intraday-ohlcv.writer.ts`
- `@c:\aa\projects\av-proxy-api\functions\src\v2\alpha-vantage\firestore\av-intraday-snapshot.writer.ts`
- `@c:\aa\projects\av-proxy-api\functions\src\v2\alpha-vantage\utils\av-intraday-aggregate.utils.ts`
- `@c:\aa\projects\av-proxy-api\functions\src\v2\alpha-vantage\jobs\intraday-snapshot-jobs.worker.ts`
- `@c:\aa\projects\av-proxy-api\functions\src\v2\alpha-vantage\data-refresher\av-time-series-refresh-manager.ts`
- `@c:\aa\projects\av-proxy-api\functions\src\v2\common\function-schedules.ts`

---

## 9. Consumer Guide

### What consumers will see

During regular trading hours, the daily bar's `o/h/l/c/v` fields will reflect today's intraday progress from 09:30 ET through the most recent 15-minute bar.

| Field | Intraday meaning | Finalized meaning (after POST run) |
|---|---|---|
| `o` | 09:30 ET open | Prior session's official open |
| `h` | Highest price observed so far today | Prior session's official high |
| `l` | Lowest price observed so far today | Prior session's official low |
| `c` | Close of the most recent 15-minute bar | Prior session's official close |
| `v` | Summed 15-minute volume so far today | Prior session's official volume |

### What is changing

- The `i*` fields (`ip`, `io`, `it`, `ic`, `ipc`) are still populated temporarily alongside the new OHLCV fields to give consumers a migration window.
- Consumers should begin using the standard `o/h/l/c/v` fields for intraday data.
- The nightly POST run will overwrite the same `o/h/l/c/v` fields with finalized EOD values.

### How to tell intraday from finalized

Use `barStatus` if available, or compare the bar's timestamp/date against the current trading date. Intraday values are indicative and should not be treated as final EOD data.

---

## 10. Next Step

- Monitor the 15-minute RTH OHLCV output during trading hours for a few sessions.
- Remove the daily `i*` dual-write once the OHLCV path is stable.
