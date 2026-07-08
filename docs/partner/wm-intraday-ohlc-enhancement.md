# Weekly & Monthly Intraday OHLC Enhancement — Consumer Guide

Audience: External partner engineering teams consuming weekly/monthly time-series data.

Last updated: 2026-07-08

---

## Overview

This document describes an **upcoming enhancement** to how the backend writes intraday data into weekly and monthly bars during trading hours. Consumers should review this and update their data handling before the change is deployed.

Currently, intraday snapshot runs (hourly during RTH) only write the `i*` intraday fields (`ip`, `io`, `it`, `ic`, `ipc`) to the trailing weekly and monthly bar. The bar's OHLCV fields (`o`, `h`, `l`, `c`, `ac`) are left untouched until the next scheduled POST (nightly EOD) run.

After this enhancement, the weekly and monthly trailing bar's OHLCV will be **updated on every intraday run** to reflect the current period's progress up to the time of the tick.

---

## What Is Changing

### Before (current behavior)

During trading hours, the trailing weekly/monthly bar looks like this:

| Field | Value | Source |
|---|---|---|
| `o` | Prior period's open | Last POST run |
| `h` | Prior period's high | Last POST run |
| `l` | Prior period's low | Last POST run |
| `c` | Prior period's close | Last POST run |
| `ac` | Prior period's adjusted close | Last POST run |
| `ip` | Current intraday price | Intraday run (updated hourly) |
| `ic` | Change vs prior period close | Intraday run (updated hourly) |
| `ipc` | % Change vs prior period close | Intraday run (updated hourly) |

The `o/h/l/c` fields are **stale** during the trading day — they reflect the prior completed period until the next POST run writes a finalized bar.

### After (new behavior)

During trading hours, the trailing weekly/monthly bar will be updated as follows on each intraday run:

| Field | Behavior | Notes |
|---|---|---|
| `o` | **Set once** — the period open price | Set to `ip` only if the existing `o` is `0` (new period placeholder). Not changed on subsequent ticks. |
| `h` | **Ratchets up** — `Math.max(existing.h, ip)` | Updated if `ip` exceeds the current high. Never decreases intraday. |
| `l` | **Ratchets down** — `Math.min(existing.l, ip)` | Updated if `ip` falls below the current low. Never increases intraday. |
| `c` | **Always set to `ip`** | Reflects the most recent price as the current close. |
| `ac` | **Always set to `ip`** | No split adjustment mid-period; approximates adjusted close with current price. |
| `ip` | Current intraday price | Unchanged from current behavior. |
| `ic` | Change vs prior period close | Unchanged from current behavior. |
| `ipc` | % Change vs prior period close | Unchanged from current behavior. |
| `v` | Unchanged | Volume is not available from the 1-min intraday source in a period-cumulative form. |

---

## Key Behaviors to Understand

### New Period Placeholder

If today starts a new ISO week (for weekly) or a new calendar month (for monthly), and no bar yet exists for the current period, a placeholder bar is created on the first intraday tick. Under the new behavior:

- `o`, `h`, `l`, `c`, `ac` will all be seeded from `ip` on that first tick
- Subsequent ticks will ratchet `h`/`l` and update `c`/`ac` as normal

### Intraday `h`/`l` are approximations

The `h` and `l` fields are updated only on each **hourly** intraday tick (not tick-by-tick). They reflect the highest and lowest observed price at the time of each hourly run, not the true intraday high/low. Intraday price swings between ticks will not be captured.

### POST still wins

The next scheduled POST (nightly EOD) run will overwrite `o/h/l/c/ac` with AV's finalized values for the period. Any intraday approximations will be corrected at that point. The intraday OHLC values should be treated as **indicative/intraday estimates**, not finalized data.

### `barStatus` field

The `barStatus` field on the bar indicates its lifecycle state:

| Value | Meaning |
|---|---|
| `-1` | First intraday tick of a new period (new week or new month). Bar is a fresh placeholder. |
| `0` | Subsequent intraday tick within an existing period. Bar has prior OHLCV + intraday overlay. |
| `1` | Finalized bar (written by POST run). OHLCV is authoritative. |

---

## Impact on Consumers

### Weekly bars (`av-weekly-adjusted`)

- The trailing bar for the current ISO week will have `o/h/l/c/ac` updated hourly during RTH.
- `h` will reflect the highest intraday price seen this week across all hourly ticks so far today (but not prior days this week — prior days' highs are already baked into the bar's OHLCV from the last POST).
- The bar's `d` field (date string) reflects the week's AV anchor date (Friday of the week), not today's date.

### Monthly bars (`av-monthly-adjusted`)

- The trailing bar for the current calendar month will have `o/h/l/c/ac` updated hourly.
- Same ratchet logic applies. The bar's `d` field reflects the month's AV anchor date (last trading day of the month), not today's date.

### Recommended consumer logic

```
if (bar.barStatus === 1) {
  // Finalized bar — trust o/h/l/c/ac fully
} else if (bar.barStatus === 0 || bar.barStatus === -1) {
  // Intraday bar — c/ac are current price, h/l are intraday approximations
  // Use ip/ic/ipc for change display
  // h/l are directionally correct but not tick-precise
}
```

---

## No API Contract Changes

- The endpoint URL, auth model, and response envelope are **unchanged**.
- The `CompactBar` schema is **unchanged** — no new fields are added. Existing fields (`o`, `h`, `l`, `c`, `ac`) simply carry updated values during trading hours.
- Consumers already receiving W/M bars with `barStatus = 0` or `-1` during trading hours should expect those bars to now carry meaningful intraday OHLCV instead of stale prior-period values or zeros.

---

## Deployment Timeline

This enhancement is **not yet deployed**. This document is provided in advance so consuming teams can review and prepare. The deployment date will be communicated via the standard partner change notification channel.

---

## Questions

Contact the backend team via the standard partner channel.
