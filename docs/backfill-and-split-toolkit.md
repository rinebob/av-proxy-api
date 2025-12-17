# Backfill & Split Maintenance Toolkit

This document describes the local Node/ts-node scripts used to manage historical Alpha Vantage time-series data and split metadata. It is intended for maintainers performing manual backfills, split corrections, or deep data audits.

Scripts covered (all under `functions/scripts/`):

- `backfill-data.ts`
- `debug-av-request.ts`
- `manage-splits.ts`
- `sync-splits.ts`
- `verify-data.ts`
- `diagnose-timeseries.ts`
- `repair-timeseries-metadata.ts`

Use this doc together with:

- `planning/split-adjustment-design.md` (high-level design for split-adjusted data)
- `docs/backend-functions-overview.md` (scheduler and storage model)
- `docs/local-emulator-workflow.md` (how to run emulators and HTTP flows)

---

## 0. Common Prerequisites

- **Environment files** in `functions/` (local/dev):
  - `functions/local-dev.env.alpha-vantage-proxy-api` (or a project-specific variant) with at least:
    - `ALPHAVANTAGE_API_KEY` (for direct AV calls used by some scripts)
    - `GCLOUD_PROJECT` (or equivalent project id for Firestore admin)
  - For emulator workflows:
    - `FIRESTORE_EMULATOR_HOST`, `FUNCTIONS_EMULATOR=true`, etc. (see `docs/local-emulator-workflow.md`).
- **Production AV key**:
  - In production, the Alpha Vantage API key is provided to Cloud Functions via Google Cloud-managed secrets (not local env files). See the **Secrets and Config** notes in `planning/project-plan.md` / `docs/backend-functions-overview.md` for details.
- **Install + shared build** (from repo root, once per clone or after changes in `shared/`):
  ```bash
  npm install
  npm run build:shared
  npm --prefix functions run copy-shared   # if present; otherwise ensure shared is built and resolvable
  cd functions
  npm install
  ```
- **Recommended ts-node invocation** (from `functions/`):
  ```bash
  npx ts-node -r tsconfig-paths/register -r module-alias/register scripts/<script>.ts
  ```

Unless explicitly stated, scripts can run against either **emulator** or **production**, depending on how `firebase-admin` is configured via env vars.

---

## 1. `backfill-data.ts` – Full-History Backfill with Split Injection

### Purpose

- Fetch full Alpha Vantage historical **time-series D/W/M adjusted data** for one or more symbols.
- Normalize AV responses into the canonical bar shape.
- Inject split coefficients from `symbol-data/{symbol}.splitHistory` into the bars.
- Persist bars via `saveAvTimeSeriesData` using `forceFullHistory: true` and `skipSplitPersistence: true` to avoid re-detecting splits from the injected coefficients.

This is the **main tool for rebuilding time-series history** after split corrections or logic changes.

### Scope

- Symbols:
  - Single symbol via `SYMBOL`.
  - Comma-separated list via `SYMBOLS`.
  - Otherwise all `tracked-symbols` in Firestore.
- Intervals (time-series):
  - Daily: `TIME_SERIES_DAILY_ADJUSTED` (mapped from `TimeSeriesInterval.DAILY`).
  - Weekly: `TIME_SERIES_WEEKLY_ADJUSTED`.
  - Monthly: `TIME_SERIES_MONTHLY_ADJUSTED`.
- For each symbol and interval:
  - Calls the appropriate v2 handler (`AvDailyTimeSeriesHandler`, `AvWeeklyTimeSeriesHandler`, `AvMonthlyTimeSeriesHandler`) with `outputsize=full`.
  - Normalizes the response into an array of `{ date, open, high, low, close, adjustedClose, volume, dividendAmount, splitCoefficient }`.
  - Injects splits from `splitHistory` onto the first bar with `b.date >= split.date`.
  - Optionally trims by date window before saving.

### Time Window Controls

Set via environment variables (all optional):

- `BACKFILL_FROM`: `YYYY-MM-DD` (inclusive, start of day).
- `BACKFILL_TO`: `YYYY-MM-DD` (inclusive, end of day).
- `BACKFILL_LOOKBACK_YEARS`: integer `N`; if `BACKFILL_FROM` is not set, uses "today minus N years".

If none are set, the script uses the full history provided by the handler/AV.

### When to Use

