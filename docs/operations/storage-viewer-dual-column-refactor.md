# Storage Viewer Dual-Column Refactor — Implementation Plan

**Date:** 2026-07-26
**Status:** Implemented
**Parent Doc:** [Storage File Viewer Design](./storage-file-viewer-design.md)

---

## Overview

The initial storage viewer was a single monolithic component with a bucket toggle that switched between corpus and time-series modes. After real-world usage, the need to cross-reference corpus and time-series data simultaneously became clear. This refactor replaces the toggle with a dual-column layout where both viewers are always visible. Additionally, an in-content search feature is introduced to navigate large files efficiently.

---

## Target Layout

```
┌──────────────────────────────────────────────────────────────────┐
│  Storage File Viewer                                             │
│  [Find: ___________]  Corpus [▲ 3/12 ▼]   TS [▲ 5/8 ▼]         │
├────────────────────────────┬─────────────────────────────────────┤
│  CORPUS (left column)      │  TIME SERIES (right column)         │
│  ┌──────────────────────┐  │  ┌───────────────────────────────┐  │
│  │ Symbol  DateFilter   │  │  │ Symbol Exp Strike P/C         │  │
│  │ [List]               │  │  │ ContractID [Go] [List]        │  │
│  └──────────────────────┘  │  └───────────────────────────────┘  │
│  ┌──────────┬───────────┐  │  ┌──────────┬──────────────────┐   │
│  │          │           │  │  │ Contract │                  │   │
│  │  File    │  Content  │  │  │  list    │                  │   │
│  │  List    │  Viewer   │  │  │          │  Content         │   │
│  │          │           │  │  ├──────────┤  Viewer          │   │
│  │  date    │  JSON     │  │  │ Metadata │  JSONL           │   │
│  │  size    │           │  │  │  strip   │                  │   │
│  │  updated │           │  │  │          │                  │   │
│  │          │           │  │  │          │                  │   │
│  └──────────┴───────────┘  │  └──────────┴──────────────────┘   │
└────────────────────────────┴─────────────────────────────────────┘
```

### Layout Rules

- **Find bar** across the top — single search input with two navigation groups (corpus + time-series). Each group shows `current/total` with up/down arrows for scrolling to occurrences in the respective content viewer.
- **Two columns** side by side, each with its own symbol input and independent state:
  - **Corpus column (left):** form (symbol + date filter + List) at top, then file list and content viewer side by side below.
  - **Time-series column (right):** form (symbol + expiration + strike + P/C + contract ID + Go + List) at top, then contract list and metadata strip (left) beside content viewer (right). Contract list is above the metadata strip.
- **File lists** — scrollable, show matching files (contract IDs or dates) with metadata columns.
- **Content viewers** — raw file content from GCS, full height with vertical scrollbar. Opens on click, no dialog/modal.
- **Responsive:** columns stack vertically below 80rem breakpoint.

---

## In-Content Search

A shared find bar at the top of the page allows searching within both content viewers simultaneously.

### Controls

- Single text input for the search term (case-insensitive, line-by-line matching).
- Two navigation groups, one per column:
  - `Corpus [▲ current/total ▼]` — controls corpus content viewer scroll.
  - `TS [▲ current/total ▼]` — controls time-series content viewer scroll.
- Up/down arrows cycle through occurrences with wraparound.
- Navigation buttons are disabled when total matches is 0.

### Behavior

- As the user types, both content viewers are searched simultaneously.
- Each occurrence is tracked as `{ lineIndex, charOffset, length }`.
- When the user clicks up/down, the corresponding content viewer's `<pre>` element scrolls to bring the matching line into view.
- No text highlighting in v1 — scroll-to-match only. Highlighting can be added in a follow-up.
- When content changes (new file selected), occurrences are recomputed and the index resets to 0.

### Architecture

A `ContentSearchService` (Angular service with signals) owns the search state. The parent layout component hosts the find bar UI. Each sub-component registers its content via an effect and watches the current index signal to scroll its `<pre>` element.

---

## Component Structure

```
src/app/feat/storage-file-viewer/
  comps/
    storage-viewer/              ← thin layout wrapper + find bar
      storage-viewer.component.ts
      storage-viewer.component.html
      storage-viewer.component.scss
    corpus-viewer/               ← corpus column (form + list + viewer)
      corpus-viewer.component.ts
      corpus-viewer.component.html
      corpus-viewer.component.scss
    time-series-viewer/          ← time-series column (form + list + metadata + viewer)
      time-series-viewer.component.ts
      time-series-viewer.component.html
      time-series-viewer.component.scss
  common/
    storage-viewer-api.ts        ← existing API service (unchanged)
    viewer-utils.ts              ← shared pure functions (formatBytes, formatContent, formatStrike)
    content-search.service.ts    ← shared in-content search service (signals)
  store/
    corpus-viewer.store.ts       ← NgRx Signal Store (corpus-only state)
    time-series-viewer.store.ts  ← NgRx Signal Store (time-series-only state)
  index.ts
```

