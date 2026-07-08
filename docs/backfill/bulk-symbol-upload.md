# Bulk Symbol Upload & Onboarding Plan

## 1. Objectives

- **Enable bulk onboarding of symbols** (e.g., SPX/NDX constituents) into production `tracked-symbols`.
- **Automate Alpha Vantage metadata lookup** via `SYMBOL_SEARCH` for each requested symbol.
- **Apply a strict auto-accept rule**:
  - Only accept candidates with `matchScore === 1.0` **and** exact symbol match.
  - All other cases are treated as ambiguous or failed.
- **Queue ambiguous symbols for manual review** in a dedicated admin UI using a Firestore-backed review queue.
- **Respect AV rate limits** and avoid interfering with existing scheduled refresh jobs.

## 2. High-Level Flow

### 2.1 Ingestion (Bulk Upload Initiation)

1. An external scraper produces a JSON array of symbols and metadata in the form:
   ```json
   [
     {
       "ticker": "NVDA",
       "company_name": "NVIDIA Corporation",
       "exchange": "NASDAQ",
       "etfs": ["SPY", "QQQ", "XLK", "SMH"]
     }
   ]
   ```
2. Admin opens the existing `SymbolManagerView` and clicks a new **"Bulk Import"** button next to **"Search keywords"**.
3. A **Bulk Import dialog** opens, allowing the admin to paste or upload this JSON payload.
4. The dialog (or backend) maps each JSON object to an internal `BulkImportItem`:
   ```ts
   type BulkImportItem = {
     symbol: string;      // from ticker
     name: string;        // from company_name
     exchange?: string;   // from exchange
     etfs?: string[];     // from etfs
   };
   ```
5. Admin clicks **"Run Bulk Import"**, which sends the `BulkImportItem[]` list to a backend function.

### 2.2 Backend Processing

For each `BulkImportItem`:

1. Normalize the input symbol to uppercase and check `tracked-symbols/{symbol}` first.
   - If the symbol already exists:
     - Merge/union the input `etfs` array into the existing doc’s `etfs` field (uppercased, de-duplicated).
     - Update `_lastUpdated`.
     - Log outcome as `ALREADY_TRACKED` with `reason: UPDATED_ETFS` and **do not** call AV or queue this symbol.
2. For symbols not yet in `tracked-symbols`, call AV `SYMBOL_SEARCH` with the symbol as the primary keyword.
3. Normalize the AV response to an internal candidate shape:
   - `Candidate = { symbol: string; name: string; region: string; currency: string; matchScore: number; raw?: any }`.
4. Apply **strict auto-accept rule**:
   - Filter to candidates where:
     - `candidate.symbol.toUpperCase() === item.symbol.toUpperCase()` **and**
     - `candidate.matchScore === 1.0`.
   - If **exactly one** such candidate exists (**AUTO_ACCEPTED**):
     - Build the `tracked-symbols/{symbol}` document primarily from the AV candidate (symbol, name, type, region, marketOpen, marketClose, timezone, currency, matchScore).
     - Overlay `exchange` and `etfs` from the bulk-import input plus metadata flags (`_createdAt`, `_lastUpdated`, `_isActive`).
   - If there are AV candidates but no strict match (**QUEUED_PENDING_NO_STRICT_MATCH**):
     - Create a `symbol-import-queue` entry for manual review with:
       - Original request (`symbol`, `name`, optional `exchange`, `etfs`),
       - Full AV candidates list,
       - Reason code (e.g., `NO_STRICT_MATCH`),
       - Client context, timestamps, and status.
   - If AV returns zero candidates or a hard error (**FAILED**):
     - Record the failure in `BulkImportResult.errors` and/or a queue entry with an explicit reason (`NO_CANDIDATES`, `AV_ERROR_ETIMEDOUT`, etc.).
5. For observability and debugging:
   - Log a compact preview of the first few AV candidates per symbol (symbol, name, region, currency, matchScore).
   - Distinguish AV-origin errors (network, rate limits, etc.) from Firestore/other errors in both logs and the `BulkImportResult` response.