- After running `sync-splits.ts` to correct `splitHistory`.
- After manual split patches or removals where you want the time-series to reflect the corrected history.
- After changes to:
  - split adjustment / hybrid bar logic,
  - AV time-series handlers,
  - Firestore bar schema or `saveAvTimeSeriesData` behavior.

### Usage Examples

From `functions/`:

```bash
# All tracked symbols, all intervals, full history
npx ts-node -r tsconfig-paths/register -r module-alias/register scripts/backfill-data.ts

# Single symbol, all intervals
SYMBOL=NVDA \
  npx ts-node -r tsconfig-paths/register -r module-alias/register scripts/backfill-data.ts

# Single symbol, selected intervals
SYMBOL=TSLA \
BACKFILL_INTERVALS=DAILY,MONTHLY \
  npx ts-node -r tsconfig-paths/register -r module-alias/register scripts/backfill-data.ts

# Backfill last 10 years only
SYMBOL=AAPL \
BACKFILL_LOOKBACK_YEARS=10 \
  npx ts-node -r tsconfig-paths/register -r module-alias/register scripts/backfill-data.ts

# Backfill explicit date window
SYMBOL=GOOGL \
BACKFILL_FROM=2010-01-01 \
BACKFILL_TO=2020-12-31 \
  npx ts-node -r tsconfig-paths/register -r module-alias/register scripts/backfill-data.ts
```

### Safety Notes

- Uses `forceFullHistory: true`: treat as **destructive rebuild** of the time-series for the chosen symbol(s)/interval(s).
- Ensure you are targeting the correct project/emulator and that `splitHistory` is clean and correct before running.

---

## 2. `debug-av-request.ts` – Raw Alpha Vantage Sanity Check

### Purpose

- Minimal helper to validate that:
  - `ALPHAVANTAGE_API_KEY` is present and correct.
  - The machine can reach the AV API.
- Sends a single request to `TIME_SERIES_WEEKLY_ADJUSTED` for a hard-coded test symbol (`AAPL` in the current implementation).

### Behavior

- Reads `ALPHAVANTAGE_API_KEY` from env.
- Builds and logs the AV URL with the key redacted.
- Performs an HTTP GET with `axios` and logs:
  - HTTP status,
  - Full JSON body.

### When to Use

- Before deeper debugging when responses look suspicious or rate-limiting/network issues are suspected.
- To quickly confirm that a new API key is working.

### Usage

From `functions/`:

```bash
ALPHAVANTAGE_API_KEY=your_real_key \
  npx ts-node scripts/debug-av-request.ts
```

If you want to test a different symbol or function, temporarily edit the script; it is intentionally tiny.

---

## 3. `manage-splits.ts` – Manual / Diagnostic Split History Manager

### Purpose

Single CLI entry point that consolidates several historic one-off scripts into commands for inspecting and **simulating** changes to `splitHistory`.

Commands (all currently non-destructive):

- `clean`   – detect and propose de-duplication of `splitHistory` entries across all tracked symbols.
- `patch`   – simulate patching or inserting a split for one symbol/date.
- `remove`  – simulate removing a split for one symbol/date.
- `fetch`   – fetch raw AV SPLITS data for a single symbol (SoT view).
- `analyze` – summarize split counts and earliest split across all symbols.

### Behavior and Use Cases

#### `clean`

- Reads all `tracked-symbols`.
- Loads `symbol-data/{symbol}.splitHistory`.
- De-duplicates by `date`:
  - If multiple entries on the same date, keeps the one with `factor > 1` over `factor === 1`.
- Logs, per symbol, when duplicates exist:
  - `[SYMBOL] WOULD clean duplicates: <originalCount> -> <dedupedCount>`.
- **Does not write** the deduped history back.

**Use when** you suspect historic scripts or AV quirks have produced duplicate split entries.

#### `patch <symbol> <date> <factor>`

- Example: `patch GOOGL 2014-04-03 2.0`.
- Loads `splitHistory` for the symbol.
- If an entry for `date` exists, logs the factor change (`old -> new`).
- If missing, logs that a new entry would be appended with:
  - `date`, `factor`, `detectedAt`, `status: 'MANUAL_PATCH'`.
- Logs `WOULD save patched history ...` with old/new counts.

**Use when** you want to see the impact of a manual correction before actually persisting it (e.g., before editing via console or a follow-up patch script).

#### `remove <symbol> <date>`

