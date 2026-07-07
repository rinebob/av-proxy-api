# W/M Intraday Snapshot – Implementation Plan

> **Status: IMPLEMENTED**
>
> **Scope:** Extend the existing intraday snapshot pipeline to also write `ip/io/it/ic/ipc`
> fields onto the **trailing weekly and monthly bars** on every PRE run, matching the data
> freshness of daily charts. No new financial data types, no new Cloud Task queues, no new
> schedulers — this is an extension to the existing `processIntradaySnapshotJobInternal`
> worker and the Firestore write helpers.

---

## Background & Goal

Consumer apps generate intraday signals on W/M charts the same way they do on daily charts.
To do this, the W/M trailing bar must carry fresh `ip/io/it` fields reflecting the most
recent trade price — the same snapshot used for the daily trailing bar.

Currently:
- **Daily trailing bar** — gets `ip/io/it/ic/ipc` on every PRE run (8am, 10am, 12pm ET) ✅
- **Weekly trailing bar** — never gets intraday snapshot fields during PRE ❌
- **Monthly trailing bar** — never gets intraday snapshot fields during PRE ❌

After POST runs, W/M bars get full OHLCV from AV. On the next PRE run, the `ip/io/it`
fields on the new period's trailing bar are written fresh, overwriting any prior values.

---

## Design Decisions

| Decision | Choice | Rationale |
|---|---|---|
| Source data for W/M intraday | Same 1-min `ip/io/it` already fetched for daily | No additional AV API calls — reuse the price already captured in the worker |
| `ic/ipc` on W/M | Compute against prior W/M bar's `ac` (or `c`) | Same pattern as daily — delta vs. prior period's adjusted close |
| New Firestore helpers? | **Yes — two new functions** | `upsertAvWeeklyIntradaySnapshot` and `upsertAvMonthlyIntradaySnapshot`, mirroring `upsertAvDailyIntradaySnapshot` |
| Touch the POST W/M merge helpers? | **No** | POST paths (`mergeWeeklyCompactWindowIntoShards`, `mergeMonthlyCompactWindowIntoAllDocs`) write full OHLCV and already stamp `barStatus`. They clear `ip` implicitly because AV's compact response doesn't carry intraday fields — this is correct POST behavior. |
| `barStatus` on W/M PRE bars | Computed the same way as today — `clockPt === INTRADAY_FIRST_TICK` → `-1`, else `0` | Already handled by `upsertAvDailyIntradaySnapshot`; same logic applies to the new W/M helpers |
| PDR notification changes | **Yes — `barStatusWeekly` and `barStatusMonthly` now emitted on PRE** | PRE now touches W/M bars, so RS needs to know their barStatus |
| New Cloud Task queue? | **No** | Same `processIntradaySnapshotJobTask` queue |
| New scheduler? | **No** | Same 8am/10am/12pm cron |
| New job tracking fields? | **Minimal** | Existing job doc tracks per-symbol completion. Consider adding `intervals: ['daily','weekly','monthly']` field for observability |

---

## How It Works

The intraday worker already has `ip` (the latest intraday price) and `io` (the epoch ms
timestamp) from fetching `TIME_SERIES_INTRADAY`. It uses these to write the daily snapshot.
The exact same values will be written to the W/M trailing bars — they share the same
underlying stock price.

The "trailing W/M bar" is identified by finding the bar in the W/M shard whose date covers
the current trading week / month. For weekly: the ISO week containing `marketDate`. For
monthly: the YYYY-MM containing `marketDate`.

---

## Firestore Write Paths

### New: `upsertAvWeeklyIntradaySnapshot(options)`

**File:** `functions/src/v2/alpha-vantage/firestore/av-firestore-helper.ts`

```typescript
options: {
  symbol: string;
  marketDate: string;  // YYYY-MM-DD ET trading date — identifies which week's bar to patch
  ip: number;          // latest intraday price
  io: number;          // epoch ms of intraday bar timestamp
  clockPt?: string;    // for barStatus computation
}
```