---

## State Management

Two independent NgRx Signal Stores, each with its own symbol and state. Both follow the existing `AdminDashboardStore` pattern.

### CorpusViewerStore

```typescript
interface CorpusViewerState {
  symbol: string;
  dates: string[];
  corpusFiles: CorpusFileEntry[];
  readResult: ReadResult | null;
  loadingList: boolean;
  loadingRead: boolean;
  error: string | null;
}
```

### TimeSeriesViewerStore

```typescript
interface TimeSeriesViewerState {
  symbol: string;
  expiration: string | null;
  strike: number | null;
  optionType: 'C' | 'P' | null;
  contracts: ContractResult[];
  readResult: ReadResult | null;
  loadingList: boolean;
  loadingRead: boolean;
  loadingIndex: boolean;
  error: string | null;
  // Firestore index state
  allExpirations: string[];
  allStrikes: number[];
  expirationToStrikes: Record<string, number[]>;
  strikeToExpirations: Record<number, string[]>;
  filteredExpirations: string[];
  filteredStrikes: number[];
}
```

### ContentSearchService (shared, not a store)

```typescript
interface Occurrence {
  lineIndex: number;
  charOffset: number;
  length: number;
}
// Signals: searchTerm, corpusOccurrences, corpusCurrentIndex,
//          tsOccurrences, tsCurrentIndex
// Computed: corpusCurrent, corpusTotal, tsCurrent, tsTotal
// Methods: setSearchTerm(), registerContent(), next(), prev()
```

---

## Implementation Steps

### Step 1: Split the Store

Create two independent stores from the existing `StorageViewerStore`:

- **`CorpusViewerStore`** — corpus-only state. No Firestore index, no bucket field. Methods: `setSymbol`, `clearRead`, `clearError`, `list`, `read`.
- **`TimeSeriesViewerStore`** — time-series-only state. All index state and cross-filtering logic. Methods: `setSymbol`, `setExpiration`, `setStrike`, `setOptionType`, `clearRead`, `clearError`, `loadIndex`, `list`, `read`.

Both reuse the existing `StorageViewerApiService` unchanged. The old `StorageViewerStore` is deleted.

- [ ] Create `store/corpus-viewer.store.ts`
- [ ] Create `store/time-series-viewer.store.ts`
- [ ] Delete `store/storage-viewer.store.ts`
- [ ] Update `store/index.ts` barrel if present

### Step 2: Extract Shared Utils

Create `common/viewer-utils.ts` with pure functions extracted from the current component:

- `formatBytes(n: number): string`
- `formatContent(content: string): string` — JSONL pretty-printer
- `STRIKE_FORMATTER` + `formatStrike(strike: number): string`

- [ ] Create `common/viewer-utils.ts`
- [ ] Update `common/index.ts` barrel

### Step 3: Create Content Search Service

Create `common/content-search.service.ts`:

- **State (signals):** `searchTerm`, `corpusOccurrences`, `corpusCurrentIndex`, `tsOccurrences`, `tsCurrentIndex`
- **Methods:** `setSearchTerm(term)`, `registerContent(bucket, content)`, `next(bucket)`, `prev(bucket)`
- **Computed outputs:** `corpusCurrent`, `corpusTotal`, `tsCurrent`, `tsTotal`
- **Occurrence type:** `{ lineIndex, charOffset, length }`
- Sub-components watch the current index signal for their bucket and scroll their `<pre>` element accordingly

- [ ] Create `common/content-search.service.ts`
- [ ] Update `common/index.ts` barrel

### Step 4: Create CorpusViewerComponent

`comps/corpus-viewer/` (`.ts`, `.html`, `.scss`)

- **Form (top):** symbol input + date filter input + List button
- **Below form, side by side:**
  - **Left:** file list (date, size, updated) — scrollable
  - **Right:** content viewer (`<pre>` with `#contentPre` template ref) — scrollable
- Injects `CorpusViewerStore` + `ContentSearchService`
- On content change (effect): calls `contentSearch.registerContent('corpus', content)`
- Watches `contentSearch.corpusCurrentIndex` — when it changes, scrolls `contentPre` to the matching line
- Owns: `selectedItemId` signal, `dateFilterCtrl`, `dateFilterInput`, `filteredCorpusFiles`, `filteredDates` computeds

- [ ] Create `comps/corpus-viewer/corpus-viewer.component.ts`
- [ ] Create `comps/corpus-viewer/corpus-viewer.component.html`
- [ ] Create `comps/corpus-viewer/corpus-viewer.component.scss`

