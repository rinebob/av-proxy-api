# Storage File Viewer UI — Implementation Guide

**Audience:** Engineers building a UI that takes a symbol + expiration/strike and downloads contract indexes from a partner or admin endpoint.
**Last updated:** 2026-07-25

---

## Overview

The Storage File Viewer is an Angular admin UI at `/storage-file-viewer` that lets users browse 500k+ options contract files stored in GCS. The UI provides two filterable dropdowns (expiration, strike) that populate instantly from a Firestore index, plus a list/read panel for inspecting file contents. It supports both the **time-series** bucket (per-contract JSONL files) and the **corpus** bucket (per-symbol daily gzipped JSON files). Users can also read a contract directly by ID without listing.

This doc explains the full data flow so that other teams (e.g., RS) can replicate the same UX against their own endpoint.

---

## Architecture at a Glance

```
User selects bucket (time-series / corpus)
       │
       ▼
User types symbol
       │
       ▼
┌──────────────────────┐
│  Component           │  storage-viewer.component.ts
│  (debounced input)   │
└──────────┬───────────┘
           │ store.setSymbol(symbol) + store.loadIndex()
           ▼
┌──────────────────────┐
│  NgRx Signal Store   │  storage-viewer.store.ts
│  loadIndex()         │  (time-series only — corpus has no index)
└──────────┬───────────┘
           │ Firestore: getDocs(ts-expirations) + getDocs(ts-strikes)
           ▼
┌──────────────────────┐
│  Firestore Index     │  options-file-index/{SYMBOL}/
│  (two subcollections)│    ts-expirations/{DATE}
│                      │    ts-strikes/{STRIKE}
└──────────┬───────────┘
           │ Build cross-filter maps
           ▼
┌──────────────────────┐
│  Store state         │  allExpirations, allStrikes,
│  (signals)           │  expirationToStrikes, strikeToExpirations,
│                      │  filteredExpirations, filteredStrikes
└──────────┬───────────┘
           │ Template binds to signals
           ▼
┌──────────────────────┐
│  Dropdowns           │  Expiration <mat-select>, Strike <mat-autocomplete>,
│  (cross-filtered)    │  Type <mat-select> (Call/Put/All)
└──────────────────────┘
           │
           ├── List button → store.list() → Cloud Function → contracts/dates
           │
           └── Direct Contract ID input → store.read(id) → Cloud Function → file content
```

---

## Step-by-Step Data Flow

### Step 0: Bucket Selection

**File:** `storage-viewer.component.html` — `<mat-button-toggle-group>`

The UI starts with a bucket toggle (Time Series vs Corpus). This controls which GCS bucket is queried:
- **Time Series** — per-contract JSONL files, indexed in Firestore, supports expiration/strike/type filters
- **Corpus** — per-symbol daily gzipped JSON files, no index, lists available dates directly from GCS

When the bucket changes, `onBucketChange()` calls `store.setBucket()`, which clears list results, read results, and errors. Filter dropdowns are only shown for the time-series bucket.

### Step 1: Symbol Entry (debounced)

**File:** `src/app/feat/storage-file-viewer/comps/storage-viewer/storage-viewer.component.ts`

The symbol input is a `FormControl` with a 500ms debounce. On each debounced value change, the component calls two store methods:

```typescript
ngOnInit(): void {
  this.symbolCtrl.valueChanges.pipe(
    debounceTime(500),
    distinctUntilChanged(),
    takeUntilDestroyed(this.destroyRef),
  ).subscribe((value) => {
    const trimmed = value.toUpperCase().trim();
    if (trimmed) {
      this.store.setSymbol(trimmed);
      this.store.loadIndex();
    }
  });
}
```

**Key points:**
- Symbol is always uppercased and trimmed before use.
- 500ms debounce prevents excessive Firestore reads while typing.
- `setSymbol()` clears all filter state (expiration, strike, option type, cross-filter maps, list results) so the UI starts fresh for each new symbol.
- The store's `onInit` hook also calls `loadIndex()` once at startup (the default symbol is `QQQ`).
- Error feedback is handled via an `effect()` that watches `store.error()` and shows a `MatSnackBar` when an error occurs.

### Step 2: Firestore Index Load