6. Respect AV **rate limits** by throttling to ~20 requests/min for this job to avoid collisions with existing scheduled refreshes.

> **Note:** The AV fetch phase is designed as a single, self-contained run (no interactive pause/resume). Resumability is achieved by making the operation idempotent and by persisting ambiguous/failed symbols into `symbol-import-queue` for later review.

### 2.3 Manual Review

1. Admin opens a dedicated **"Import Queue"** UI (new view/tab).
2. For each pending queue item:
   - View requested symbol + name.
   - View AV candidates list, including `symbol`, `name`, `region`, `currency`, `matchScore`.
3. Admin can:
   - **Accept** a chosen candidate → write to `tracked-symbols/{symbol}` and mark queue item as `ACCEPTED`.
   - **Reject** the request → mark queue item as `REJECTED` (no tracked-symbols write).
4. `onSymbolAdded` trigger (already implemented) backfills AV time-series data for any new `tracked-symbols` entries.


## 3. Firestore Schema

### 3.1 Existing Collections (referenced)

- `tracked-symbols/{symbol}`
  - Global list of symbols being tracked.
  - On-create trigger kicks off AV time-series backfill (daily, weekly, monthly, FULL) into `symbol-data`.

- `symbol-data/{symbol}/...`
  - Existing time-series and split-adjusted data paths (already implemented and used by backfill logic).

### 3.2 New Collection: `symbol-import-queue`

- **Path**: `symbol-import-queue/{queueId}`
- **Fields (draft)**:
  - `clientId: string`
  - `requestedSymbol: string`
  - `requestedName: string`
  - `exchange?: string`
  - `etfs?: string[]`
  - `status: 'PENDING' | 'ACCEPTED' | 'REJECTED' | 'FAILED'`
  - `reason?: string` (failure or rejection comment)
  - `candidates: Candidate[]`
    - `{ symbol: string; name: string; region: string; currency: string; matchScore: number; raw?: any }`
  - `createdAt: Timestamp`
  - `updatedAt?: Timestamp`
  - `processedBy?: string` (UID / email of admin handling it)

- **Indexing considerations**:
  - Composite index on `(clientId, status)` for efficient queue listing per client.


## 4. Backend API / Cloud Function Design

### 4.1 Bulk Import Function

- **Type**: Firebase Callable Function or secured HTTPS endpoint (consistent with existing V2 APIs).
- **Name (working)**: `bulkImportSymbolsV2`.
- **Request payload**:
  - `clientId: string`
  - `items: { symbol: string; name: string; }[]`

- **Response payload**:
  ```ts
  interface BulkImportResult {
    ok: boolean;
    autoAccepted: number;
    queuedForReview: number;
    errors: { symbol: string; name: string; error: string }[];
  }
  ```

- **Responsibilities**:
  - Validate input (non-empty symbol, reasonable length, max batch size per call).
  - Iterate through items with controlled concurrency and rate limiting.
  - For each item:
    - Check `tracked-symbols/{symbol}` to determine if the symbol is already tracked:
      - If it exists, treat as a no-op (idempotent): do **not** call AV or create a queue item, but log as `ALREADY_TRACKED` for visibility.
      - If it does not exist, proceed with AV lookup.
    - Call AV `SYMBOL_SEARCH` (via existing Alpha Vantage V2 client) for symbols not already tracked.
    - Transform and evaluate candidates using strict auto-accept rule.
    - Write `tracked-symbols` docs for auto-accepted items.
    - Write `symbol-import-queue` docs for ambiguous or error cases.
    - Collect ETF membership mappings from `item.etfs` into an in-memory accumulator keyed by ETF symbol.
  - Log per-symbol progress including:
    - Requested symbol/name and (optional) exchange/ETFs.
    - Outcome: `ALREADY_TRACKED`, `AUTO_ACCEPTED`, `QUEUED_PENDING_NO_STRICT_MATCH`, or `FAILED` (with reason).
    - Basic timing and AV call result summary (e.g., number of candidates returned).
  - Aggregate metrics: counts and errors.
  - At the end of the run, log ETF constituents in a compact, human-readable form.
  - Return `BulkImportResult` to the caller.

