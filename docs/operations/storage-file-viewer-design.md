> **⚠ Superseded:** The UI layout, component structure, and state management described in this document have been superseded by the [Storage Viewer Dual-Column Refactor](./storage-viewer-dual-column-refactor.md). This document is retained as the original design and implementation record. The backend, Firestore index, and Cloud Function sections remain current.

# Storage File Viewer & Contract Discovery — Design Document

**Date:** 2026-07-23  
**Status:** Approved (UI layout superseded — see [Dual-Column Refactor](./storage-viewer-dual-column-refactor.md))  
**Route:** `/storage-file-viewer`  
**Required Role:** `admin`

---

## Purpose

This design covers two co-equal access paths to the AV historical options GCS buckets, both backed by a shared Firestore index:

1. **Internal Storage File Viewer** — a personal admin tool for browsing and inspecting file contents in the two AV historical options GCS buckets
2. **Partner-Facing Contract Discovery** — an API endpoint that lets external consumers discover which option contracts exist in our storage and request their time series

Both paths solve the same fundamental problem: with 500k+ files per symbol in GCS and no native search capability, consumers (internal or external) need a way to discover what contracts exist before they can access them.

### Buckets

1. **Time-series bucket** (`OPTIONS_TIME_SERIES_BUCKET`) — per-contract JSONL files at `time-series/v1/{SYMBOL}/{CONTRACT_ID}.jsonl`
2. **Corpus bucket** (`OPTIONS_CORPUS_BUCKET`) — gzipped daily snapshots at `historical-options/v1/{SYMBOL}/{YYYY-MM-DD}.json.gz`

The Firebase/GCS console is impractical for this because there are 500k+ files per symbol with no search or filter capability.

---

## Architecture — Dual Access Paths

The Firestore index is the backbone of both access paths. It is built and maintained once; both consumers read from it.

```
                    ┌─────────────────────────┐
                    │   Firestore Index        │
                    │   options-file-index/    │
                    │   {SYMBOL}/              │
                    │     ts-expirations/      │
                    │     ts-strikes/          │
                    └────────┬────────────────┘
                             │
              ┌──────────────┴──────────────┐
              │                             │
              ▼                             ▼
  ┌───────────────────┐         ┌────────────────────┐
  │  Admin Cloud       │         │  Partner API        │
  │  Function          │         │  Endpoint           │
  │  (Firebase Auth,   │         │  (Service Account,  │
  │   admin role)      │         │   OIDC + Audience)  │
  │                    │         │                     │
  │  Actions:          │         │  Action:             │
  │  - list (TS+Corpus)│         │  - listContracts     │
  │  - read (TS+Corpus)│         │    (TS only)         │
  └────────┬──────────┘         └──────────┬─────────┘
           │                               │
           ▼                               ▼
  ┌───────────────────┐         ┌────────────────────┐
  │  Angular UI       │         │  External Client    │
  │  /storage-file-   │         │  Apps               │
  │  viewer           │         │  (discover → fetch) │
  └───────────────────┘         └────────────────────┘
```

### Internal Admin Cloud Function

- **Auth:** Firebase Auth, requires `admin` role
- **Capabilities:** `list` (time-series + corpus) and `read` (time-series + corpus)
- **Consumer:** Angular UI at `/storage-file-viewer`
- **GCS access:** Full — can download and decompress any file in either bucket

### Partner-Facing Contract Discovery Endpoint

- **Auth:** Service account OIDC + audience verification (same model as existing `partnerHistoricalOptionsContract`)
- **Capabilities:** `listContracts` (time-series only) — returns contract IDs and metadata, no raw file content
- **Consumer:** External client applications
- **GCS access:** None directly — clients use the existing `partnerHistoricalOptionsContract` endpoint to fetch time series content after discovering the contract ID
- **Flow:** Client calls `listContracts({ symbol, expiration?, strike?, type? })` → receives contract IDs → calls `partnerHistoricalOptionsContract({ contractId })` to get the time series

### Why Two Separate Functions

Same index, different security boundaries and response shapes:
- The internal function returns raw file contents and supports both buckets — it's a private admin tool
- The partner function returns only contract metadata — it's a public API with restricted capabilities
- Keeping them separate prevents any possibility of the partner endpoint accidentally exposing raw file content or corpus bucket access