**File:** `src/app/feat/storage-file-viewer/store/storage-viewer.store.ts` — `loadIndex()` method

Once a symbol is set, the store fires `loadIndex()` which reads **two Firestore subcollections in parallel** using `forkJoin`:

```typescript
const symbolDocRef = doc(firestore, OPTIONS_FILE_INDEX_COLLECTION, symbol);
const expCol = collection(symbolDocRef, TS_EXPIRATIONS_SUBCOLLECTION);
const strikeCol = collection(symbolDocRef, TS_STRIKES_SUBCOLLECTION);

return forkJoin({
  expirations: defer(() => getDocs(query(expCol))),
  strikes: defer(() => getDocs(query(strikeCol))),
}).pipe(...)
```

**Firestore index structure:**

```
options-file-index/{SYMBOL}                       ← metadata doc
  { symbol, lastUpdated, tsExpirationCount, totalContracts }

options-file-index/{SYMBOL}/ts-expirations/{DATE} ← one doc per expiration
  { date: string, strikes: number[], types: string[], contractIds: string[] }

options-file-index/{SYMBOL}/ts-strikes/{STRIKE}   ← one doc per strike
  { strike: number, expirations: string[], types: string[], contractIds: string[] }
```

**Constants (mirrored in the store):**
- `OPTIONS_FILE_INDEX_COLLECTION = 'options-file-index'`
- `TS_EXPIRATIONS_SUBCOLLECTION = 'ts-expirations'`
- `TS_STRIKES_SUBCOLLECTION = 'ts-strikes'`

> **For RS:** Your endpoint may not expose Firestore directly. Instead, your backend API should return two lists: all expirations (with their available strikes) and all strikes (with their available expirations). The frontend logic is identical from this point forward — you just swap the data source.

### Step 3: Building Cross-Filter Maps

After the Firestore reads return, the store builds **two bidirectional maps** from the raw docs:

```typescript
const expToStrikes: Record<string, number[]> = {};
const strikeToExps: Record<number, string[]> = {};
const allExpirations: string[] = [];
const allStrikes: number[] = [];

for (const docSnap of expirations.docs) {
  const data = docSnap.data() as ExpirationIndexDoc;
  expToStrikes[data.date] = data.strikes;
  allExpirations.push(data.date);
}

for (const docSnap of strikes.docs) {
  const data = docSnap.data() as StrikeIndexDoc;
  strikeToExps[data.strike] = data.expirations;
  allStrikes.push(data.strike);
}

allExpirations.sort();
allStrikes.sort((a, b) => a - b);
```

These maps are stored as signals in the store state:

| State field | Type | Purpose |
|---|---|---|
| `allExpirations` | `string[]` | Complete sorted list of expiration dates |
| `allStrikes` | `number[]` | Complete sorted list of strike prices |
| `expirationToStrikes` | `Record<string, number[]>` | Expiration → available strikes at that expiration |
| `strikeToExpirations` | `Record<number, string[]>` | Strike → available expirations for that strike |
| `filteredExpirations` | `string[]` | Expirations shown in dropdown (narrowed by strike filter) |
| `filteredStrikes` | `number[]` | Strikes shown in dropdown (narrowed by expiration filter) |

On initial load, `filteredExpirations = allExpirations` and `filteredStrikes = allStrikes` (no filters applied yet).

### Step 4: Dropdown Rendering

**File:** `src/app/feat/storage-file-viewer/comps/storage-viewer/storage-viewer.component.html`

#### Expiration dropdown — `<mat-select>`

```html
<mat-select
  [value]="store.expiration()"
  (selectionChange)="onExpirationSelected($event.value ?? null)"
  [disabled]="store.filtersDisabled()"
>
  <mat-option [value]="null">All</mat-option>
  @for (exp of store.filteredExpirations(); track exp) {
    <mat-option [value]="exp">{{ exp }} ({{ dayOfWeek(exp) }})</mat-option>
  }
</mat-select>
```

- Binds to `store.filteredExpirations()` signal — updates reactively when cross-filter changes.
- `filtersDisabled` is a computed signal: `!store.symbol() || store.loadingIndex()` — dropdowns are disabled until the index is loaded.
- An "All" option (`[value]="null"`) lets the user clear the expiration filter.
- Each option shows the date with day-of-week (e.g. `2026-01-15 (Thu)`) via the `dayOfWeek()` utility from `@shared/options`.