- Loads `splitHistory` and filters out entries with matching `date`.
- Logs whether a removal would occur and the before/after counts.
- Does not persist changes.

**Use when** preparing to remove obviously incorrect/phantom splits.

#### `fetch <symbol>`

- Calls the AV SPLITS endpoint directly:
  - `https://www.alphavantage.co/query?function=SPLITS&symbol=<symbol>&apikey=<ALPHAVANTAGE_API_KEY>`.
- Logs the full response body.

**Use when** you need to compare our `splitHistory` with AV’s current SoT.

#### `analyze`

- Iterates all tracked symbols.
- For each symbol with non-empty `splitHistory`, logs:
  - `[SYMBOL] <count> splits. First: <YYYY-MM-DD>`.
- Tracks and prints the earliest split date seen across the universe and the symbol it belongs to, plus approximate years ago.

**Use when** deciding a reasonable historical lookback (e.g., 25–30 years) or just understanding dataset characteristics.

### Usage Examples

From `functions/`:

```bash
# Discover duplicate split entries (diagnostic only)
npx ts-node -r tsconfig-paths/register -r module-alias/register scripts/manage-splits.ts clean

# Simulate a patch
npx ts-node -r tsconfig-paths/register -r module-alias/register scripts/manage-splits.ts patch GOOGL 2014-04-03 2.0

# Simulate removing a split
npx ts-node -r tsconfig-paths/register -r module-alias/register scripts/manage-splits.ts remove TSLA 2022-08-31

# Fetch raw AV SPLITS data for one symbol
ALPHAVANTAGE_API_KEY=... \
  npx ts-node scripts/manage-splits.ts fetch NVDA

# Analyze earliest split across all symbols
npx ts-node -r tsconfig-paths/register -r module-alias/register scripts/manage-splits.ts analyze
```

### Safety Notes

- All commands are currently **read-only / diagnostic**. They log "WOULD" operations but do not persist updates.
- `manage-splits.ts` does **not** write `splitHistory` under any command; it is strictly an analysis/simulation tool today.
- If we later convert any command to write mode, this doc should be updated and such operations should be treated as destructive.

---

## 4. `sync-splits.ts` – Sync `splitHistory` from AV (SoT) with Patches

### Purpose

- Treat the AV SPLITS endpoint as the **primary source of truth** for split history, with a small set of hard-coded corrections for known issues.
- Normalize AV SPLITS responses and write a clean, sorted `splitHistory` array for each symbol under `symbol-data/{symbol}`.

This is the **canonical way to reset and standardize `splitHistory`** before running backfills.

> Writer semantics: outside of the core real-time refresh flows (which may append same-day split events when a new split is detected for "today"), `sync-splits.ts` is the **only script in this toolkit** that writes to `splitHistory`. All other scripts (including `manage-splits.ts`, `verify-data.ts`, and `backfill-data.ts`) treat `splitHistory` as read-only.

### Behavior

- Resolves `symbols` via (in order):
  - `SYMBOL` (single),
  - `SYMBOLS` (comma-separated list),
  - or all entries in `tracked-symbols`.
- Validates `ALPHAVANTAGE_API_KEY`.
- For each symbol:
  - Calls AV SPLITS.
  - If `data.data` is an empty array, treats it as "no splits" and writes `splitHistory: []`.
  - Otherwise maps each raw entry to:
    - `{ date: effective_date, factor: parseFloat(split_factor), detectedAt, status: 'SYNCED_FROM_AV' }`.
  - Applies patches from `SPLIT_PATCHES` (e.g., GOOGL 2014-04-03 → 2.0).
  - Sorts splits ascending by `date`.
  - Writes `splitHistory` to `symbol-data/{symbol}` via a merge update.

### When to Use

- After discovering that existing `splitHistory` is polluted or missing entries.
- Before running `backfill-data.ts` so backfills are based on a clean, patched split history.
- Periodically, when AV improves/updates their SPLITS data or new split issues are found and patched.

### Usage

From `functions/`:

```bash
# Sync all tracked symbols
ALPHAVANTAGE_API_KEY=... \
  npx ts-node -r tsconfig-paths/register -r module-alias/register scripts/sync-splits.ts

# Single symbol
ALPHAVANTAGE_API_KEY=... \
SYMBOL=GOOGL \
  npx ts-node -r tsconfig-paths/register -r module-alias/register scripts/sync-splits.ts

# Explicit list
ALPHAVANTAGE_API_KEY=... \
SYMBOLS=AAPL,MSFT,BAC \
  npx ts-node -r tsconfig-paths/register -r module-alias/register scripts/sync-splits.ts
```