---

## UI Layout

Three-pane layout, no modals:

```
┌─────────────────────────────────────────────────────────┐
│  [Bucket Toggle]  [Symbol]  [Expiration]  [Strike]  [P/C] │  ← search controls
├──────────────────┬──────────────────────────────────────┤
│                  │                                      │
│  File List       │  File Content Viewer                 │
│  (left panel)    │  (right panel)                       │
│                  │                                      │
│  - contractId1   │  raw text content                    │
│  - contractId2   │  full height                         │
│  - contractId3   │  vertical scrollbar                  │
│  ...             │                                      │
│                  │                                      │
└──────────────────┴──────────────────────────────────────┘
```

- **Search controls** across the top, in left-to-right order: bucket toggle, symbol, expiration, strike, P/C
- **Left panel** — list of matching files (contract IDs or filenames), updates live as filters change
- **Right panel** — raw file content from GCS, full height with vertical scrollbar. Opens on click, no dialog/modal

> **Note:** This layout has been superseded by a dual-column design. See [Storage Viewer Dual-Column Refactor](./storage-viewer-dual-column-refactor.md) for the updated layout.

---

## Bucket Toggle

Switch between two search modes:

- **Time Series** — search by symbol, expiration, strike, and type (C/P)
- **Corpus** — search by symbol and date prefix

Both modes share the same three-pane layout. The search controls adapt to the selected bucket.

---

## Time Series Search

### Controls (left to right)

1. **Symbol** — toggle (QQQ / TQQQ). Extensible to additional symbols later.
2. **Expiration** — filterable dropdown. User can type to narrow (e.g., `2026 06` shows June 2026 expirations). Populated from the Firestore index.
3. **Strike** — filterable dropdown. Populated from the Firestore index.
4. **P/C** — toggle (Call / Put / Both). Optional, defaults to Both.

### Search Behavior

- **Symbol is required** before any other control activates.
- **Left panel stays empty** with message "Select a strike or expiration to see results" until at least symbol + (strike OR expiration) is selected.
- **P/C alone with symbol** does not populate the left panel.
- Each additional filter narrows the left panel in real time. No "search" button.

### Two Search Paths

The user is not locked into a fixed order. They can proceed via either path:

**Path A: Symbol → Expiration → Strike**
1. Select symbol → expiration dropdown populates from `ts_expirations` collection
2. Select expiration → strike dropdown populates from the expiration doc, left panel shows all contracts for that expiration
3. Select strike → left panel narrows to contracts at that strike
4. Toggle P/C → left panel narrows further

**Path B: Symbol → Strike → Expiration**
1. Select symbol → strike dropdown populates from `ts_strikes` collection
2. Select strike → expiration dropdown populates from the strike doc, left panel shows all contracts at that strike
3. Select expiration → left panel narrows to contracts for that expiration
4. Toggle P/C → left panel narrows further

### Left Panel Content

Each entry shows:
- Contract ID (OCC ticker, e.g., `QQQ260619C00450000`)
- Metadata: expiration date, strike, type (C/P), contract length (if available)

### Right Panel Content

Raw JSONL text from the GCS file, displayed as-is. No pretty-printing in the initial implementation. Full height with vertical scrollbar.

---

## Corpus Search

### Controls

1. **Symbol** — same toggle (QQQ / TQQQ)
2. **Date** — text field. Supports prefix matching:
   - `2024` → all files for 2024
   - `2024-03` → all files for March 2024
   - `2024-03-15` → exact date (one file or zero)

### Search Behavior

- Symbol + date prefix required before listing.
- The Cloud Function lists GCS objects with the computed prefix and returns matching filenames.
- No Firestore index needed — the corpus path is deterministic: `historical-options/v1/{SYMBOL}/{YYYY-MM-DD}.json.gz`

### Left Panel Content

Each entry shows:
- Filename (e.g., `2024-03-15.json.gz`)
- Metadata: size, generation, last updated (from GCS object metadata)

### Right Panel Content

Decompressed JSON text from the gzipped file, displayed raw. Full height with vertical scrollbar.

---

## Firestore Index (Time Series Only)

### Purpose