### Step 5: Create TimeSeriesViewerComponent

`comps/time-series-viewer/` (`.ts`, `.html`, `.scss`)

- **Form (top):** symbol input + expiration select + strike autocomplete + P/C select + List button + contract ID direct entry + Go button
- **Below form, side by side:**
  - **Left:** contract list (top) + metadata strip (below) — scrollable
  - **Right:** content viewer (`<pre>` with `#contentPre` template ref) — scrollable
- Injects `TimeSeriesViewerStore` + `ContentSearchService`
- On content change: calls `contentSearch.registerContent('ts', content)`
- Watches `contentSearch.tsCurrentIndex` — scrolls `contentPre` to matching line
- Owns: `selectedItemId` signal, `symbolCtrl`, `strikeCtrl`, `contractIdCtrl`, `filteredStrikes` computed, metadata helpers, `contractLength`, `firstTradingDate`

- [ ] Create `comps/time-series-viewer/time-series-viewer.component.ts`
- [ ] Create `comps/time-series-viewer/time-series-viewer.component.html`
- [ ] Create `comps/time-series-viewer/time-series-viewer.component.scss`

### Step 6: Refactor Parent Layout Component

Convert `StorageViewerComponent` into a thin layout wrapper + find bar host:

- **Template:**
  - Header (title + subtitle)
  - **Find bar:** text input bound to `contentSearch.searchTerm`, plus two navigation groups:
    - `Corpus [▲ {{ corpusCurrent }}/{{ corpusTotal }} ▼]` — calls `contentSearch.prev('corpus')` / `contentSearch.next('corpus')`
    - `TS [▲ {{ tsCurrent }}/{{ tsTotal }} ▼]` — calls `contentSearch.prev('ts')` / `contentSearch.next('ts')`
  - Two-column flex: `<app-corpus-viewer />` | `<app-time-series-viewer />`
- **SCSS:** find bar as a thin row; two columns `flex: 1 1 50%`
- Removes all form controls, store injection, and handler methods from the current component

- [ ] Rewrite `comps/storage-viewer/storage-viewer.component.ts`
- [ ] Rewrite `comps/storage-viewer/storage-viewer.component.html`
- [ ] Rewrite `comps/storage-viewer/storage-viewer.component.scss`

### Step 7: Update Barrel Exports

- [ ] Update `comps/index.ts` to export `CorpusViewerComponent`, `TimeSeriesViewerComponent`
- [ ] Verify `index.ts` at feature root re-exports correctly

### Step 8: SCSS Layout

- **Parent:** find bar (auto height) + two columns (`flex: 1 1 50%`)
- **Each sub-component:** form (auto height) + row (flex: 1) with list (~40%) and content viewer (~60%) side by side
- **TS left sub-panel:** contract list (flex: 1) + metadata strip (auto/fixed height)
- **Dark mode** in each sub-component's SCSS
- **Responsive:** stack columns below 80rem

- [ ] Verify SCSS compiles and layout works in browser

### Step 9: Verify

- [ ] `ng build` passes with no errors
- [ ] Both columns render independently with their own symbol
- [ ] Corpus list + viewer work (list dates, click to view content)
- [ ] Time-series list + viewer work (filter by exp/strike/type, click to view content)
- [ ] Contract ID direct entry works in time-series column
- [ ] Find bar searches both viewers simultaneously
- [ ] Up/down arrows scroll to occurrences with wraparound
- [ ] Count display shows `current/total` correctly
- [ ] Navigation buttons disabled when no matches
- [ ] Responsive: columns stack below 80rem
- [ ] Dark mode renders correctly

---

## Files to Delete

- `src/app/feat/storage-file-viewer/store/storage-viewer.store.ts` — replaced by `corpus-viewer.store.ts` and `time-series-viewer.store.ts`

## Files Unchanged

- `src/app/feat/storage-file-viewer/common/storage-viewer-api.ts` — API service works for both buckets already
- Backend Cloud Function — no changes needed, the API contract is unchanged

---

## Find Bar — Scroll Mechanism

When the user clicks up/down, the `ContentSearchService` updates the current index. The corresponding sub-component watches that index via an `effect()`:

1. Get the occurrence at the current index: `{ lineIndex, charOffset, length }`
2. Calculate scroll position: `lineIndex * lineHeight` (where `lineHeight` is derived from the `<pre>` computed style or a constant matching the CSS `line-height`)
3. Set `contentPre.scrollTop` to bring the matching line to the top of the content panel

Content registration: each sub-component uses an `effect()` that watches its `readResult().content` signal. When content changes (new file selected), it calls `contentSearch.registerContent()` with the new content, which recomputes occurrences for that bucket and resets the index to 0.