#### Strike dropdown — `<mat-autocomplete>`

```html
<input
  matInput
  type="text"
  [formControl]="strikeCtrl"
  [matAutocomplete]="strikeAuto"
  [disabled]="store.filtersDisabled()"
  placeholder="Search strike"
/>
<mat-autocomplete #strikeAuto="matAutocomplete"
  (optionSelected)="onStrikeSelected($event.option.value)"
>
  <mat-option [value]="">All</mat-option>
  @for (strike of filteredStrikes(); track strike) {
    <mat-option [value]="strike">{{ strike }}</mat-option>
  }
</mat-autocomplete>
```

- Uses `matAutocomplete` so the user can type to narrow strikes (e.g., typing "450" filters to strikes containing "450").
- The component has a `computed` signal `filteredStrikes` that filters the store's `filteredStrikes()` by the typed text:

```typescript
readonly filteredStrikes = computed<string[]>(() => {
  const input = this.strikeCtrl.value?.toLowerCase() ?? '';
  const strikes = this.store.filteredStrikes();
  if (!input) return strikes.map((s) => String(s));
  return strikes.filter((s) => String(s).includes(input)).map((s) => String(s));
});
```

- An "All" option (`[value]=""`) lets the user clear the strike filter.

#### Type dropdown — `<mat-select>`

```html
<mat-select
  [value]="store.optionType()"
  (selectionChange)="onOptionTypeChange($event.value ?? null)"
  [disabled]="store.filtersDisabled()"
>
  <mat-option [value]="null">All</mat-option>
  <mat-option value="C">Call</mat-option>
  <mat-option value="P">Put</mat-option>
</mat-select>
```

- Filters contract list by call/put type. `null` = All.
- Calls `store.setOptionType()` which patches the `optionType` state field.

### Step 5: Cross-Filtering (the key UX feature)

When the user selects an expiration, the strike dropdown **automatically narrows** to only strikes available at that expiration. And vice versa.

**File:** `storage-viewer.store.ts` — `setExpiration()` and `setStrike()` methods

#### Selecting an expiration narrows strikes:

```typescript
setExpiration: (expiration: string | null) => {
  const expToStrikes = store.expirationToStrikes();
  if (expiration && expToStrikes[expiration]) {
    patchState(store, {
      expiration,
      filteredStrikes: [...expToStrikes[expiration]].sort((a, b) => a - b),
    });
  } else {
    // "All" selected → reset strikes to full list
    patchState(store, {
      expiration,
      filteredStrikes: [...store.allStrikes()],
    });
  }
},
```

#### Selecting a strike narrows expirations:

```typescript
setStrike: (strike: number | null) => {
  const strikeToExps = store.strikeToExpirations();
  if (strike !== null && strikeToExps[strike]) {
    patchState(store, {
      strike,
      filteredExpirations: [...strikeToExps[strike]].sort(),
    });
  } else {
    // "All" selected → reset expirations to full list
    patchState(store, {
      strike,
      filteredExpirations: [...store.allExpirations()],
    });
  }
},
```

**This is the core pattern:** the two maps (`expirationToStrikes` and `strikeToExpirations`) are built once at index-load time, then every cross-filter operation is a simple lookup + array copy. No additional API calls are needed when filters change.

### Step 6: List + Read Actions

Once the user has selected filters, they click the **List** button to fetch matching contracts.

**List (time-series):** The store calls the Cloud Function (`storageFileViewer`) with `{ action: 'list', bucket: 'time-series', symbol, expiration?, strike?, type? }`. The backend queries the Firestore index using one of four paths:

| Filters provided | Backend path | Firestore read |
|---|---|---|
| Symbol only | Path 4 | All expiration docs → aggregate contract IDs |
| Symbol + expiration | Path 1 | Single expiration doc |
| Symbol + strike | Path 2 | Single strike doc |
| Symbol + expiration + strike | Path 3 | Both docs → intersect contract IDs |

