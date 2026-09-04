# Partner Data Ready (PDR) Message Guide

This document describes every Partner Data Ready message produced by the
time-series pipeline, with one concrete example per message type.

## Topics at a glance

| Topic | Purpose | Granularity |
|---|---|---|
| `partner-data-ready` | Run-level completeness signals | One message per run completion |

All time-series pipeline PDR messages are published to the
`partner-data-ready` topic. Consumers subscribe to this topic to receive
run-level "the data is ready for marketDate X" signals.

---

## Scheduler cadence

| Scheduler | Schedule | Timezone | Sequence | Phase |
|---|---|---|---|---|
| `refreshAvDailyTimeSeriesIntradayHourly` | `0 8,10,12 * * 1-5` | America/Los_Angeles | n/a | PRE |
| `refreshAvTimeSeriesPostAllIntervals` | `35 13 * * 1-5` | America/Los_Angeles | A | POST |
| `refreshAvDailyTimeSeriesPostEveningRetry00` | `0 18 * * 1-5` | America/Los_Angeles | B | POST |
| `refreshAvDailyTimeSeriesPostMorning0700` | `0 4 * * 1-5` | America/Los_Angeles | C | POST |

All times are weekdays only. All schedulers use `America/Los_Angeles`.

---

## 1. Intraday PRE runs (8:00 / 10:00 / 12:00 PT)

**Topic:** `partner-data-ready`
**Trigger:** `refreshAvDailyTimeSeriesIntradayHourly` ->
`runIntradaySnapshotJobsForSymbols` -> `onIntradayRunJobTerminal` ->
`publishIntradayPdr`

One PDR per intraday tick (3 per trading day). The 8/10/12 runs are
differentiated by `clockPt` and the `runId` suffix.

### Message body (JSON)

```json
{
  "version": "v1",
  "runId": "2026-01-24-FRI-LIVE-0800",
  "phase": "pre",
  "intervals": ["intraday"],
  "time": 1737720000000,
  "marketDate": "2026-01-24",
  "env": "production",
  "status": "end",
  "runStatus": "completed",
  "durationMs": 180000,
  "finalizedCountTotal": 758,
  "pendingCount": 0,
  "trigger": "scheduled"
}
```

### Pub/Sub attributes

```
runId=2026-01-24-FRI-LIVE-0800
version=v1
phase=pre
marketDate=2026-01-24
env=production
runType=intraday-snapshot
clockPt=0800
successes=758
permanentFailures=0
barStatusDaily=0
barStatusWeekly=0
barStatusMonthly=0
```

The 10:00 and 12:00 runs are identical except:

- `runId` ends in `-1000` / `-1200`
- `clockPt=1000` / `clockPt=1200`

### `barStatus` fields

`barStatusDaily` / `barStatusWeekly` / `barStatusMonthly` indicate whether
this PRE run captured the first bar of a new period:

- `0` = period already in progress (not the first bar)
- `-1` = first bar of a new period (daily/weekly/monthly boundary)

Weekly and monthly use the previous trading day to determine period
boundaries (e.g. Monday Jan 27 is a new weekly period only if the previous
Friday Jan 24 was in a different ISO week).

---

## 2. POST run -- Sequence A (1:35 PM PT)

**Topic:** `partner-data-ready`
**Trigger:** `refreshAvTimeSeriesPostAllIntervals` ->
`runAllTimeSeriesIntervalsPost` -> `onRealtimeRunJobTerminal` ->
`enqueueDataReadyInternal`

Three PDR messages per A run -- one per interval (DAILY, WEEKLY, MONTHLY).

### Message body (JSON) -- DAILY example

```json
{
  "version": "v1",
  "runId": "2026-01-24-FRI-A-DAILY-LIVE-POST-1335",
  "phase": "post",
  "intervals": ["daily"],
  "time": 1737746100000,
  "marketDate": "2026-01-24",
  "env": "production",
  "status": "end",
  "runStatus": "completed",
  "durationMs": 420000,
  "finalizedCountTotal": 756,
  "pendingCount": 0,
  "excludeSymbols": ["AAPL", "MSFT"],
  "trigger": "scheduled"
}
```

### Pub/Sub attributes

```
runId=2026-01-24-FRI-A-DAILY-LIVE-POST-1335
version=v1
phase=post
marketDate=2026-01-24
env=production
runType=ts-post-all-intervals
interval=daily
successes=756
permanentFailures=0
```