- **Rate limiting strategy (initial)**:
  - Process items sequentially or with small concurrency (e.g., up to 2 in parallel).
  - Insert a delay between AV requests (e.g., ~3s) to stay under ~20 req/min for this job.
  - Optionally expose a `maxRatePerMinute` setting to tune later.

### 4.2 Review/Approval Functions

We will need additional backend endpoints for the admin review flow:

1. **List queue items**
   - `listSymbolImportQueue(clientId, status='PENDING')`
   - Returns a paginated list of queue items for a given client.

2. **Accept queue item**
   - `acceptSymbolImport(queueId, chosenSymbol)`
   - Validates queue item state (`PENDING`).
   - Writes `tracked-symbols/{chosenSymbol}`.
   - Marks queue item as `ACCEPTED` and sets `processedBy`, `updatedAt`.

3. **Reject queue item**
   - `rejectSymbolImport(queueId, reason?)`
   - Marks queue item as `REJECTED` with optional reason.

These may be exposed as callable functions or HTTP endpoints, and will be wrapped on the frontend by `SymbolManagerService` or a dedicated `ImportQueueService`.


## 5. Frontend Design (Symbol Manager)

### 5.1 New Bulk Import Entry Point

- **Location**: `SymbolManagerView` → `SymbolManagerComponent` action bar.
- **UI element**:
  - New button next to "Search keywords" (e.g., "Bulk import…").
- **Behavior**:
  - Opens `BulkImportDialogComponent`.

### 5.2 Bulk Import Dialog

- **Component (draft)**: `BulkImportDialogComponent` (standalone, Angular 17+).
- **Features**:
  - Multiline textarea for pasted lines: `SYMBOL,COMPANY NAME`.
  - Parse preview table: show parsed `symbol` + `name` and row count.
  - Basic validation:
    - Skip empty lines.
    - Warn for malformed lines.
    - Limit max rows per run (e.g., 500–1000).
  - Actions:
    - **Cancel**: close dialog with no changes.
    - **Run Bulk Import**: calls store/service and shows progress.

- **Store integration**:
  - New method in `SymbolManagerStore`:
    - `bulkImportSymbols(items: BulkImportItem[]): Observable<BulkImportResult>`.
  - Uses `SymbolManagerService.bulkImportSymbols(items)`.
  - Updates `loading` and `error` state, and optionally a `lastBulkImportSummary` field.

### 5.3 Import Queue UI (Admin Review)

- **Location options**:
  - Separate page under an admin route (e.g., `/admin/import-queue`).
  - Or additional tab within the Symbol Manager for admins only.

- **UI behavior**:
  - Table of queue items (filtered to `status === 'PENDING'` and current client).
  - Expandable row or side panel to show candidates with details.
  - Buttons for **Accept** (per candidate) and **Reject** (queue item).

- **Interactions**:
  - On Accept → call `acceptSymbolImport` function, then refresh list.
  - On Reject → call `rejectSymbolImport` function, then refresh list.


## 6. Security & Permissions

- **Write access to `tracked-symbols`**:
  - Only via backend functions; frontend writes should go through secure APIs.
- **Write access to `symbol-import-queue`**:
  - Only backend functions may create/update queue items.
- **Frontend access**:
  - Only authenticated admin users can invoke bulk import and review endpoints.

- **Firestore rules (high level)**:
  - `tracked-symbols`: read-only for authorized clients; writes restricted to service account / Cloud Functions.
  - `symbol-import-queue`: read/write restricted to admin roles (or service account for system writes).


## 7. Rate Limiting & Operational Concerns

- **AV rate limits**:
  - Target ~20 req/min for bulk jobs to leave headroom for scheduled refreshers.
  - Consider a global limiter shared by scheduled jobs and bulk import in the future.