Contracts are filtered by type (call/put) server-side via `filterContractsByType()` from `contract-result.utils.ts`.

**List (corpus):** The store calls `{ action: 'list', bucket: 'corpus', symbol }`. The backend lists all `.json.gz` files under the corpus prefix and returns sorted date strings.

**Read (time-series):** Clicking a contract in the list panel calls `{ action: 'read', bucket: 'time-series', symbol, contractId }`. The backend downloads the JSONL file from GCS and returns its content plus GCS custom metadata (firstObserved, lastObserved, observationCount, schemaVersion).

**Read (corpus):** Clicking a date in the list panel calls `{ action: 'read', bucket: 'corpus', symbol, date }`. The backend downloads, decompresses, and returns the gzipped JSON envelope.

### Step 7: Direct Contract ID Read

Users can skip the list step entirely by typing a contract ID (e.g. `QQQ190104C00128500`) in the **Contract ID** input and clicking **Go** (or pressing Enter). This calls `onReadContractId()` which uppercases/trims the ID and calls `store.read(id)` directly. This works for both buckets — in time-series mode it reads the JSONL file, in corpus mode it attempts to read the date matching the contract's expiration.

### Step 8: Contract List Display

The list panel shows a table-like layout with columns:

| Column | Source | Description |
|---|---|---|
| Contract ID | `contract.contractId` | OCC-format ID |
| Expiration | `formatDateWithDow(contract.expiration)` | Date with DOW |
| Strike | `formatStrike(contract.strike)` | Currency-formatted |
| Type | `contract.type` | `call` / `put` (CSS-styled) |
| Length | `contractLength(contract)` | Bucket label (1mo, 3mo, etc.) via `classifyContractLength` |
| Obs | `contract.observationCount` | From GCS metadata, or `—` |
| First Trading | `firstTradingDate(contract)` | `firstObserved` with DOW, or `—` |

The selected item is highlighted via the `selectedItemId` signal.

### Step 9: Metadata + Content Panels

When a time-series file is read, two additional panels appear:

**Metadata panel (center):** Displays GCS custom metadata as labeled rows using `metadataEntries()`. Known fields are shown in a fixed order (Symbol, Contract ID, Expiration, Type, Strike, First Observed, Last Observed, Observations, Schema Version). Date fields show DOW. Unknown metadata keys appear after known ones.

**Content panel (right):** Shows the file path, byte count (human-readable via `formatBytes()`), and pretty-printed content. `formatContent()` parses each JSONL line as JSON and re-serializes with 2-space indentation. If parsing fails, it tries parsing as a single JSON object, then falls back to raw content. A close button clears the read result.

---

## Component → Store → API Call Chain

```
Component                    Store                        API Service
─────────                    ─────                        ───────────
bucket toggle                setBucket(bucket)
  → onBucketChange()           → clears list/read/error

symbolCtrl.valueChanges      setSymbol(symbol)
  → debounce 500ms            → clears all filters + maps
  → store.setSymbol()         → patches state
  → store.loadIndex()
                              loadIndex()                   (time-series only)
                                → Firestore getDocs       (no API call —
                                  (ts-expirations +         direct Firestore
                                   ts-strikes)              read from browser)
                                → builds cross-filter maps
                                → patches state

onExpirationSelected()       setExpiration(exp)
  → store.setExpiration()      → looks up expToStrikes map
                                → patches filteredStrikes

onStrikeSelected()            setStrike(strike)
  → store.setStrike()          → looks up strikeToExps map
                                → patches filteredExpirations

onOptionTypeChange()         setOptionType(type)
  → store.setOptionType()      → patches optionType

onList()                      list()
  → store.list()                → api.list(req)           StorageViewerApiService
                                  (httpsCallable)           → Firebase Functions
                                → patches contracts/dates     → storageFileViewer
                                                                  Cloud Function

onReadItem(id)                read(id)
  → store.read(id)              → api.read(req)           StorageViewerApiService
                                  (httpsCallable)           → Firebase Functions
                                → patches readResult          → storageFileViewer
                                                                  Cloud Function

onReadContractId()           read(contractId)
  → contractIdCtrl.value       → same as onReadItem but
  → store.read(id)               skips list step

store.error() signal          → effect() → MatSnackBar.open()
```

