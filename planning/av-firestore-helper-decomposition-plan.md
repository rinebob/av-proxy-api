# `av-firestore-helper.ts` Decomposition Plan

> **Status: PLANNED**
>
> **Dr. Reed's Assessment:** This file is a classic "God Object" anti-pattern — a single 2,059-line module accumulating every Firestore write concern for the Alpha Vantage pipeline. It violates the **Single Responsibility Principle** at the module level, creates high cognitive load for reviewers, and makes future feature additions risky (every change touches a file with global blast radius). The decomposition below is not optional polish — it is a structural prerequisite for maintainability at scale.

---

## 🛑 Architectural Risk

**Immediate Risk:** A single file owning standard saves, time-series bulk writes, single-bar upserts, intraday snapshots, metadata bumps, and shared math utilities means every new pipeline feature adds coupling risk to every existing feature. A regression in `computeChCpForBarsAscending` (a pure math utility) is buried 2,000 lines away from where it is consumed. TypeScript cannot enforce module-boundary contracts within a single file.

**Challenging Questions:**
1. When the W/M intraday snapshot logic needed a shared `_upsertWmIntradaySnapshotCore` helper, where did it have to live? In the same 2,000-line file — there was nowhere else to put it cleanly. How does this scale as we add options chain or earnings intraday snapshots?
2. The `_internalSaveAvTimeSeriesData` and `_internalUpsertDailyBar` private helpers are large enough to be files in their own right. Why are they private functions inside a public module instead of internal modules with explicit import contracts?
3. If a consumer imports `upsertAvDailyIntradaySnapshot`, they transitively pull in the entire file — standard saves, split math, metadata bumps, everything. How does this affect cold-start memory for Cloud Functions that only use one concern?

---

## Function Inventory & Proposed Module Assignment

| Function | Lines (approx) | Proposed Module |
|---|---|---|
| `formatPtDateTime` (private) | 30 | `av-firestore-utils.ts` |
| `saveAvData` | 46–133 | `av-standard-data.writer.ts` |
| `_internalSaveAvTimeSeriesData` (private) | 137–455 | `av-time-series.writer.ts` |
| `saveAvTimeSeriesData` | 457–478 | `av-time-series.writer.ts` |
| `initializeTimeSeriesIfMissing` | 479–560 | `av-time-series.writer.ts` |
| `_internalUpsertDailyBar` (private) | 564–813 | `av-daily-bar.writer.ts` |
| `upsertAvDailyBar` | 815–839 | `av-daily-bar.writer.ts` |
| `upsertAvWeeklyBar` | 840–922 | `av-weekly-bar.writer.ts` |
| `upsertAvMonthlyBar` | 926–1013 | `av-monthly-bar.writer.ts` |
| `mergeWeeklyCompactWindowIntoShards` | 1014–1272 | `av-weekly-bar.writer.ts` |
| `mergeMonthlyCompactWindowIntoAllDocs` | 1276–1482 | `av-monthly-bar.writer.ts` |
| `upsertAvDailyIntradaySnapshot` | 1486–1568 | `av-intraday-snapshot.writer.ts` |
| `barDateStr` (private) | 1573–1576 | `av-firestore-utils.ts` |
| `_upsertWmIntradaySnapshotCore` (private) | 1598–1685 | `av-intraday-snapshot.writer.ts` |
| `upsertAvWeeklyIntradaySnapshot` | 1690–1724 | `av-intraday-snapshot.writer.ts` |
| `upsertAvMonthlyIntradaySnapshot` | 1728–1765 | `av-intraday-snapshot.writer.ts` |
| `bumpTimeSeriesTopLevelMetadata` | 1769–1914 | `av-metadata.writer.ts` |
| `getPreviousAdjustedClose` | 1918–1958 | `av-daily-bar.writer.ts` |
| `computeDowFromDateString` (private) | 1963–1975 | `av-firestore-utils.ts` |
| `todayEtDate` (private) | 1979–1986 | `av-firestore-utils.ts` |
| `formatEtDateTime` (private) | 1991–2001 | `av-firestore-utils.ts` |
| `round2` (private) | 2006 | `av-firestore-utils.ts` |
| `computeChCpForBarsAscending` | 2015–2037 | `av-firestore-utils.ts` |
| `computeChCpForTargetIndex` | 2042–2059 | `av-firestore-utils.ts` |

---

## Proposed Directory Structure

```
functions/src/v2/alpha-vantage/firestore/
  av-firestore-utils.ts            ← pure helpers: formatPtDateTime, barDateStr,
  │                                   computeDowFromDateString, todayEtDate,
  │                                   formatEtDateTime, round2,
  │                                   computeChCpForBarsAscending,
  │                                   computeChCpForTargetIndex
  │
  av-standard-data.writer.ts       ← saveAvData
  │
  av-time-series.writer.ts         ← _internalSaveAvTimeSeriesData (private),
  │                                   saveAvTimeSeriesData,
  │                                   initializeTimeSeriesIfMissing
  │
  av-daily-bar.writer.ts           ← _internalUpsertDailyBar (private),
  │                                   upsertAvDailyBar,
  │                                   getPreviousAdjustedClose
  │
  av-weekly-bar.writer.ts          ← upsertAvWeeklyBar,
  │                                   mergeWeeklyCompactWindowIntoShards
  │
  av-monthly-bar.writer.ts         ← upsertAvMonthlyBar,
  │                                   mergeMonthlyCompactWindowIntoAllDocs
  │
  av-intraday-snapshot.writer.ts   ← barDateStr (private),
  │                                   _upsertWmIntradaySnapshotCore (private),
  │                                   upsertAvDailyIntradaySnapshot,
  │                                   upsertAvWeeklyIntradaySnapshot,
  │                                   upsertAvMonthlyIntradaySnapshot
  │
  av-metadata.writer.ts            ← bumpTimeSeriesTopLevelMetadata
  │
  index.ts                         ← re-exports all public functions so existing
                                      importers need zero changes
```