- **Failure handling**:
  - Network/API errors → create queue item with `status='FAILED'` or log in `errors` array in response.
  - AV empty or malformed response → treat as ambiguous; send to queue.

- **Observability**:
  - Structured logs per bulk run including:
    - Run ID, clientId, item counts (alreadyTracked/accepted/queued/errors), total AV calls, duration.
    - High-level summary of outcomes:
      - `alreadyTracked: A`, `autoAccepted: N`, `queuedPendingNoStrictMatch: M`, `failed: K`.
  - Optional health metrics integration to track bulk import runs.
  - Per-run ETF membership summary logs:
    - For every ETF symbol referenced in any input `etfs` array, log:
      - `etf: SPY`\
        `symbols: [AAPL, BA, BAC, NVDA, ...]`
    - These logs are derived purely from the input JSON and are independent of AV lookup success.

## 7.1 Error & Mismatch Handling Semantics

When AV does not have a clean match for a requested symbol, the system uses explicit outcome categories to keep the workflow predictable and reviewable:

- **AUTO_ACCEPTED**
  - Condition:
    - At least one candidate from AV, and
    - Exactly one candidate where `candidate.symbol.toUpperCase() === requestedSymbol.toUpperCase()` and `matchScore === 1.0`.
  - Behavior:
    - Create/update `tracked-symbols/{symbol}` with AV metadata.
    - No queue item is required for this symbol.

- **QUEUED_PENDING_NO_STRICT_MATCH**
  - Conditions (any of):
    - AV returned candidates, but **none** satisfy the strict rule (symbol + 1.0 score).
    - AV returned multiple plausible candidates but more than one passes a looser heuristic, and we refuse to auto-pick.
  - Behavior:
    - Create `symbol-import-queue` entry with:
      - `status: 'PENDING'`
      - Original request fields (`requestedSymbol`, `requestedName`, optional `exchange`, `etfs`).
      - `candidates: Candidate[]` as returned by AV.
      - `reason: 'NO_STRICT_MATCH'` (or similar enum/string code).
    - No writes to `tracked-symbols` are performed until an admin explicitly accepts a candidate.

- **FAILED (AV error / no candidates)**
  - Conditions:
    - AV request fails (network/API error, rate-limited, malformed JSON, etc.), or
    - AV returns zero candidates and we want to distinguish this from “ambiguous but has candidates”.
  - Behavior:
    - Either create a `symbol-import-queue` item with `status: 'FAILED'` and an appropriate `reason` (e.g., `AV_ERROR`, `NO_CANDIDATES`), **or**
      record the failure only in the `BulkImportResult.errors` array if we prefer not to show these in the queue UI.
    - In all cases, no `tracked-symbols` write occurs.

These explicit categories ensure the approval process itself is naturally resumable: admins can work through `PENDING` items over time without ever needing to pause or resume the original AV fetch job.


## 8. Phased Implementation Plan

1. **Phase 1 – Planning & Contracts (this doc)**
   - Finalize Firestore schema for `symbol-import-queue`.
   - Finalize backend function contracts (request/response types).

2. **Phase 2 – Backend Core Logic**
   - Implement `bulkImportSymbolsV2` function with AV `SYMBOL_SEARCH` integration, strict auto-accept logic, queue writes, and basic throttling.
   - Add list/accept/reject functions for the review queue.

3. **Phase 3 – Frontend Bulk Import UI**
   - Add "Bulk import" button to Symbol Manager action bar.
   - Implement `BulkImportDialogComponent` and wire to `SymbolManagerStore`/`SymbolManagerService`.
   - Surface response summary to admin.

4. **Phase 4 – Admin Review UI**
   - Implement Import Queue view with listing, candidate inspection, and accept/reject actions.
   - Integrate with new backend list/accept/reject functions.

5. **Phase 5 – Validation & Rollout**
   - Dry-run bulk import on a smaller symbol subset.
   - Validate `tracked-symbols` writes and AV backfill behavior.
   - Run full SPX/NDX onboarding in production with monitoring.