With 500k+ files per symbol, GCS listing is too slow for interactive dropdown population. A Firestore index provides instant lookups by expiration or strike.

### Structure

```
options-file-index/{SYMBOL}                              ← metadata doc
  { symbol, lastUpdated, tsExpirationCount, totalContracts }

options-file-index/{SYMBOL}/ts-expirations/{DATE}        ← one doc per expiration date
  { date, strikes: number[], types: string[], contractIds: string[] }

options-file-index/{SYMBOL}/ts-strikes/{STRIKE}          ← one doc per strike price
  { strike, expirations: string[], types: string[], contractIds: string[] }
```

**Naming convention:** All Firestore collection names use dashes (e.g., `options-file-index`, `ts-expirations`), not underscores.

### Example Documents

**Metadata doc:** `options-file-index/QQQ`
```json
{
  "symbol": "QQQ",
  "lastUpdated": "2026-07-23T17:00:00Z",
  "tsExpirationCount": 1326,
  "totalContracts": 369810
}
```

**Expiration doc:** `options-file-index/QQQ/ts-expirations/2026-01-15`
```json
{
  "date": "2026-01-15",
  "strikes": [80, 85, 90, 95, 100, 105, ..., 450, 455],
  "types": ["C", "P"],
  "contractIds": ["QQQ260115C00080000", "QQQ260115P00080000", "QQQ260115C00085000", ...]
}
```

**Strike doc:** `options-file-index/QQQ/ts-strikes/450`
```json
{
  "strike": 450,
  "expirations": ["2024-01-19", "2024-02-16", ..., "2026-06-19"],
  "types": ["C", "P"],
  "contractIds": ["QQQ240119C00450000", "QQQ240119P00450000", "QQQ240216C00450000", ...]
}
```

### Maintenance

- **Write pipeline:** The time-series builder updates both index paths (`ts-expirations` and `ts-strikes`) in the same operation as the GCS file write. It knows the symbol, contract ID, expiration, strike, and type at write time.
- **Rebuild script:** A manual script in `functions/scripts/ops/` that lists all GCS files for a symbol, parses OCC tickers, and enqueues Cloud Tasks to write the index. Uses Cloud Tasks to avoid Firestore batch transaction size limits (370k contracts produce docs whose total payload exceeds the 500-operation batch limit). Run once after implementation, or whenever the index is suspected to be stale.
- **Reconciliation script (future work):** Diffs GCS file list against the Firestore index, reports missing entries, optionally auto-fixes.

### Cloud Tasks Rebuild Architecture

The rebuild script does not write to Firestore directly. Instead:

1. Script lists GCS files and parses contract IDs
2. `OptionsIndexWriter.prepareRebuildPayloads()` groups contracts into chunked task payloads (5 docs per task — each doc can contain hundreds of contract IDs, so payloads must stay under Cloud Tasks' ~100KB limit)
3. Script enqueues each payload to the `processOptionsIndexWriteTask` Cloud Tasks queue
4. Each task writes its docs individually via `set()` — no batch transaction size limit
5. Cloud Tasks handles retries automatically (5 attempts, 10s–300s backoff)

**Task payload phases:** `delete` → `expirations` → `strikes` → `metadata`

**Queue config:** 10 max concurrent dispatches, 5 dispatches/second, 512MiB memory, 120s timeout

**Task count:** ~534 tasks for QQQ (1,326 expirations ÷ 5 + 1,329 strikes ÷ 5 + delete + metadata)

**Why not direct batch writes:** QQQ has 370k contracts across 1,326 expirations and 1,329 strikes. Batching 400 expiration docs in one transaction exceeds Firestore's transaction size limit because each doc contains a large `contractIds` array. Individual `set()` calls per doc have no such limit.

**Why 5 docs per task (not 50):** Cloud Tasks has a ~100KB payload limit. With popular expiration dates containing thousands of contract IDs, a single expiration doc can be 20KB+. 50 docs per task exceeded the limit at task #31. Reducing to 5 docs per task keeps payloads safely under the limit.

### Source of Truth

GCS is the source of truth. The Firestore index is a derived cache. If the index is stale or missing, the actual GCS files are unaffected. A rebuild always restores correctness.

---

## Cloud Function

### Endpoint

Single HTTP Cloud Function with an `action` parameter that dispatches internally:

- `list` — returns filtered file list
- `read` — returns file content

If the function file grows beyond the 500-line limit, split into two separate functions with a shared wrapper.

### List Action

**Time series:**
- Input: `{ action: "list", bucket: "time-series", symbol, expiration?, strike?, type? }`
- Reads Firestore index doc(s) based on which filters are provided
- Returns: `{ contractIds: string[], metadata: [{ contractId, expiration, strike, type, contractLength? }] }`

**Corpus:**
- Input: `{ action: "list", bucket: "corpus", symbol, datePrefix }`
- Lists GCS objects with prefix `historical-options/v1/{SYMBOL}/{datePrefix}`
- Returns: `{ files: [{ name, size, generation, updated }] }`

### Read Action

**Time series:**
- Input: `{ action: "read", bucket: "time-series", symbol, contractId }`
- Downloads `time-series/v1/{SYMBOL}/{CONTRACT_ID}.jsonl` from GCS
- Returns: `{ content: string, metadata: { size, generation, updated } }`

**Corpus:**
- Input: `{ action: "read", bucket: "corpus", symbol, date }`
- Downloads `historical-options/v1/{SYMBOL}/{date}.json.gz` from GCS
- Decompresses gzip
- Returns: `{ content: string, metadata: { size, generation, updated } }`

---

## Angular Frontend

### Route

`/storage-file-viewer` — guarded by `authGuard`, requires `admin` role.

### Nav Item

New entry in `src/app/core/config/nav-menu-items.ts`:
```typescript
{
  displayName: 'File Viewer',
  iconName: 'folder_open',
  route: '/storage-file-viewer',
  exact: false,
  requiredRole: 'admin',
  tooltip: 'Browse GCS storage files'
}
```

### Component Structure

```
src/app/feat/storage-file-viewer/
  components/
    file-viewer-layout/          ← top-level three-pane layout
      file-viewer-layout.component.ts
      file-viewer-layout.component.html
      file-viewer-layout.component.scss
    search-controls/             ← bucket toggle + filter inputs
      search-controls.component.ts
      search-controls.component.html
      search-controls.component.scss
    file-list/                   ← left panel
      file-list.component.ts
      file-list.component.html
      file-list.component.scss
    file-content/                ← right panel
      file-content.component.ts
      file-content.component.html
      file-content.component.scss
  store/
    file-viewer.store.ts         ← NgRx Signal Store
```

> **Note:** This structure was implemented as a single `StorageViewerComponent`. The planned dual-column refactor will split this into `CorpusViewerComponent` and `TimeSeriesViewerComponent` — see [Dual-Column Refactor](./storage-viewer-dual-column-refactor.md).

### State Management

NgRx Signal Store following the existing `AdminDashboardStore` pattern:

```typescript
interface FileViewerState {
  bucket: 'time-series' | 'corpus';
  symbol: string;
  expiration: string | null;
  strike: number | null;
  type: 'C' | 'P' | 'both';
  // Dropdown options
  expirations: string[];
  strikes: number[];
  // Left panel
  fileList: FileEntry[];
  selectedFile: FileEntry | null;
  // Right panel
  fileContent: string | null;
  // Status
  loadingList: boolean;
  loadingContent: boolean;
  error: string | null;
}
```

> **Note:** This single-store design will be split into `CorpusViewerStore` and `TimeSeriesViewerStore` in the dual-column refactor — see [Dual-Column Refactor](./storage-viewer-dual-column-refactor.md).

### Service

A `StorageViewerService` in `src/app/core/services/` that wraps the Cloud Function calls, following the existing `FirestoreService` pattern.

---

## Implementation Plan

### Phase 1: Backend — Index + Admin Cloud Function

1. ✅ Export `parseContractIDMetadata` from `contract-metadata.utils.ts`
2. ✅ Create `OptionsIndexWriter` Firestore writer service (`options-index.writer.ts`)
3. ✅ Create `processOptionsIndexWriteTask` Cloud Task handler for async index writes
4. ✅ Create rebuild script in `functions/scripts/ops/rebuild-options-index.ts` (enqueues Cloud Tasks)
5. ✅ Wire `upsertContract` into time-series builder for incremental updates
6. ✅ Create admin Cloud Function `storageFileViewer` with `list` and `read` actions
7. ⬜ Deploy and run rebuild script for QQQ (370k files) and TQQQ
8. ⬜ Verify Firestore index docs in console

### Phase 2: Frontend — Angular Components (Initial Implementation)

1. ✅ Scaffold the component structure (implemented as single `StorageViewerComponent`)
2. ✅ Implement the NgRx Signal Store (`StorageViewerStore`)
3. ✅ Implement the `StorageViewerApiService`
4. ✅ Build the search controls (bucket toggle, symbol, expiration, strike, P/C)
5. ✅ Build the file list panel
6. ✅ Build the file content panel
7. ✅ Wire up the layout component
8. ✅ Add route and nav item

> **Note:** The initial frontend was implemented as a single monolithic component with a bucket toggle. A dual-column refactor is planned — see [Storage Viewer Dual-Column Refactor](./storage-viewer-dual-column-refactor.md) for the implementation plan.

### Phase 3: Partner-Facing Contract Discovery Endpoint

1. Create `listContracts` endpoint on the partner API (same auth model as `partnerHistoricalOptionsContract`)
2. Reads the same Firestore index — returns contract IDs and metadata for `{ symbol, expiration?, strike?, type? }`
3. Document the endpoint in `docs/partner/partner-discovery.md`
4. Test with service account auth

### Phase 4: Polish

1. Test end-to-end with real data (both internal and partner paths)
2. Add loading states and error handling
3. Style with light/dark theme support

---

## Future Work

- **Reconciliation script** — diffs GCS vs Firestore index, reports missing entries, optionally auto-fixes
- **Additional symbols** — extend the symbol toggle beyond QQQ/TQQQ
- **Virtual scroll** for large file lists (if needed for corpus date listings)
- **File download** — add a download button for individual files

---

## Added Features

The following features were implemented beyond the original design spec. They are documented here for historical accuracy.

### Direct Contract ID Read

**Added:** 2026-07-25

A direct contract ID input field with a "Go" button, positioned in the search controls row. Allows reading a specific time-series file by OCC contract ID without needing to filter through the dropdowns.

- Input: free-text, auto-uppercased
- Triggers: "Go" button click or Enter key
- Calls the `read` action directly with `{ bucket: 'time-series', symbol, contractId }`
- No list operation required

### Metadata Panel (Third Pane)

**Added:** 2026-07-25

A third panel between the file list and content viewer, visible only when the time-series bucket is active. Displays GCS custom metadata for the selected contract file.

- Shows labeled key-value pairs from the GCS object's custom metadata
- Known fields (symbol, contractID, expiration, type, strike, firstObserved, lastObserved, observationCount, schemaVersion) are displayed with human-readable labels and date formatting
- Unknown metadata fields are appended with their raw key names
- Loading and empty states included

### Pretty-Print JSONL

**Added:** 2026-07-25

The content viewer automatically pretty-prints JSONL content. Each line is parsed as JSON and re-serialized with 2-space indentation. If parsing fails (non-JSON content), it falls back to displaying the raw content.

### Contract Length Display

**Added:** 2026-07-25

The file list panel includes a "Length" column that classifies each contract by its calendar-day duration from `firstObserved` to `expiration`. Uses the `classifyContractLength` utility with 16 length buckets (1d, 1w, 2w, 1mo, 2mo, 3mo, 6mo, 1yr, 2yr, 3yr, 3yr+).

Also includes a "First Trading" column showing the first observed date with day-of-week.

### Error Snackbar

**Added:** 2026-07-25

Errors from the store (list/read/index operations) are surfaced via a Material snackbar with a 5-second auto-dismiss. Uses an `effect()` in the component to watch the store's `error` signal.

### Strike Autocomplete

**Added:** 2026-07-25

The strike filter uses a Material autocomplete input. As the user types, the strike options are filtered in real-time using `toSignal()` to bridge the `FormControl.valueChanges` Observable to a signal consumed by a `computed()`.

### Corpus File Metadata

**Added:** 2026-07-25

The corpus list panel displays GCS object metadata (file size, last updated timestamp) alongside each date entry. The backend `listCorpus` method fetches `size`, `generation`, and `updated` from GCS object metadata for each file.
