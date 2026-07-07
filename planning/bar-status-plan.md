# Bar Status Flag – Implementation Plan

> **Status: IMPLEMENTED ✅**
>
> **Scope:** Add a `barStatus` flag (`-1 | 0 | 1`) to (1) every `CompactBar` returned by
> `partnerTimeSeriesV2` and (2) every PDR (data-ready) Pub/Sub notification published by
> SA pipelines. All logic lives entirely in SA. RS reads `barStatus` off the notification
> and off individual bars. **RS sends no extra parameters — just call the endpoint as normal.**

---

## Background & Goal

SA delivers D/W/M bars to RS consumers multiple times per day:

- **3× intraday (PRE)** — 8am, 10am, 12pm ET. Daily bars get an intraday snapshot (`ip/io/it`
  fields). W/M bars carry full OHLC updated by AV for the in-progress period — fully formed
  but not yet final for that period.
- **1× nightly (POST)** — finalized OHLC written to all three intervals after market close.

The trailing bar is interim the vast majority of the time:

| Interval | `barStatus = 1` frequency |
|---|---|
| Daily   | ~1 in 4 responses (POST nightly only) |
| Weekly  | ~1 in 25 responses (POST on last trading day of week only) |
| Monthly | ~1 in 90–95 responses (POST on last trading day of month only) |

### Convention (from TradeStation)

- `-1` = first update of a new bar period (period just opened)
- `0`  = interim/in-progress update
- `1`  = final closing update of the bar (period end)

---

## What RS Receives

### 1. PDR Pub/Sub Notification

Every PDR notification carries **per-interval** `barStatus` attributes named `barStatusDaily`,
`barStatusWeekly`, and `barStatusMonthly`.

> **Why strings?** Pub/Sub message attributes are string-only by protocol — the key-value
> pairs used for filtering/routing cannot carry numeric types. RS must parse each value
> to integer: `parseInt(attr.barStatusDaily, 10)`. The JSON payload body (not attributes)
> could carry integers, but routing logic at the subscriber is typically attribute-based,
> so we keep all `barStatus` values in attributes as strings.

**Intraday PRE runs** (`runType = 'intraday-snapshot'`) — daily, weekly, and monthly trailing bars are all updated:

| Attribute | Value | Meaning |
|---|---|---|
| `barStatusDaily` | `-1` | 8am tick — first update of a new daily bar |
| `barStatusDaily` | `0` | 10am or 12pm tick — interim update |
| `barStatusWeekly` | `-1` | 8am tick AND `prevTradingDay` is in a different ISO week |
| `barStatusWeekly` | `0` | all other PRE runs |
| `barStatusMonthly` | `-1` | 8am tick AND `prevTradingDay` is in a different calendar month |
| `barStatusMonthly` | `0` | all other PRE runs |

**POST nightly runs** (`runType = 'ts-post-all-intervals'`) — all three intervals updated:

| Attribute | Value | Condition |
|---|---|---|
| `barStatusDaily` | `1` | Always — daily POST is always the final bar |
| `barStatusWeekly` | `1` | `nextTradingDay(marketDate)` is in a different ISO week |
| `barStatusWeekly` | `0` | `nextTradingDay(marketDate)` is in the same ISO week |
| `barStatusMonthly` | `1` | `nextTradingDay(marketDate)` is in a different month |
| `barStatusMonthly` | `0` | `nextTradingDay(marketDate)` is in the same month |

> **Key distinction:** POST always completes the daily bar (`barStatusDaily = 1`), but
> the weekly and monthly bars are only final on the last trading day of their respective
> periods. RS should check each interval's attribute independently.

### 2. Per-Bar `barStatus` on `CompactBar`

Every bar in the `partnerTimeSeriesV2` response now includes `barStatus: -1 | 0 | 1`.

**Historical bars** (all bars except the trailing/current-period bar) always have `barStatus: 1` —
they represent closed periods and never change.

**The trailing bar** (the last bar in the series, covering the current period) carries the
live status written by whichever pipeline run last touched it:

| Last write | Trailing bar `barStatus` |
|---|---|
| PRE 8am intraday snapshot | `-1` |
| PRE 10am or 12pm intraday snapshot | `0` |
| POST nightly, daily | `1` |
| POST nightly, weekly — `nextTradingDay` in different ISO week | `1` |
| POST nightly, weekly — `nextTradingDay` in same ISO week | `0` |
| POST nightly, monthly — `nextTradingDay` in different month | `1` |
| POST nightly, monthly — `nextTradingDay` in same month | `0` |

> **Note on daily `-1` per bar:** For daily bars, `-1` requires knowing the `clockPt` at write
> time — which the intraday snapshot worker does (`clockPt` is in the job payload). So a daily
> bar written by the 8am PRE will have `barStatus: -1` on the bar itself. RS should treat the
> PDR notification `barStatus` as the authoritative run-level signal and the per-bar `barStatus`
> as a convenience for display/processing uniformity.

---

## Key Edge Cases

| Scenario | PDR `barStatusDaily` | PDR `barStatusWeekly` | PDR `barStatusMonthly` | Trailing bar `barStatus` |
|---|---|---|---|---|
| 8am PRE, first day of new week | `-1` | `-1` | `0` | `-1` |
| 8am PRE, first day of new month | `-1` | `0` | `-1` | `-1` |
| 8am PRE, first day of new week AND month | `-1` | `-1` | `-1` | `-1` |
| 8am PRE, normal mid-week mid-month day | `-1` | `0` | `0` | `-1` |
| 10am/12pm PRE, any day | `0` | `0` | `0` | `0` |
| POST, daily (any day) | `1` | — | — | `1` |
| POST, weekly, Friday (`nextTradingDay` = Mon = different week) | `1` | `1` | — | `1` |
| POST, weekly, Thursday before holiday Friday | `1` | `1` | — | `1` |
| POST, weekly, Monday or mid-week | `1` | `0` | — | `0` |
| POST, monthly, last trading day of month | `1` | — | `1` | `1` |
| POST, monthly, any other day | `1` | — | `0` | `0` |
| Any historical bar (not trailing) | n/a | n/a | n/a | `1` always |

> **Important:** On a POST run that is also the last trading day of the week AND month,
> `barStatusWeekly = 1` AND `barStatusMonthly = 1` simultaneously. This happens on
> the last Friday of a month, for example.

---

## Architecture — Where barStatus Is Computed

`barStatus` is **written at write time** by each pipeline writer, where `phase` and
`clockPt` are explicitly known. It is stored on the `CompactBar` in Firestore.
The HTTP endpoint (`partnerTimeSeriesV2`) simply returns bars as-is — no serve-time
computation, no parameters needed from RS.

### Write paths

| Writer | File | barStatus logic |
|---|---|---|
| `upsertAvDailyIntradaySnapshot` | `av-firestore-helper.ts` | `clockPt === '0800'` → `-1`, else `0` |
| `upsertAvWeeklyIntradaySnapshot` | `av-firestore-helper.ts` | delegates to `_upsertWmIntradaySnapshotCore`; `clockPt === '0800'` → `-1`, else `0` |
| `upsertAvMonthlyIntradaySnapshot` | `av-firestore-helper.ts` | delegates to `_upsertWmIntradaySnapshotCore`; `clockPt === '0800'` → `-1`, else `0` |
| `_internalUpsertDailyBar` (POST daily) | `av-firestore-helper.ts` | always `1` (called with `finalizedAtMs`) |
| `mergeWeeklyCompactWindowIntoShards` (POST weekly) | `av-firestore-helper.ts` | `nextTradingDay` crosses ISO week → `1`, else `0` |
| `mergeMonthlyCompactWindowIntoAllDocs` (POST monthly) | `av-firestore-helper.ts` | `nextTradingDay` crosses month → `1`, else `0` |

### PDR publishers

| Publisher | File | Attributes emitted |
|---|---|---|
| Intraday PRE | `intraday-snapshot-jobs.aggregator.ts` | `barStatusDaily`, `barStatusWeekly`, `barStatusMonthly` (all three, every PRE run) |
| POST nightly | `time-series-run-completion.publisher.ts` | `barStatusDaily=1`, `barStatusWeekly`, `barStatusMonthly` (calendar-computed) |