---

## File Reference

| File | Purpose |
|---|---|
| `src/app/feat/storage-file-viewer/comps/storage-viewer/storage-viewer.component.ts` | Angular component — symbol input, bucket toggle, dropdown handlers, list/read triggers, direct contract ID read, metadata display, content formatting, error snackbar |
| `src/app/feat/storage-file-viewer/comps/storage-viewer/storage-viewer.component.html` | Template — bucket toggle, symbol/expiration/strike/type controls, contract ID input, list + metadata + content panels |
| `src/app/feat/storage-file-viewer/comps/storage-viewer/storage-viewer.component.scss` | Styles — flexbox layout, light/dark theme support |
| `src/app/feat/storage-file-viewer/store/storage-viewer.store.ts` | NgRx Signal Store — state, cross-filter logic, `loadIndex()`, `list()`, `read()`, `setBucket()`, `setOptionType()`, error handling |
| `src/app/feat/storage-file-viewer/common/storage-viewer-api.ts` | API service wrapping the `storageFileViewer` Firebase callable function |
| `shared/options/contract-types.ts` | Shared request/response types (`StorageViewerRequest`, `ContractResult`, `ListResult`, `ExpirationIndexDoc`, `StrikeIndexDoc`, etc.) |
| `shared/options/contract-length.utils.ts` | Shared utilities — `classifyContractLength`, `calendarDaysBetween`, `dayOfWeek`, `formatDateWithDow` |
| `functions/src/v2/historical-options-corpus/handlers/storage-file-viewer.http.ts` | Backend HTTP handler — auth check + dispatch to service |
| `functions/src/v2/historical-options-corpus/services/storage-file-viewer.service.ts` | Backend service — Firestore index queries, GCS file reads, corpus listing |
| `functions/src/v2/historical-options-corpus/services/contract-result.utils.ts` | Backend utils — `parseContractResult()`, `filterContractsByType()` for contract ID parsing and type filtering |
| `functions/src/v2/historical-options-corpus/services/options-index.writer.ts` | Index writer — defines `ExpirationIndexDoc`, `StrikeIndexDoc`, collection constants |

---

## Adapting This Pattern for RS (Partner Endpoint)

RS's endpoint (`partnerListContractsV2`) uses a different transport (HTTPS GET with query params vs. Firebase callable function) but the **data flow and frontend logic are identical**. Here's how to adapt:

### 1. API Service — swap the transport

Instead of `httpsCallable`, use `HttpClient` or `fetch` to call the partner endpoint:

```typescript
// RS equivalent of StorageViewerApiService
listContracts(symbol: string, expiration?: string, strike?: number, type?: 'C' | 'P')
  : Observable<ContractResult[]> {
  const params = new HttpParams()
    .set('symbol', symbol);
  if (expiration) params = params.set('expiration', expiration);
  if (strike != null) params = params.set('strike', String(strike));
  if (type) params = params.set('type', type);

  return this.http.get<{ ok: boolean, contracts: ContractResult[], count: number }>(
    `${this.apiUrl}/partnerListContractsV2`,
    { params, headers: this.authHeaders }
  ).pipe(map(res => res.contracts));
}
```

### 2. Index loading — two options

**Option A: Direct Firestore access (if RS has Firebase SDK in the browser)**

Use the exact same `loadIndex()` logic from the store. The Firestore index is readable to authenticated admins. This gives you instant dropdown population with zero API calls.

**Option B: Backend API endpoint (if RS does not use Firebase in the browser)**

Create a lightweight backend endpoint that returns the index data in one call:

```
GET /partnerIndex?symbol=QQQ
→ {
    expirations: [{ date: "2026-01-15", strikes: [80, 85, ...] }, ...],
    strikes: [{ strike: 450, expirations: ["2024-01-19", ...] }, ...]
  }
```

Then in the store, replace the Firestore `getDocs` calls with a single HTTP GET:

```typescript
loadIndex: rxMethod<void>(
  pipe(
    tap(() => patchState(store, { loadingIndex: true })),
    switchMap(() => {
      const symbol = store.symbol();
      if (!symbol) return of(null);
      return api.getIndex(symbol).pipe(
        tap(({ expirations, strikes }) => {
          // Same map-building logic as the admin store
          const expToStrikes: Record<string, number[]> = {};
          const strikeToExps: Record<number, string[]> = {};
          for (const exp of expirations) expToStrikes[exp.date] = exp.strikes;
          for (const s of strikes) strikeToExps[s.strike] = s.expirations;
          // ... patchState with maps + sorted lists
        }),
      );
    }),
  ),
),
```

### 3. Cross-filtering — identical

The cross-filter logic (`setExpiration`, `setStrike`) is **pure frontend** — it only reads the maps built in step 2. No changes needed regardless of transport.

### 4. List action — use the partner endpoint

The partner endpoint requires at least one of `expiration` or `strike` (in addition to `symbol`). The admin endpoint allows symbol-only queries. Adjust the UI to enforce this constraint:

```typescript
// Disable the List button until at least expiration or strike is selected
readonly canList = computed(() =>
  !!this.store.symbol() &&
  (!!this.store.expiration() || this.store.strike() !== null) &&
  !this.store.loadingList()
);
```

### 5. Read action — use the partner contract endpoint

RS should use `partnerHistoricalOptionsContractV2` (or equivalent) to fetch the time series for a discovered contract ID, rather than the admin `storageFileViewer` read action.

### 6. Auth differences

| Concern | Admin UI | RS partner UI |
|---|---|---|
| Auth | Firebase Auth (admin custom claim) | Service account OIDC + audience |
| Transport | `httpsCallable` (Firebase SDK) | HTTPS GET with `Authorization: Bearer` header |
| Firestore read | Direct from browser via Angular Fire | Via backend API only |
| Allowed symbols | Any | `QQQ`, `TQQQ` only (enforced server-side) |

---

## Common Pitfalls

1. **Forgetting to clear cross-filter state on symbol change** — `setSymbol()` must reset `allExpirations`, `allStrikes`, both maps, and both `filtered*` arrays. Otherwise stale data from the previous symbol bleeds into the dropdowns.

2. **Not disabling dropdowns during index load** — The `filtersDisabled` computed signal (`!symbol || loadingIndex`) prevents the user from interacting with dropdowns before the index data is ready.

3. **Strike type mismatch** — Strikes are `number` in the store and index docs. The autocomplete uses `string` for display. The conversion happens in `onStrikeSelected`: `const num = value ? Number(value) : null`.

4. **Not uppercasing the symbol** — Firestore document IDs are case-sensitive. The index is built with uppercase symbols. Always `toUpperCase().trim()` before any Firestore or API call.

5. **Partner endpoint requires at least one filter** — Unlike the admin endpoint which allows symbol-only queries, `partnerListContractsV2` requires at least `expiration` or `strike`. The UI must enforce this before enabling the list button.

6. **Corpus bucket has no Firestore index** — The corpus bucket lists dates directly from GCS via `bucket.getFiles()`. The `loadIndex()` call is only meaningful for the time-series bucket. The store still calls it on init regardless of bucket, but the dropdowns are hidden when corpus is active.

7. **Direct contract ID read bypasses list** — The Contract ID input + Go button calls `store.read()` directly without requiring a prior `list()` call. The contract ID must be uppercased before use.

8. **Error handling is reactive** — Errors from `loadIndex()`, `list()`, and `read()` are caught via `catchError` in the store's `rxMethod` pipes and stored in the `error` signal. An `effect()` in the component watches this signal and shows a `MatSnackBar`. Always call `store.clearError()` when starting a new operation.

---

## Related Documents

- `docs/operations/storage-file-viewer-design.md` — Full design document (architecture, UI layout, implementation plan)
- `docs/operations/storage-file-viewer-index.md` — ADR 0002 (Firestore index design decision)
- `docs/operations/storage-file-viewer-code-review.md` — Code review with findings and remediation plan
- `docs/operations/storage-file-viewer-review.md` — Session review with expiration enhancement findings
- `docs/partner/partner-discovery.md` — Partner endpoint reference (includes `partnerListContractsV2`)
- `docs/partner/options-data/expiration-dropdown-enhancement.md` — Proposed enhancement to show coverage days + day of week in the expiration dropdown