Each symbol run is rate-limited by a short delay to avoid tripping AV limits.

### Safety Notes

- This script **actively overwrites `splitHistory`** for each processed symbol.
- Confirm that `SPLIT_PATCHES` contains all required manual corrections (and no incorrect ones) before running against production.

---

## 5. `verify-data.ts` – Split Ratio & Spike Verification + Bar Inspection

### Purpose

End-to-end integrity checker for split-adjusted time-series data.

Capabilities:

1. **Split ratio verification (weekly)** – ensures `rawClose / adjustedClose` aligns with the cumulative product of split factors.
2. **Hybrid bar spike detection (monthly)** – identifies months where highs are inconsistent with closes around split dates.
3. **Target bar inspection (`--inspect`)** – inspect a particular `YYYY-MM-DD` daily bar (and neighbors) for a symbol.

### Symbol Selection

- `SYMBOL` → verify a single symbol.
- `SYMBOLS` → comma-separated list.
- Otherwise: all `tracked-symbols`.

### Inspect Mode (`--inspect YYYY-MM-DD`)

- For each symbol (usually run with a single symbol):
  - Computes the year of `inspectDate` and reads the split-adjusted daily year doc via `getSymbolTimeSeriesYearDocPath`.
  - Locates the bar where `b.d === inspectDate`.
  - Logs that bar plus its previous and next bars:
    - `>> TARGET <date>: O= H= L= C=`
    - `PREV`/`NEXT` neighbors.
- Skips all other verification for that run.

**Usage:**

```bash
# Inspect a specific AAPL daily bar
SYMBOL=AAPL \
  npx ts-node -r tsconfig-paths/register -r module-alias/register scripts/verify-data.ts --inspect 2020-08-31
```

### Standard Verification Mode (no `--inspect`)

Per symbol, does two main checks:

#### 1. Split Ratio Verification (Weekly Adjusted)

- Loads `splitHistory` from `symbol-data/{symbol}` and sorts by date.
- For each split:
  - Picks a week slightly before the split (by looking back a few days).
  - Reads:
    - Raw weekly adjusted series (`isSplitAdjusted=false`).
    - Split-adjusted weekly series (`isSplitAdjusted=true`).
  - Finds the last bar before the split date in each stream.
  - Computes:
    - `expectedFactor`: product of all split factors with `s.date > bar.d`.
    - `actualRatio = rawBar.c / adjBar.c`.
    - `percentDiff = |actualRatio - expectedFactor| / expectedFactor`.
  - Flags a pass if `percentDiff < 0.01` (1%). Logs detailed values either way.

This confirms that the weekly data reflect the cumulative split history correctly.

#### 2. Hybrid Bar Spike Detection (Monthly Adjusted)

- Reads the full split-adjusted monthly series via `getSymbolTimeSeriesAllDocPath`.
- For each split:
  - Locates the monthly bar for the same month (`b.d` prefix `YYYY-MM`).
  - Computes `ratio = high / close`.
  - If `split.factor >= 2` and `ratio > 1.5`, flags as a spike; otherwise logs a clean check.

This catches hybrid bars where highs/opens are pre-split but closes are post-split (visual spikes on charts).

#### Summary

- Tracks total checks and failures.
- Prints:
  - `Total Checks: <n>`
  - `Failures: <m>`
- Exits with **non-zero status** when there are failures (useful for CI or manual gating).

### When to Use

- After `sync-splits.ts` + `backfill-data.ts` to validate that everything is consistent.
- After changing split math, AV handlers, or bar schema that might affect historical correctness.
- As a regression check for any code changes touching time-series persistence.

### Usage Examples

```bash
# Full verification across all tracked symbols
npx ts-node -r tsconfig-paths/register -r module-alias/register scripts/verify-data.ts

# Single symbol
SYMBOL=GOOGL \
  npx ts-node -r tsconfig-paths/register -r module-alias/register scripts/verify-data.ts

# Explicit symbol list
SYMBOLS=AAPL,TSLA,NVDA \
  npx ts-node -r tsconfig-paths/register -r module-alias/register scripts/verify-data.ts

# Inspect mode (daily bar context only)
SYMBOL=AAPL \
  npx ts-node -r tsconfig-paths/register -r module-alias/register scripts/verify-data.ts --inspect 2020-08-31
```

