# Expiration Dropdown Enhancement: Coverage Days & Day of Week

**Status:** Proposed
**Owner:** Savant API
**Last updated:** 2026-07-24

---

## 1. Problem

The Storage File Viewer's expiration dropdown displays a flat list of ISO dates (`2024-12-04`, `2024-12-06`, `2025-01-17`, `2026-01-16`, ...). There is no visual distinction between a 0DTE expiration, a weekly, a monthly, or a LEAPS expiration. Users must mentally compute the contract duration from the date alone, which is impractical when scanning hundreds of expirations.

## 2. Goal

Enhance the expiration dropdown to show:

```
2024-12-04 (Wed) · 1d        ← 0DTE
2024-12-06 (Fri) · 5d        ← weekly
2024-12-20 (Fri) · 21d       ← monthly
2025-01-17 (Fri) · 49d       ← monthly
2026-01-16 (Fri) · 728d      ← LEAPS
```

Two pieces of information are added per expiration:
- **Day of week** — derived purely on the frontend from the ISO date.
- **Coverage days** — the number of calendar days from the first observed trading date to the expiration date, inclusive.

## 3. Key Insight

All contracts sharing an expiration date have the same expiration. The "contract length" for an expiration group is:

```
coverageDays = expirationDate - firstObservedDate + 1
```

Where `firstObservedDate` is the **earliest date** any contract in that expiration started trading in the time-series data. This is one value per expiration, not per contract.

## 4. Current State

### What already exists

- The time-series builder already writes `firstObserved` and `lastObserved` as GCS custom metadata on every JSONL file (`time-series-builder.service.ts:284-285`).
- The nightly corpus scheduler runs at 7 PM Pacific weekdays and triggers the time-series builder via HTTP.
- `upsertContract()` is called after each file write to update the Firestore index.

### What's missing

- `upsertContract()` does not propagate `firstObservedDate` to the Firestore `ExpirationIndexDoc`. It only writes `contractIds`, `strikes`, `types`, and `expirations`.
- The `ExpirationIndexDoc` interface has no `firstObservedDate` field.
- The frontend store and dropdown template do not render coverage days or day of week.

## 5. Implementation Plan

### Step 1: Extend `ExpirationIndexDoc`

**File:** `functions/src/v2/historical-options-corpus/services/options-index.writer.ts`

Add `firstObservedDate?: string` to the `ExpirationIndexDoc` interface.

### Step 2: Update `upsertContract`

**File:** `functions/src/v2/historical-options-corpus/services/options-index.writer.ts`

The builder's `writeMerged` method already computes `sorted[0]?.d` (firstObserved) and `sorted[sorted.length - 1]?.d` (lastObserved). Pass these to `upsertContract` as new parameters.

Inside `upsertContract`, when writing to the expiration doc:
- If `firstObservedDate` is not yet set on the doc, set it to the provided value.
- If it is already set, keep the earlier of the two values (minimum).

This ensures the expiration doc always reflects the earliest observed date across all its contracts.

### Step 3: Update `writeMerged` call site

**File:** `functions/src/v2/historical-options-corpus/services/time-series-builder.service.ts`

Pass `firstObserved` and `lastObserved` to the updated `upsertContract` call at line 294.

### Step 4: Backfill existing index

**File:** `functions/scripts/ops/rebuild-options-index.ts` (enhanced)

For each expiration doc:
1. Read GCS metadata (not file contents) for each contract in the expiration.
2. Extract `firstObserved` from the custom metadata.
3. Take the minimum across all contracts in that expiration.
4. Write `firstObservedDate` back to the expiration doc.

GCS `getMetadata()` is a single API call per file — no content download needed.

### Step 5: Frontend store

**File:** `src/app/feat/storage-file-viewer/store/storage-viewer.store.ts`

Add `firstObservedDate` to the `ExpirationIndexDoc` type and store it in the index state alongside `allExpirations`.

### Step 6: Frontend dropdown

**File:** `src/app/feat/storage-file-viewer/comps/storage-viewer/storage-viewer.component.html`
**File:** `src/app/feat/storage-file-viewer/comps/storage-viewer/storage-viewer.component.ts`

Format each dropdown option as:

```
{date} ({dayOfWeek}) · {coverageDays}d
```

- `dayOfWeek`: `new Intl.DateTimeFormat('en-US', { weekday: 'short' }).format(new Date(date))`
- `coverageDays`: `Math.round((new Date(expiration) - new Date(firstObservedDate)) / 86400000) + 1`
- If `firstObservedDate` is missing (not yet backfilled), show just `{date} ({dayOfWeek})` without the duration.

## 6. Scale & Cost

### Backfill

- ~370K contracts, but only need `getMetadata()` per file (not content read).
- Group by expiration, take minimum `firstObserved` across contracts.
- ~370K metadata calls at 50 concurrency = ~5-10 minutes for QQQ.
- GCS metadata GET: $0.004 per 10,000 = ~$0.15.

### Firestore doc size

An expiration with 500+ contracts only adds one string field (`firstObservedDate`). Well under the 1MB Firestore doc limit.

### Ongoing freshness

Every nightly build run automatically updates `firstObservedDate` via the enhanced `upsertContract`. New contracts get their first date set on first build. Existing contracts keep their earliest date.

## 7. What We Skip for Now

- Per-contract coverage in the left panel — all contracts in an expiration share the same coverage days, so it would be redundant.
- `upsertContract` real-time `lastObservedDate` updates — follow-up task.
- Corpus bucket coverage — corpus is date-based, not contract-based.
- Active contract indicator (`+` suffix) — could be added later if needed.
