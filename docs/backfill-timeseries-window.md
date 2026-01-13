# Backfill Time-Series Window Script

Script: `functions/scripts/backfill-timeseries-window.ts`  
Purpose: Perform a **bounded** Alpha Vantage time-series backfill for a date window, with **durable, resumable progress tracking** in Firestore.

This is the **primary SA time-series window backfill tool**. Use it when you need to surgically repair a date range for DAILY / WEEKLY / MONTHLY without replaying full history.

---

## Overview

This script backfills Alpha Vantage time-series data over a date window:

- Supports **DAILY**, **WEEKLY**, and **MONTHLY** intervals.
- Works over either:
  - All tracked symbols, or
  - A specified symbol subset.
- Uses Firestore to **persist run state**, allowing safe retries and restarts.

Each logical run is identified by a **required** `BACKFILL_ID`, which is used as the Firestore document ID under `system/backfill-runs/runs/{BACKFILL_ID}`.

---

## Firestore Schema

Collection: `system`

Document paths:

- **Aggregate container doc (latest run metadata)**
  - `system/backfill-runs`
  - Fields:
    - `mostRecent: string` – BACKFILL_ID of the most recent run for this tool.
    - `status: 'COMPLETED' | 'COMPLETED_WITH_ERRORS'` – overall status of the most recent run.
    - `runFinished: string` – ISO timestamp (human-readable) when the most recent run finished.
    - `totalSymbols: number` – number of symbols processed in the most recent run.
    - `intervals: string[]` – intervals that actually had data written in the most recent run.
      - Contains `DAILY` / `WEEKLY` / `MONTHLY` **only if at least one symbol** had non-empty bars for that interval.
      - Example: if the run only backfilled daily bars, `intervals = ['DAILY']` (no `WEEKLY`/`MONTHLY`).

- **Per-run documents**
  - `system/backfill-runs/runs/{BACKFILL_ID}`

Document shape (`BackfillRun`):

- **Identity & timestamps**
  - `backfillId: string`
  - `createdAt: Date`
  - `updatedAt: Date`

- **Config snapshot**
  - `intervals: ('DAILY' | 'WEEKLY' | 'MONTHLY')[]`
  - `backfillFrom: string` (YYYY-MM-DD, inclusive)
  - `backfillTo: string | null` (YYYY-MM-DD, inclusive; null = “today”)
  - `dryRun: boolean`
  - `delayMs: number`
  - `scope: 'all' | 'partial'`  
    - `all` = all tracked symbols  
    - `partial` = explicit `SYMBOLS` list

- **Universe & progress**
  - `allSymbols: string[]` (sorted, frozen snapshot for this run)
  - `cursorIndex: number` (`-1` = nothing processed yet)
  - `totalSymbols: number`
  - `processedCount: number`
  - `lastSymbolProcessed: string | null`

- **Status**
  - `status: 'PENDING' | 'RUNNING' | 'COMPLETED' | 'FAILED'`
  - `lastError?: string`

- **History**
  - `history: BackfillRunHistoryEntry[]`
  - Each entry:
    - `startedAt: Date`
    - `endedAt?: Date`
    - `reason: 'kickoff' | 'restart' | 'manual'`
    - `startingSymbol: string | null`
    - `exitStatus?: 'ok'`

---

## Environment Variables

**Required**

- `BACKFILL_ID`  
  Logical run identifier, used as `system/backfill-runs/runs/{BACKFILL_ID}`.  
  Should be **stable** and human-readable.

- `BACKFILL_FROM=YYYY-MM-DD`  
  Lower bound (inclusive) for the backfill window.

**Optional**

- `BACKFILL_TO=YYYY-MM-DD`  
  Upper bound (inclusive).  
  If omitted or empty, treated as “today”.

- `SYMBOLS=NVDA,QQQ,AAPL`  
  Comma-separated explicit list.  
  If set → `scope='partial'`.  
  If omitted → `scope='all'` and uses all tracked symbols.

- `INTERVALS=DAILY,WEEKLY,MONTHLY`  
  Subset of supported intervals.  
  Default: `DAILY,WEEKLY,MONTHLY`.

- `DRY_RUN=1`  
  When set, logs actions but does **not** write to Firestore for time-series data.

- `DELAY_MS=1000`  
  Optional delay between symbols (ms). Helps throttle AV calls.

- `USE_FIRESTORE_EMULATOR=1`  
  Use Firestore emulator instead of production.

---

## Run Lifecycle

### 1. First Run (Kickoff)

1. Script validates `BACKFILL_ID`, `BACKFILL_FROM`, `BACKFILL_TO`.
2. Computes the symbol universe:
   - If `SYMBOLS` set → use explicit list.
   - Else → fetch all tracked symbols.
3. Sorts and freezes `allSymbols`.
4. Creates `system/backfill-runs/runs/{BACKFILL_ID}` with:
   - Config snapshot.
   - Universe snapshot.
   - `cursorIndex = -1`, `processedCount = 0`.
   - `status = 'RUNNING'`.
   - `history` with one entry:
     - `reason: 'kickoff'`
     - `startingSymbol` = first symbol in `allSymbols` (or `null`).