---

## 6. Recommended End-to-End Workflow

A typical manual repair/backfill flow:

1. **Confirm AV access (optional)**
   - Run `debug-av-request.ts` to validate the AV key and network if in doubt.

2. **Sync split history from AV (SoT)**
   - Run `sync-splits.ts` for all or a subset of symbols to refresh `splitHistory` from AV with patches applied.

3. **Inspect split history (optional but recommended)**
   - Use `manage-splits.ts clean` to see where duplicates exist.
   - Use `manage-splits.ts fetch <symbol>` for side-by-side comparison with AV raw data.
   - Optionally simulate patches/removals with `manage-splits.ts patch/remove` before making permanent changes elsewhere.

4. **Rebuild time-series with injected splits**
   - Run `backfill-data.ts` with appropriate `SYMBOL`/`SYMBOLS`, `BACKFILL_INTERVALS`, and optional time windows.
   - This produces a new, clean history based on the synced `splitHistory`.

5. **Verify correctness**
   - Run `verify-data.ts` for all or a subset of symbols.
   - Investigate any `✕` entries using `--inspect` and visual charts (e.g., the Chart View in the Angular app).

6. **Repeat selectively if needed**
   - For symbols with persistent issues, adjust `splitHistory` (typically via `sync-splits.ts` + any required manual console edits), re-run `backfill-data.ts` just for those symbols, then re-run `verify-data.ts`.

This toolkit plus the scheduler-based refresh flows gives you a robust way to correct and maintain long-term historical data quality without ad hoc one-off scripts.

---

## 7. Cleanup Note: Deprecated Flags

Historically, some handlers/scripts used flags like `__checkWriteToggle` or `manualWriteToggle*` to gate writes. These have been removed from current toolkit flows and should **not** be used going forward.

- If you encounter references to `__checkWriteToggle` or `manualWriteToggle` in the codebase, treat them as technical debt and remove/inline as part of a future cleanup task (tracked separately in `planning/project-tasks.md` / `planning/TASK.md`).

---

## 8. `diagnose-timeseries.ts` – Structural Time-Series Validation

### Purpose

- Provide a **non-destructive structural validator** for Alpha Vantage time-series data in Firestore.
- Check that both **raw** and **split-adjusted** time-series documents are **well-formed**, internally consistent, and compatible with the storage model described in `docs/backend-functions-overview.md`.
- Designed to run against **either the local emulator or production**, depending on how `firebase-admin` is configured via env vars.

This script complements `verify-data.ts`:

- `verify-data.ts` focuses on **financial correctness** (split ratios, spike detection).
- `diagnose-timeseries.ts` focuses on **schema/shape correctness** (sorted bars, valid timestamps, metadata alignment, etc.).

### Scope

- **Environments**
  - Emulator: when `FIRESTORE_EMULATOR_HOST` / `FUNCTIONS_EMULATOR` are set and `scripts-util.setupEmulator()` is used.
  - Production: when `firebase-admin` is initialized against the real project (no emulator env vars).

- **Collections / Paths**
  - Raw time-series: `symbol-data/{SYMBOL}/time-series/av-<interval>`
  - Split-adjusted time-series: `symbol-data/{SYMBOL}/sa-time-series/av-<interval>`
  - Under each parent:
    - DAILY / WEEKLY: `.../years/{YYYY}` year shards.
    - MONTHLY: single `.../all` document.

- **Intervals** (all supported by handlers):
  - Daily adjusted (`TIME_SERIES_DAILY_ADJUSTED`)
  - Weekly adjusted (`TIME_SERIES_WEEKLY_ADJUSTED`)
  - Monthly adjusted (`TIME_SERIES_MONTHLY_ADJUSTED`)

- **Symbol selection**
  - `SYMBOL` → a single symbol.
  - `SYMBOLS` → comma-separated list.
  - Otherwise: all symbols under `tracked-symbols`.

### Checks Performed

For each symbol / endpoint / interval / series (raw + split-adjusted):

1. **Document presence**
   - Parent doc exists for `time-series` and `sa-time-series`.
   - Expected year shards (`years/{YYYY}`) or monthly `all` doc exist when referenced by metadata.