Logic:
- Derive the year from `marketDate` → locate the correct year-shard doc
- Find the bar whose ISO week matches `marketDate`'s ISO week
- If bar missing (shouldn't happen after POST has run at least once): create a placeholder
- Patch `ip`, `io`, `it` (formatted HH:mm ET), `ic`, `ipc` (vs prior week's `ac`/`c`)
- Stamp `barStatus: clockPt === INTRADAY_FIRST_TICK ? -1 : 0`
- Write via `tx.set(..., { merge: true })`
- Do **not** bump parent metadata (same as daily — avoid churn during trading hours)

### New: `upsertAvMonthlyIntradaySnapshot(options)`

**File:** `functions/src/v2/alpha-vantage/firestore/av-firestore-helper.ts`

```typescript
options: {
  symbol: string;
  marketDate: string;  // YYYY-MM-DD ET trading date — identifies which month's bar to patch
  ip: number;
  io: number;
  clockPt?: string;
}
```

Logic:
- Monthly bars live in a single `all` doc (not year-sharded)
- Find the bar whose `d.slice(0, 7)` matches `marketDate.slice(0, 7)` (YYYY-MM)
- Patch `ip`, `io`, `it`, `ic`, `ipc` (vs prior month's `ac`/`c`)
- Stamp `barStatus: clockPt === INTRADAY_FIRST_TICK ? -1 : 0`
- Write via `ref.set(..., { merge: true })`
- Do **not** bump parent metadata

---

## Worker Changes

**File:** `functions/src/v2/alpha-vantage/jobs/intraday-snapshot-jobs.worker.ts`

After the existing `upsertAvDailyIntradaySnapshot` call, add:

```typescript
await upsertAvWeeklyIntradaySnapshot({
  symbol: symbolUpper,
  marketDate,
  ip,
  io: latest.msEt,
  clockPt,
});

await upsertAvMonthlyIntradaySnapshot({
  symbol: symbolUpper,
  marketDate,
  ip,
  io: latest.msEt,
  clockPt,
});
```

All three writes use the same `ip` and `io` — one AV API call, three bar patches.

---

## PDR Notification Changes

**File:** `functions/src/v2/alpha-vantage/jobs/intraday-snapshot-jobs.aggregator.ts`

PRE now touches W/M bars. Add `barStatusWeekly` and `barStatusMonthly` to both the
local enqueue and cross-project RS publish. Compute using `prevTradingDay`:

```
barStatusWeekly:  prevTradingDay(marketDate) in different ISO week  → -1, else 0
barStatusMonthly: prevTradingDay(marketDate) in different month     → -1, else 0
```

Note: `barStatusWeekly/-Monthly` is `-1` only on the first PRE of a new period (the
`INTRADAY_FIRST_TICK` guard still applies — a new period on a non-8am run still gets `0`
at the run level, and W/M use `prevTradingDay` to detect period boundary, not `clockPt`).

Updated PRE PDR attributes:

| Attribute | Value | Condition |
|---|---|---|
| `barStatusDaily` | `-1` | 8am tick |
| `barStatusDaily` | `0` | 10am or 12pm tick |
| `barStatusWeekly` | `-1` | 8am tick AND `prevTradingDay` in different ISO week |
| `barStatusWeekly` | `0` | all other PRE runs |
| `barStatusMonthly` | `-1` | 8am tick AND `prevTradingDay` in different month |
| `barStatusMonthly` | `0` | all other PRE runs |

---

## Key Edge Cases

| Scenario | Daily `ip` | Weekly `ip` | Monthly `ip` |
|---|---|---|---|
| 8am PRE, normal mid-week mid-month trading day | Written ✅ | Written ✅ | Written ✅ |
| 8am PRE, first trading day of new week (e.g. Monday or post-holiday Tuesday) | Written ✅ | Written on new week's bar ✅ | Written ✅ |
| 8am PRE, first trading day of new month | Written ✅ | Written ✅ | Written on new month's bar ✅ |
| POST run — W/M bar gets full OHLCV from AV | `ip` remains | `ip` not present in AV compact response — field left as-is after merge (POST merge does a spread of existing bar) | same |
| W/M bar does not yet exist (e.g. very first run of the week) | n/a | Create placeholder bar | Create placeholder bar |

> **POST clears `ip` implicitly:** AV's `TIME_SERIES_WEEKLY_ADJUSTED` and
> `TIME_SERIES_MONTHLY_ADJUSTED` compact responses do not include intraday fields. The
> POST merge helpers (`mergeWeeklyCompactWindowIntoShards`, `mergeMonthlyCompactWindowIntoAllDocs`)
> spread the existing bar and overwrite OHLCV — they do not explicitly clear `ip/io/it`.
> This means `ip` persists across POST into the next PRE run, which is fine — the next
> PRE will overwrite it with a fresh value. If desired, POST helpers can explicitly set
> `ip: undefined` to keep the doc clean. **Decide at implementation time.**

---

## Files Changed

| File | Change Type | Notes |
|---|---|---|
| `functions/src/v2/alpha-vantage/firestore/av-firestore-helper.ts` | **Modify** | Add `upsertAvWeeklyIntradaySnapshot` and `upsertAvMonthlyIntradaySnapshot` |
| `functions/src/v2/alpha-vantage/jobs/intraday-snapshot-jobs.worker.ts` | **Modify** | Call both new upsert helpers after the existing daily upsert |
| `functions/src/v2/alpha-vantage/jobs/intraday-snapshot-jobs.aggregator.ts` | **Modify** | Add `barStatusWeekly` and `barStatusMonthly` to PRE PDR attributes |
| `planning/bar-status-plan.md` | **Modify** | Update PRE PDR section — W/M absent → W/M now present |

**Unchanged:** `CompactBar` type (fields already exist), all POST write helpers, schedulers,
Cloud Task queue, `time-series-readers.ts`, RS call signature.

---

## Prerequisites

- `barStatus` write-at-write-time implementation must be complete ✅ (done)
- `upsertAvDailyIntradaySnapshot` pattern is the template for the two new helpers

---

## Open Questions

1. **Should POST explicitly clear `ip/io/it` on W/M bars?** Pros: cleaner doc, no stale
   intraday data after close. Cons: extra work in merge helpers, and the next PRE will
   overwrite anyway. Low priority — decide at implementation.
2. **Placeholder bar creation:** If the W/M trailing bar doesn't exist yet (e.g. very
   first PRE of a new period before any POST has run), should we create a placeholder
   with `o/h/l/c/v = 0` like daily does, or skip the write? Recommendation: create
   placeholder (same as daily) so the bar exists for charting consumers.
