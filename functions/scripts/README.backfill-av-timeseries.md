# AV Time-Series Backfill Utility

This document describes the whole-collection backfill utility for Alpha Vantage (AV) time-series data. The script ensures each symbol in Firestore follows the latest structure and data shape, creates any missing series, and upgrades existing bars.

- Script path: `functions/scripts/backfill-timeseries-chcp.ts`
- Scope: AV time-series only (daily, weekly, monthly)
- Sources: `symbol-data/` collection only (does NOT consult `tracked-symbols/`)

## What the script does

- __Ensure presence of series__
  - For every symbol in `symbol-data/`, ensure existence of:
    - `time-series/av-daily-adjusted`
    - `time-series/av-weekly-adjusted`
    - `time-series/av-monthly-adjusted`
  - Uses `initializeTimeSeriesIfMissing()` to fetch from AV and write with the latest handlers.
  - Fetches FULL history; in the emulator, daily is trimmed to ~1 year at write time.

- __Upgrade bar shape__
  - Upgrades stored bars to the latest compact schema:
    - `t` epoch ms
    - `d` human-readable date `YYYY-MM-DD` (UTC)
    - `o, h, l, c` prices
    - `v?` optional volume
    - `ch, cp` change and percent change vs prior close (first bar: `0, 0`), 2-decimal rounding
  - Daily/Weekly: upgrades each `years/{YYYY}` doc.
  - Monthly: upgrades the single `all/data` doc.

- __Repair metadata (optional)__
  - With `--repair-metadata`, recomputes and stores:
    - `metadata.availableYears`
    - `metadata.histStartTs`
    - `metadata.histEndTs`

## Data model expectations

- __Top-level time-series doc__ (metadata and pointers only):
  - Path: `symbol-data/{SYMBOL}/time-series/{docId}` where `{docId}` is like `av-daily-adjusted`.

- __Daily/Weekly sharded years__
  - Years collection: `.../years/{YYYY}` (document with `bars: CompactBar[]`)

- __Monthly single doc__
  - Path: `.../all/data` (document with `bars: CompactBar[]`)

- __CompactBar (normalized) fields__
  - `t, d, o, h, l, c, v?, ch, cp`

## Emulator vs Production

- __Production__
  - Initializer fetches `outputsize: FULL` for all intervals.
  - Full dataset is persisted.

- __Emulator__
  - Initializer fetches FULL, but `saveAvTimeSeriesData()` trims DAILY to ~1 year before writing (to keep emulator fast/small).
  - WEEKLY/MONTHLY are not trimmed.

## Usage

Run from the `functions/` directory. Ensure shared artifacts are built and copied first.

```powershell
# From repo root
npm run build:shared
npm --prefix functions run copy-shared

# Then from functions/
cd functions
```

### Dry-run (no writes)

```powershell
npx ts-node -r tsconfig-paths/register -r module-alias/register scripts/backfill-timeseries-chcp.ts --dry-run
```

### Daily only, all symbols

```powershell
npx ts-node -r tsconfig-paths/register -r module-alias/register scripts/backfill-timeseries-chcp.ts --interval daily
```

### Single symbol

```powershell
npx ts-node -r tsconfig-paths/register -r module-alias/register scripts/backfill-timeseries-chcp.ts --symbol AAPL --dry-run
```

### Repair metadata

```powershell
npx ts-node -r tsconfig-paths/register -r module-alias/register scripts/backfill-timeseries-chcp.ts --repair-metadata
```

### Combine filters

```powershell
# Daily only + metadata repair + dry-run
npx ts-node -r tsconfig-paths/register -r module-alias/register scripts/backfill-timeseries-chcp.ts --interval daily --repair-metadata --dry-run
```

## Flags

- `--dry-run`
  - Preview updates; no writes to Firestore.
- `--symbol <TICKER>`
  - Process a single symbol (default is all symbols in `symbol-data/`).
- `--interval <daily|weekly|monthly>`
  - Restrict to one interval (default is all three).
- `--repair-metadata`
  - Recompute and write `availableYears`, `histStartTs`, and `histEndTs`.

## Troubleshooting

- __Cannot find module '@shared/...':__
  - Ensure shared has been built and copied:
    - `npm run build:shared`
    - `npm --prefix functions run copy-shared`
  - Always run with `-r tsconfig-paths/register -r module-alias/register`.

- __Monthly doc path error (`.../all` has odd segments):__
  - Fixed by writing monthly bars to `.../all/data` (even segments). Ensure you pulled latest changes.

- __Handlers missing for weekly/monthly:__
  - `initializeTimeSeriesIfMissing()` now dynamically imports weekly/monthly handlers (no `.js` extension) and supports `outputsize: FULL`.

## Implementation notes

- Upgrades compute `ch/cp` per interval using prior close, rounding to 2 decimals; first bar uses `0,0`.
- Upgrades inject `d` based on `t` (or raw date field during initialization) in UTC.
- The script reads symbols from `symbol-data` only, by design.

## Safety

- Always start with `--dry-run` in both emulator and prod.
- Consider `--interval` scoping when testing changes to reduce runtime and risk.

## Future extensions

- Extend beyond AV time-series (e.g., fundamentals, quotes).
- Trim weekly/monthly in emulator if needed (currently not trimmed).
- Add an npm alias in `functions/package.json` for easier invocation.