2. **Bar array structure**
   - `bars` is an array.
   - All entries have a numeric `t` and (when present) `d` in `YYYY-MM-DD` form.
   - Bars are **sorted ascending by `t`** (no out-of-order timestamps).
   - `d` and `t` agree: `new Date(t).toISOString().slice(0,10) === d` when `d` is set.
   - `dow` matches `computeDowFromDateString(d)`.

3. **Numeric sanity**
   - `o/h/l/c/v` are finite numbers (placeholder bars where all are zero are allowed but flagged).
   - When present, `ac`, `dv`, `sc` are finite; `sc > 0`.
   - Intraday fields (daily only):
     - If `io` is present, `it` matches the ET clock derived from `io`.

4. **Metadata alignment (year shards and monthly all-doc)**
   - `count` equals `bars.length`.
   - `firstBarTs` equals `bars[0].t`.
   - `lastBarTs` equals `bars[bars.length - 1].t`.
   - `latest` equals the latest **non-placeholder** bar, using the same heuristic as `saveAvTimeSeriesData`.
   - `latestUtcIso` and `latestEtDateTime` correspond to `latest.t`.

5. **Top-level metadata sanity**
   - For each parent doc (`symbol-data/{SYMBOL}/(sa-)time-series/av-<interval>`):
     - `metadata.availableYears` matches the actual set of `years/{YYYY}` docs when present.
     - `metadata.histStartTs` and `metadata.histEndTs` align with the earliest/latest `t` across all shards/all-docs for that series.

All issues are reported as structured log lines with:

- `type` (e.g., `UNSORTED_BARS`, `BAD_DOW`, `META_MISMATCH`, `INVALID_NUMERIC`)
- `path` (document path)
- `index` (bar index when relevant)
- `details` (brief human-readable summary)

The script exits with **non-zero** status if any issues are detected, making it suitable for CI gating or manual regression checks after refactors.

### Usage Examples

From `functions/` (recommended ts-node invocation):

```bash
# All tracked symbols, all intervals, emulator or prod depending on env
npx ts-node -r tsconfig-paths/register -r module-alias/register scripts/diagnose-timeseries.ts

# Single symbol, all intervals
SYMBOL=AAPL \
  npx ts-node -r tsconfig-paths/register -r module-alias/register scripts/diagnose-timeseries.ts

# Explicit symbol list
SYMBOLS=NVDA,TSLA,GOOGL \
  npx ts-node -r tsconfig-paths/register -r module-alias/register scripts/diagnose-timeseries.ts
```

Environment selection follows the same pattern as the rest of this toolkit:

- Emulator: set `FIRESTORE_EMULATOR_HOST` / `FUNCTIONS_EMULATOR=true` and use `scripts-util.setupEmulator()` in the implementation.
- Production: omit emulator env vars so `firebase-admin` talks to the real Firestore project.

---

## 9. `repair-timeseries-metadata.ts` – Top-Level Metadata Repair from Stored Bars

### Purpose

- Repair **parent doc metadata** for Alpha Vantage time-series by recomputing it from the actual stored bars.
- Targets both **raw** (`time-series`) and **split-adjusted** (`sa-time-series`) series for:
  - Daily adjusted (`TIME_SERIES_DAILY_ADJUSTED`)
  - Weekly adjusted (`TIME_SERIES_WEEKLY_ADJUSTED`)
  - Monthly adjusted (`TIME_SERIES_MONTHLY_ADJUSTED`)
- Fixes drift such as:
  - `META_AVAILABLE_YEARS_MISMATCH` (metadata only lists `[2025]` but shards span 1999–2025).
  - `META_HIST_START_MISMATCH` / `META_HIST_END_MISMATCH` (histStartTs/EndTs do not match earliest/latest bar).

This script is **metadata-only**; it never mutates the bar arrays themselves.

### Behavior

For each tracked symbol and each AV time-series endpoint (D/W/M, raw + sa):

- Resolves the canonical parent doc path using the same helpers as `diagnose-timeseries.ts`.
- Loads the underlying data:
  - **Daily / Weekly**: reads all `years/{YYYY}` docs and flattens their `bars` arrays.
  - **Monthly**: reads the `all` doc and uses its `bars` array.
- Derives:
  - `histStartTs` = min `t` across all bars.
  - `histEndTs` = max `t` across all bars.
  - `years` = sorted unique set of UTC years derived from `t`.