WEEKLY and MONTHLY are identical except:

- `intervals: ["weekly"]` / `["monthly"]`
- `interval=weekly` / `interval=monthly`
- `runId` ends in `-WEEKLY-LIVE-POST-1335` / `-MONTHLY-LIVE-POST-1335`

### `excludeSymbols` semantics (A run only)

The A run is the initial full-universe pass. `excludeSymbols` lists symbols
that are still stale (failed to fetch or didn't reach period-end). Consumers
should treat the A run as "all symbols except those in `excludeSymbols` are
fresh for this marketDate."

---

## 3. POST run -- Sequence B (6:00 PM PT)

**Topic:** `partner-data-ready`
**Trigger:** `refreshAvDailyTimeSeriesPostEveningRetry00` -> same path as A

Same message shape as A, with key differences:

- `runId` ends in `-B-DAILY-LIVE-POST-1800` (etc.)
- `includeSymbols` instead of `excludeSymbols`
- Only symbols that became fresh in this retry pass are listed

### Message body (JSON) -- DAILY example

```json
{
  "version": "v1",
  "runId": "2026-01-24-FRI-B-DAILY-LIVE-POST-1800",
  "phase": "post",
  "intervals": ["daily"],
  "time": 1737756600000,
  "marketDate": "2026-01-24",
  "env": "production",
  "status": "end",
  "runStatus": "completed",
  "durationMs": 95000,
  "finalizedCountTotal": 2,
  "pendingCount": 0,
  "includeSymbols": ["AAPL", "MSFT"],
  "trigger": "scheduled"
}
```

### Pub/Sub attributes

```
runId=2026-01-24-FRI-B-DAILY-LIVE-POST-1800
version=v1
phase=post
marketDate=2026-01-24
env=production
runType=ts-post-all-intervals
interval=daily
successes=2
permanentFailures=0
```

### `includeSymbols` semantics (B/C runs)

B and C are retry-only passes. `includeSymbols` lists symbols that were
previously stale but became fresh in this pass. Consumers should ingest only
the symbols listed in `includeSymbols`. If `includeSymbols` is absent or
empty, no symbols became fresh -- the message is still sent for run-level
completeness accounting.

---

## 4. POST run -- Sequence C (4:00 AM PT, next day)

**Topic:** `partner-data-ready`
**Trigger:** `refreshAvDailyTimeSeriesPostMorning0700` -> same path as A/B

Same shape as B. Key differences:

- `runId` ends in `-C-DAILY-LIVE-POST-0400` (etc.)
- `includeSymbols` = symbols that became fresh in this final pass
- The C run is marked as a **deadline run**: the worker treats persistently
  stale data as a terminal failure after retries, so any symbol still stale
  after C will appear in `permanentFailures` rather than remaining pending

### Message body (JSON) -- DAILY example

```json
{
  "version": "v1",
  "runId": "2026-01-25-SAT-C-DAILY-LIVE-POST-0400",
  "phase": "post",
  "intervals": ["daily"],
  "time": 1737805800000,
  "marketDate": "2026-01-24",
  "env": "production",
  "status": "end",
  "runStatus": "completed_with_errors",
  "durationMs": 60000,
  "finalizedCountTotal": 1,
  "pendingCount": 0,
  "includeSymbols": ["TSLA"],
  "trigger": "scheduled"
}
```

### Pub/Sub attributes

```
runId=2026-01-25-SAT-C-DAILY-LIVE-POST-0400
version=v1
phase=post
marketDate=2026-01-24
env=production
runType=ts-post-all-intervals
interval=daily
successes=1
permanentFailures=1
```

Note: `runStatus` is `completed_with_errors` when `permanentFailures > 0`.

---

## Differentiation summary

### PRE vs POST

| Field | PRE (8/10/12) | POST (A/B/C) |
|---|---|---|
| `phase` | `"pre"` | `"post"` |
| `runType` attr | `intraday-snapshot` | `ts-post-all-intervals` |
| `intervals` | `["intraday"]` | `["daily"]` / `["weekly"]` / `["monthly"]` |
| `clockPt` attr | `0800` / `1000` / `1200` | (not set) |
| `runId` pattern | `{date}-{dow}-LIVE-{clockPt}` | `{date}-{dow}-{seq}-{interval}-LIVE-POST-{clockPt}` |
| `includeSymbols`/`excludeSymbols` | (not set) | A: `excludeSymbols`, B/C: `includeSymbols` |
| `barStatus*` attrs | set (0 or -1) | (not set) |

### A vs B vs C

| Field | A (initial) | B (evening retry) | C (morning catch-up) |
|---|---|---|---|
| `runId` sequence segment | `-A-` | `-B-` | `-C-` |
| `runId` clock segment | `1335` (suffix) | `1800` (suffix) | `0400` (suffix) |
| Run doc `runType` | `ts-post-all-intervals-initial` | `ts-post-all-intervals-retry` | `ts-post-all-intervals-retry` |
| Pub/Sub `runType` attr | `ts-post-all-intervals` | `ts-post-all-intervals` | `ts-post-all-intervals` |
| Symbol selection | `excludeSymbols` (full universe minus stale) | `includeSymbols` (retry successes only) | `includeSymbols` (retry successes only) |
| Deadline run | no | no | yes (stale = terminal failure) |

### Known gap

The `runType` Pub/Sub attribute is `ts-post-all-intervals` for all three
sequences (A/B/C). The `initial` vs `retry` distinction exists only on the
Firestore run document, not on the Pub/Sub message. Consumers filtering on
Pub/Sub attributes alone cannot distinguish A from B/C -- they must parse the
`runId` or check for `includeSymbols` vs `excludeSymbols` presence.

If subscription-level filtering on `initial` vs `retry` is needed, add the
sequence or run-type distinction to the Pub/Sub attributes in
`realtime-run-aggregator.ts`.

---

## `runId` format reference

### Intraday PRE

```
{marketDate}-{dow}-LIVE-{clockPt}
```

Example: `2026-01-24-FRI-LIVE-0800`

### POST (A/B/C)

```
{marketDate}-{dow}-{sequence}-{interval}-LIVE-POST-{clockPt}
```

Example: `2026-01-24-FRI-A-DAILY-LIVE-POST-1335`

Where:

- `marketDate` = ET trading date (YYYY-MM-DD)
- `dow` = 3-letter day of week (MON, TUE, WED, THU, FRI, SAT, SUN)
- `sequence` = `A`, `B`, or `C`
- `interval` = `DAILY`, `WEEKLY`, or `MONTHLY`
- `clockPt` = PT clock label (HHMM) for all runs

---

## Field reference

### Message body fields

| Field | Type | Description |
|---|---|---|
| `version` | string | Schema version (`"v1"`) |
| `runId` | string | Unique run identifier (see format reference above) |
| `phase` | string | `"pre"` or `"post"` |
| `intervals` | string[] | Intervals covered by this run |
| `time` | number | Unix epoch milliseconds (message send time) |
| `marketDate` | string | ET trading date (YYYY-MM-DD) |
| `env` | string | Environment (`"production"`, `"dev"`, etc.) |
| `status` | string | `"begin"` or `"end"` (pipeline currently only sends `"end"`) |
| `runStatus` | string | `"completed"` or `"completed_with_errors"` |
| `durationMs` | number | Run duration in milliseconds |
| `finalizedCountTotal` | number | Number of successfully finalized jobs |
| `pendingCount` | number | Number of pending jobs (always 0 for END messages) |
| `includeSymbols` | string[]? | Symbols that became fresh in this retry pass (B/C only) |
| `excludeSymbols` | string[]? | Symbols still stale after this run (A only) |
| `trigger` | string? | `"scheduled"` or `"manual"` |

### Pub/Sub attributes

| Attribute | Present on | Description |
|---|---|---|
| `runId` | all | Run identifier |
| `version` | all | Schema version |
| `phase` | all | `"pre"` or `"post"` |
| `marketDate` | all | ET trading date |
| `env` | all | Environment |
| `runType` | all | `intraday-snapshot` or `ts-post-all-intervals` |
| `clockPt` | PRE only | PT clock label (HHMM) |
| `interval` | POST only | `daily`, `weekly`, or `monthly` |
| `successes` | all | Success count (string) |
| `permanentFailures` | all | Permanent failure count (string) |
| `barStatusDaily` | PRE only | `0` or `-1` |
| `barStatusWeekly` | PRE only | `0` or `-1` |
| `barStatusMonthly` | PRE only | `0` or `-1` |