> **Dr. Reed's Note on the barrel `index.ts`:** The barrel export is a pragmatic migration bridge — it preserves every existing import path (`from '../firestore/av-firestore-helper'`) without a sweeping rename across the codebase. Once all consumers are updated to import from the specific writer modules, the barrel can be removed. Do **not** skip the barrel and do a big-bang rename in a single PR — that is how regressions are introduced.

---

## Dependency Rules

Modules may only import in this direction — no circular dependencies:

```
av-firestore-utils.ts
  ↑ (imported by all writers)

av-metadata.writer.ts
  ↑ (imported by time-series, daily, weekly, monthly writers)

av-daily-bar.writer.ts
av-weekly-bar.writer.ts
av-monthly-bar.writer.ts
  ↑ (imported by av-time-series.writer.ts for initializeTimeSeriesIfMissing)

av-intraday-snapshot.writer.ts
  (imports av-daily-bar, av-weekly-bar, av-monthly-bar for docRef resolution helpers)

av-standard-data.writer.ts
  (standalone — no dependency on other writers)
```

---

## Migration Strategy

### Phase 1 — Extract utils (zero risk)

Extract `av-firestore-utils.ts` first. These are pure functions with no Firestore I/O and no imports from within the `firestore/` directory. No functional change; pure move. Easiest to verify with TypeScript compiler alone.

**Files changed:** `av-firestore-utils.ts` (new), `av-firestore-helper.ts` (remove extracted functions, add import from utils).

### Phase 2 — Extract metadata writer

Extract `bumpTimeSeriesTopLevelMetadata` into `av-metadata.writer.ts`. It is consumed by the weekly and monthly writers, so it must be extracted before them.

**Files changed:** `av-metadata.writer.ts` (new), `av-firestore-helper.ts` (import from metadata writer).

### Phase 3 — Extract intraday snapshot writer

Extract `av-intraday-snapshot.writer.ts`. Self-contained concern; imports only utils, `db`, and path helpers. The recently refactored `_upsertWmIntradaySnapshotCore` makes this a clean cut.

**Files changed:** `av-intraday-snapshot.writer.ts` (new), `av-firestore-helper.ts` (import from intraday writer).

### Phase 4 — Extract daily bar writer

Extract `_internalUpsertDailyBar`, `upsertAvDailyBar`, and `getPreviousAdjustedClose` into `av-daily-bar.writer.ts`. `_internalUpsertDailyBar` is the largest private helper (~250 lines); verify its call sites are all within the same new file.

**Files changed:** `av-daily-bar.writer.ts` (new), `av-firestore-helper.ts` (import from daily writer).

### Phase 5 — Extract weekly and monthly bar writers

Extract `upsertAvWeeklyBar` + `mergeWeeklyCompactWindowIntoShards` → `av-weekly-bar.writer.ts`.
Extract `upsertAvMonthlyBar` + `mergeMonthlyCompactWindowIntoAllDocs` → `av-monthly-bar.writer.ts`.
Both import from `av-metadata.writer.ts` and `av-firestore-utils.ts`.

**Files changed:** two new writer files, `av-firestore-helper.ts` updated.

### Phase 6 — Extract time-series and standard writers

Extract the remaining `saveAvData` → `av-standard-data.writer.ts` and the `_internalSaveAvTimeSeriesData` / `saveAvTimeSeriesData` / `initializeTimeSeriesIfMissing` group → `av-time-series.writer.ts`.

**Files changed:** two new writer files, `av-firestore-helper.ts` now nearly empty.

### Phase 7 — Convert `av-firestore-helper.ts` to barrel index

At this point `av-firestore-helper.ts` should contain only re-exports. Rename it to `index.ts` (or keep it as a barrel under the original name). No consumer import paths change.

**Files changed:** `av-firestore-helper.ts` → pure re-export barrel (or `index.ts`).

---

## Verification Per Phase

After each phase run:

```bash
npx tsc --noEmit -p functions/tsconfig.json
```

No new type errors = phase complete. Deploy only after all phases pass.

---

## 🧑‍🏫 Mentorship Principle

**Single Responsibility Principle at the module level.** A TypeScript file is a module boundary. When a module owns more than one reason to change — standard saves change when AV's API format changes; intraday snapshot logic changes when new bar types are added; metadata bump changes when Firestore schema evolves — it has multiple axes of change and violates SRP. Each writer file should have exactly one reason to change: its own write concern. The utils file changes only when shared math or formatting logic changes. This is what makes the codebase navigable for the next developer — or for you six months from now.