- Writes back to the parent `metadata` (merge update):
  - `histStartTs`, `histEndTs` and their `Timestamp` date counterparts.
  - `availableYears` = derived `years` array.
  - `latestBarTimestamp` = `Timestamp` from `histEndTs` when available.
- Logs one summary line per symbol:
  - `[SYMBOL] updatedSeries=N` where `N` is the number of series for which metadata changed.
- Prints `Total series updated: <count>` at the end and exits with **0** even if no changes were needed.

### When to Use

- After detecting widespread metadata mismatches with `diagnose-timeseries.ts` (e.g., `META_AVAILABLE_YEARS_MISMATCH`).
- After large-scale backfills or refactors of the time-series writers (weekly/monthly merge logic, new v2 handlers).
- As a one-time cleanup when migrating from legacy writers to the new v2 merge-based writers.

Once metadata has been repaired **and** all live writers go through `saveAvTimeSeriesData` / `upsertAvDailyBar` (which call `bumpTimeSeriesTopLevelMetadata`), this script should only be needed for rare one-off fixes.

### Usage Examples

From `functions/` (recommended invocation):

```bash
# All tracked symbols, all D/W/M series (raw + sa)
npx ts-node -r tsconfig-paths/register -r module-alias/register \
  scripts/repair-timeseries-metadata.ts

# Single symbol (when script supports filters, future-friendly example)
SYMBOL=AAPL \
  npx ts-node -r tsconfig-paths/register -r module-alias/register \
    scripts/repair-timeseries-metadata.ts
```

### Environment Selection (Prod vs Emulator)

`repair-timeseries-metadata.ts` uses the same admin initialization and emulator helper as other scripts:

- **Production Firestore**
  - Ensure `USE_EMULATOR_SCRIPTS` is **unset** or one of `0/false/off`.
  - Ensure `FIRESTORE_EMULATOR_HOST`, `FUNCTIONS_EMULATOR`, and `FIREBASE_AUTH_EMULATOR_HOST` are **not** set.
  - Application Default Credentials (ADC) must point at the prod project.

- **Firestore Emulator**
  - Set `USE_EMULATOR_SCRIPTS=1` (or leave unset, as scripts default to emulator) so `scripts-util.setupEmulator()` wires:
    - `FIRESTORE_EMULATOR_HOST=localhost:8080`
    - `FUNCTIONS_EMULATOR=true`
    - `FIREBASE_AUTH_EMULATOR_HOST=localhost:9099`
  - Make sure the emulator is running and pre-seeded with the symbols you care about.

---

## 10. PROD vs Emulator Playbook: Backfill → Diagnose → Repair

This section captures the **exact sequences** that were validated during the 2025‑12 refactor for both production and emulator environments.

### 10.1 Production Firestore

From the repo root (PowerShell syntax shown):

1. **Target PROD and configure AV key**

   ```powershell
   # Ensure scripts do NOT auto-wire the emulator
   $env:USE_EMULATOR_SCRIPTS = "0"
   Remove-Item Env:FIRESTORE_EMULATOR_HOST      -ErrorAction SilentlyContinue
   Remove-Item Env:FUNCTIONS_EMULATOR           -ErrorAction SilentlyContinue
   Remove-Item Env:FIREBASE_AUTH_EMULATOR_HOST  -ErrorAction SilentlyContinue

   # Alpha Vantage API key for PROD
   $env:ALPHAVANTAGE_API_KEY = "<PROD_AV_KEY>"
   ```

2. **Recent-window backfill via new v2 writers**

   ```powershell
   # Example: all tracked symbols, weekly+monthly only, recent window
   $env:BACKFILL_INTERVALS       = "WEEKLY,MONTHLY"
   $env:BACKFILL_FROM            = "2025-10-01"
   $env:BACKFILL_TO              = "2025-12-17"
   $env:BACKFILL_LOOKBACK_YEARS  = "0"  # ignored when FROM/TO are set

   npx ts-node -r tsconfig-paths/register -r module-alias/register \
     functions/scripts/backfill-data.ts
   ```