5. Loops symbols **from index 0** and performs the backfill.

### 2. Progress Tracking

On each symbol:

- Updates in-memory:
  - `cursorIndex`
  - `processedCount`
  - `lastSymbolProcessed`

Every N symbols (currently `writeEvery = 5`), it writes:

- `cursorIndex`
- `processedCount`
- `lastSymbolProcessed`
- `updatedAt`

to `system/backfill-runs/runs/{BACKFILL_ID}`.

### 3. Resume / Restart

When re-running with an existing `BACKFILL_ID`:

1. Loads existing `BackfillRun`.
2. Validates that `BACKFILL_FROM` and `BACKFILL_TO` match the stored values.
3. Uses previously saved `allSymbols` as the universe.
4. Determines resume point:
   - `startingIndex = cursorIndex + 1` (or `0` if missing).
5. Appends a `history` entry:
   - `reason: 'restart'`
   - `startingSymbol` = symbol at `startingIndex` (or `null`).

The symbol loop then resumes from `cursorIndex + 1`.

### 4. Completion

When the loop finishes:

- Reads the latest run doc and history.
- Marks the last history entry with:
  - `endedAt = now`
  - `exitStatus = 'ok'`.
- Updates the run doc with:
  - Final `cursorIndex`, `processedCount`, `lastSymbolProcessed`.
  - `status = 'COMPLETED'`.
  - `updatedAt = now`.
  - Updated `history`.

---

## Naming `BACKFILL_ID`

Recommended naming convention:

```text
BF_TS_<INTERVALS>_<FROM>_TO_<TO_OR_TODAY>_<SCOPE>_<RUNSTAMP>
```

Examples:

- Full-universe daily window to today:

  ```text
  BF_TS_DAILY_2025-01-02_TO_TODAY_ALL_20260109T1700
  ```

- Partial universe, multi-interval:

  ```text
  BF_TS_DWM_2024-10-01_TO_2024-12-31_PARTIAL_20260109T1700
  ```

Where:

- `<INTERVALS>`:
  - `D` = DAILY, `W` = WEEKLY, `M` = MONTHLY, or explicit like `DAILY`.
- `<SCOPE>`:
  - `ALL` or `PARTIAL`.
- `<RUNSTAMP>`:
  - Local timestamp or scheduler slot (e.g. `20260109T1700`).

---

## Usage Examples

### Fresh daily backfill (all tracked symbols, to today)

```powershell
$env:BACKFILL_ID = "BF_TS_DAILY_2025-01-02_TO_TODAY_ALL_20260109T1700"
$env:BACKFILL_FROM = "2025-01-02"
$env:BACKFILL_TO = ""
$env:INTERVALS = "DAILY"
$env:DELAY_MS = "1000"
$env:USE_FIRESTORE_EMULATOR = "1"

npm run ts:scripts functions/scripts/backfill-timeseries-window.ts
```

### Resume after failure

Use **exactly the same** `BACKFILL_ID`, `BACKFILL_FROM`, and `BACKFILL_TO`:

```powershell
$env:BACKFILL_ID = "BF_TS_DAILY_2025-01-02_TO_TODAY_ALL_20260109T1700"
$env:BACKFILL_FROM = "2025-01-02"
$env:BACKFILL_TO = ""
$env:INTERVALS = "DAILY"
$env:DELAY_MS = "1000"
$env:USE_FIRESTORE_EMULATOR = "1"

npm run ts:scripts functions/scripts/backfill-timeseries-window.ts
```

The script reads `cursorIndex` and resumes from `cursorIndex + 1`.

### Partial subset backfill

```powershell
$env:BACKFILL_ID = "BF_TS_DAILY_2025-01-02_TO_2025-03-31_PARTIAL_NVDA_AAPL_20260109T1700"
$env:BACKFILL_FROM = "2025-01-02"
$env:BACKFILL_TO = "2025-03-31"
$env:SYMBOLS = "NVDA,AAPL"
$env:INTERVALS = "DAILY"
$env:DELAY_MS = "1000"

npm run ts:scripts functions/scripts/backfill-timeseries-window.ts
```

---

## Monitoring & Debugging

- **Run metadata**
  - Inspect `system/backfill-runs/runs/{BACKFILL_ID}` in Firestore:
    - Check `status`, `cursorIndex`, `processedCount`, `lastSymbolProcessed`.
- **History**
  - Use the `history` array to see:
    - When the run was kicked off.
    - How many times it was restarted.
    - When the last successful session ended.
- **Logs**
  - Script logs include:
    - `backfillId`.
    - `from`, `to`.
    - `intervals`.
    - `symbolsScope`.
    - `totalSymbols`.
    - Progress markers like `[12/100] SYMBOL NVDA`.

---

## Failure Handling

- If a symbol fails, the script logs the error and continues.
- If the script crashes or is killed:
  - Re-run with the same `BACKFILL_ID` and window.
  - It will resume from the next unprocessed symbol.
- If you need to **change** the window or symbol universe:
  - Use a **new** `BACKFILL_ID` to avoid conflicting metadata.