All values appear in the Pub/Sub message **attributes** (string `"-1"`, `"0"`, or `"1"`).
The intraday cross-project RS topic publish carries the same attributes.

---

## `BarStatusService` Module

**File:** `functions/src/v2/common/bar-status/bar-status.service.ts`

Pure functions, no I/O, fully testable in isolation.

### `computeRunBarStatus(phase, clockPt): -1 | 0 | 1`

Used by PDR publishers. `clockPt` is always known at publish time.

```
POST                                  →   1
PRE, clockPt === '0800'               →  -1
PRE, clockPt !== '0800'               →   0
```

### `nextTradingDay(dateStr) / prevTradingDay(dateStr)`

Used by weekly/monthly write paths. Both skip weekends and NYSE holidays via the
existing `isUsMarketHolidayEt()` utility — fully algorithmic, no static list, no
annual maintenance.

### `INTRADAY_FIRST_TICK = '0800'`

**File:** `functions/src/v2/alpha-vantage/jobs/job-config.ts`

Co-located with the schedule `0 8,10,12 * * 1-5`. If the schedule changes, update
this constant to match.

---

## Files Changed

| File | Change |
|---|---|
| `shared/alpha-vantage/av-time-series.types.ts` | Added `barStatus?: -1 \| 0 \| 1` to `CompactBar` |
| `functions/src/v2/alpha-vantage/jobs/job-config.ts` | Added `INTRADAY_FIRST_TICK = '0800'` |
| `functions/src/v2/common/bar-status/bar-status.service.ts` | **New** — `nextTradingDay`, `prevTradingDay`, `computeRunBarStatus` |
| `functions/src/v2/alpha-vantage/firestore/av-firestore-helper.ts` | Stamp `barStatus` in all four write paths |
| `functions/src/v2/alpha-vantage/jobs/intraday-snapshot-jobs.worker.ts` | Pass `clockPt` to `upsertAvDailyIntradaySnapshot` |
| `functions/src/v2/partner/time-series-run-completion.publisher.ts` | Stamp PDR with `barStatusDaily=1`, `barStatusWeekly`, `barStatusMonthly` (calendar-computed) |
| `functions/src/v2/alpha-vantage/jobs/intraday-snapshot-jobs.aggregator.ts` | Stamp PRE PDR with `barStatusDaily`, `barStatusWeekly`, and `barStatusMonthly` |

**Unchanged:** `partnerTimeSeriesV2` HTTP handler, `time-series-readers.ts` (reader just
returns stored bars), all backfill scripts, Firestore security rules, RS call signature.

---

## RS Integration Checklist

- [ ] Parse `barStatusDaily`, `barStatusWeekly`, `barStatusMonthly` attributes from PDR notification (string → int)
- [ ] For intraday PRE runs (`runType = 'intraday-snapshot'`): all three attributes are present — `barStatusDaily`, `barStatusWeekly`, `barStatusMonthly`
- [ ] For POST runs (`runType = 'ts-post-all-intervals'`): all three attributes are present
- [ ] Use `barStatusDaily` to route daily bar logic (`-1` day-start, `0` interim, `1` final)
- [ ] Use `barStatusWeekly` to know if the weekly bar is final for its period
- [ ] Use `barStatusMonthly` to know if the monthly bar is final for its period
- [ ] Read `barStatus` off each `CompactBar` from `partnerTimeSeriesV2` response for per-bar processing
- [ ] No changes to how RS calls `partnerTimeSeriesV2` — no new query params

---

## Future / Out of Scope

- **Remove `phase` query param** from `partnerTimeSeriesV2` — kept as-is to avoid a breaking
  change. Future cleanup once RS confirms it is not using it.
- Backfilling `barStatus` onto historical bars — not needed; historical bars already have
  `barStatus: 1` written by the next POST run that touches them.
- Intraday (sub-daily) intervals — `partnerTimeSeriesV2` serves D/W/M only.