3. **Diagnostics (structure + metadata)**

   ```powershell
   # Weekly, broad history
   npx ts-node -r tsconfig-paths/register -r module-alias/register \
     functions/scripts/diagnose-timeseries.ts \
       --interval WEEKLY \
       --from 1995-01-01 \
       --to   2025-12-31

   # Monthly
   npx ts-node -r tsconfig-paths/register -r module-alias/register \
     functions/scripts/diagnose-timeseries.ts \
       --interval MONTHLY \
       --from 2018-01-01 \
       --to   2025-12-31

   # Optional: daily, recent window
   npx ts-node -r tsconfig-paths/register -r module-alias/register \
     functions/scripts/diagnose-timeseries.ts \
       --interval DAILY \
       --from 2025-10-01 \
       --to   2025-12-17
   ```

   - If you see only metadata issues (`META_AVAILABLE_YEARS_MISMATCH`, `META_HIST_START_MISMATCH`, etc.), proceed to step 4.

4. **Repair metadata from actual bars**

   ```powershell
   npx ts-node -r tsconfig-paths/register -r module-alias/register \
     functions/scripts/repair-timeseries-metadata.ts
   ```

5. **Re-run diagnostics to confirm green state**

   ```powershell
   # Weekly (full span)
   npx ts-node -r tsconfig-paths/register -r module-alias/register \
     functions/scripts/diagnose-timeseries.ts \
       --interval WEEKLY \
       --from 1995-01-01 \
       --to   2025-12-31

   # Monthly (sanity)
   npx ts-node -r tsconfig-paths/register -r module-alias/register \
     functions/scripts/diagnose-timeseries.ts \
       --interval MONTHLY \
       --from 2018-01-01 \
       --to   2025-12-31
   ```

### 10.2 Firestore Emulator

For local development and CI-style checks, mirror the same workflow against the emulator.

1. **Target emulator and AV key**

   ```powershell
   # Enable script-level emulator wiring
   $env:USE_EMULATOR_SCRIPTS = "1"

   # AV key for emulator runs
   $env:LOCAL_EMULATOR_ALPHAVANTAGE_API_KEY = "<AV_KEY_FOR_EMULATOR>"
   Remove-Item Env:ALPHAVANTAGE_API_KEY -ErrorAction SilentlyContinue
   ```

   Ensure emulators are running (e.g., `npm run emulators:safe`) and `tracked-symbols` is populated.

2. **Backfill via v2 writers (same window as PROD)**

   ```powershell
   $env:BACKFILL_INTERVALS       = "DAILY,WEEKLY,MONTHLY"
   $env:BACKFILL_FROM            = "2025-10-01"
   $env:BACKFILL_TO              = "2025-12-17"
   $env:BACKFILL_LOOKBACK_YEARS  = "0"

   npx ts-node -r tsconfig-paths/register -r module-alias/register \
     functions/scripts/backfill-data.ts
   ```

3. **Diagnostics (emulator)**

   ```powershell
   # Weekly, full span
   npx ts-node -r tsconfig-paths/register -r module-alias/register \
     functions/scripts/diagnose-timeseries.ts \
       --interval WEEKLY \
       --from 1995-01-01 \
       --to   2025-12-31

   # Daily, recent window
   npx ts-node -r tsconfig-paths/register -r module-alias/register \
     functions/scripts/diagnose-timeseries.ts \
       --interval DAILY \
       --from 2025-10-01 \
       --to   2025-12-17

   # Monthly
   npx ts-node -r tsconfig-paths/register -r module-alias/register \
     functions/scripts/diagnose-timeseries.ts \
       --interval MONTHLY \
       --from 2018-01-01 \
       --to   2025-12-31
   ```

4. **Repair emulator metadata**

   ```powershell
   npx ts-node -r tsconfig-paths/register -r module-alias/register \
     functions/scripts/repair-timeseries-metadata.ts
   ```

5. **Re-run diagnostics on emulator**

   ```powershell
   # Weekly
   npx ts-node -r tsconfig-paths/register -r module-alias/register \
     functions/scripts/diagnose-timeseries.ts \
       --interval WEEKLY \
       --from 1995-01-01 \
       --to   2025-12-31

   # Daily
   npx ts-node -r tsconfig-paths/register -r module-alias/register \
     functions/scripts/diagnose-timeseries.ts \
       --interval DAILY \
       --from 2025-10-01 \
       --to   2025-12-17

   # Monthly
   npx ts-node -r tsconfig-paths/register -r module-alias/register \
     functions/scripts/diagnose-timeseries.ts \
       --interval MONTHLY \
       --from 2018-01-01 \
       --to   2025-12-31
   ```

When both PROD and emulator runs report `Total issues: 0` across DAILY/WEEKLY/MONTHLY, the AV time-series storage and metadata pipeline is considered healthy.

