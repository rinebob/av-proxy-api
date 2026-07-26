# Contract Filter Plumbing Implementation Guide

**Audience:** RS (Relative Strength) backend & frontend engineers  
**Purpose:** Guide RS through implementing the contract filter form (symbol, expiration, strike, type) and contract list panel, based on the working SA (Savant) implementation.  
**Last updated:** 2026-07-26

---

## 1. What We Built (Overview)

SA built an admin "Storage File Viewer" that lets an internal user select a symbol, then filter by expiration, strike, and option type (C/P), and see a list of matching contracts in a left panel. Clicking a contract reads its raw time-series file from GCS.

RS needs the same filter form and contract list plumbing, but with a different data source for the dropdowns and contract list. RS will display the contract data as a chart instead of raw file content — that display layer is RS's own concern. This guide covers only the **plumbing**: how the filter form, dropdowns, and contract list are wired end-to-end.

### Architecture at a Glance

```
SA (Internal)                          RS (External)
─────────────                          ─────────────
Angular Component                      RS Frontend
    ↓                                      ↓
NgRx Signal Store                      RS State Layer
    ↓                                      ↓
Firebase Callable Function             HTTP → partnerListContractsV2
    ↓                                      ↓
Firestore Index (direct read)          Firestore Index (via Cloud Function)
    ↓
GCS File Read (raw content)
```

The critical difference: **SA reads the Firestore index directly from the Angular frontend** using the Firebase client SDK. **RS cannot do this** — RS has no direct Firestore access. RS must call the `partnerListContractsV2` HTTP endpoint, which queries the same Firestore index server-side and returns contract metadata over HTTP with OIDC auth.

---

## 2. The Firestore Index (Shared Backbone)

Both SA and RS consume the same Firestore index. Understanding its structure is essential because the dropdown population logic depends on it.

### Collection Structure

```
options-file-index/{SYMBOL}
  ├── (metadata doc — not needed for dropdowns)
  │
  ├── ts-expirations/{DATE}          ← one doc per expiration date
  │     { date, strikes: number[], types: string[], contractIds: string[] }
  │
  └── ts-strikes/{STRIKE}            ← one doc per strike price
        { strike, expirations: string[], types: string[], contractIds: string[] }
```

### What Each Doc Contains

**Expiration doc** (`ts-expirations/2026-01-15`):
```json
{
  "date": "2026-01-15",
  "strikes": [80, 85, 90, 95, 100, ..., 450, 455],
  "types": ["C", "P"],
  "contractIds": ["QQQ260115C00080000", "QQQ260115P00080000", ...]
}
```

**Strike doc** (`ts-strikes/450`):
```json
{
  "strike": 450,
  "expirations": ["2024-01-19", "2024-02-16", ..., "2026-06-19"],
  "types": ["C", "P"],
  "contractIds": ["QQQ240119C00450000", "QQQ240119P00450000", ...]
}
```

### Why Two Subcollections?

The index is denormalized into two subcollections to support **bidirectional cross-filtering**:

- User picks expiration first → `ts-expirations/{date}.strikes` tells us which strikes are available for that expiration
- User picks strike first → `ts-strikes/{strike}.expirations` tells us which expirations are available for that strike

Without both subcollections, you'd need to scan all docs in one subcollection to answer a query from the other direction.

---

## 3. SA's Implementation (Internal — Direct Firestore Read)

### 3.1 State Shape

SA uses NgRx Signal Store. The state that powers the filter form:

```typescript
interface StorageViewerState {
  // Filter values
  symbol: string;
  expiration: string | null;
  strike: number | null;
  optionType: 'C' | 'P' | null;

  // Index data (loaded from Firestore)
  allExpirations: string[];                    // sorted ascending
  allStrikes: number[];                        // sorted ascending
  expirationToStrikes: Record<string, number[]>; // exp date → available strikes
  strikeToExpirations: Record<number, string[]>; // strike → available expirations

  // Cross-filtered dropdown options (what the UI actually shows)
  filteredExpirations: string[];               // expirations available given current strike
  filteredStrikes: number[];                   // strikes available given current expiration

  // Contract list (left panel)
  contracts: ContractResult[];
  loadingList: boolean;
  loadingIndex: boolean;
  error: string | null;
}
```

### 3.2 Loading the Index (Dropdown Population)

When the user enters a symbol, SA loads **both** subcollections in parallel from Firestore using the client SDK:

```typescript
loadIndex: rxMethod<void>(
  pipe(
    tap(() => patchState(store, { loadingIndex: true, error: null })),
    switchMap(() => {
      const symbol = store.symbol();
      const symbolDocRef = doc(firestore, 'options-file-index', symbol);
      const expCol = collection(symbolDocRef, 'ts-expirations');
      const strikeCol = collection(symbolDocRef, 'ts-strikes');

      return forkJoin({
        expirations: defer(() => getDocs(query(expCol))),
        strikes: defer(() => getDocs(query(strikeCol))),
      }).pipe(
        tap({
          next: ({ expirations, strikes }) => {
            // Build cross-reference maps
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

            patchState(store, {
              allExpirations,
              allStrikes,
              expirationToStrikes: expToStrikes,
              strikeToExpirations: strikeToExps,
              filteredExpirations: allExpirations,  // initially unfiltered
              filteredStrikes: allStrikes,          // initially unfiltered
              loadingIndex: false,
            });
          },
        }),
        catchError((err) => {
          patchState(store, { loadingIndex: false, error: err.message });
          return of(null);
        }),
      );
    }),
  ),
),
```

**Key points:**
- Both subcollections are fetched in a single `forkJoin` — they're independent so they load in parallel
- The result is two cross-reference maps: `expirationToStrikes` and `strikeToExpirations`
- Initially, `filteredExpirations` = all expirations, `filteredStrikes` = all strikes (no filter applied yet)

### 3.3 Cross-Filtering Logic

When the user selects an expiration, the strike dropdown narrows to only strikes available for that expiration. And vice versa.

```typescript
setExpiration: (expiration: string | null) => {
  const expToStrikes = store.expirationToStrikes();
  if (expiration && expToStrikes[expiration]) {
    patchState(store, {
      expiration,
      filteredStrikes: [...expToStrikes[expiration]].sort((a, b) => a - b),
    });
  } else {
    // "All" selected — reset strikes to full list
    patchState(store, {
      expiration,
      filteredStrikes: [...store.allStrikes()],
    });
  }
},

setStrike: (strike: number | null) => {
  const strikeToExps = store.strikeToExpirations();
  if (strike !== null && strikeToExps[strike]) {
    patchState(store, {
      strike,
      filteredExpirations: [...strikeToExps[strike]].sort(),
    });
  } else {
    patchState(store, {
      strike,
      filteredExpirations: [...store.allExpirations()],
    });
  }
},
```

**How it works:**
1. User selects expiration "2026-01-15" → look up `expirationToStrikes["2026-01-15"]` → get `[80, 85, 90, ..., 455]` → set `filteredStrikes` to that array
2. User then selects strike 450 → look up `strikeToExpirations[450]` → get `["2024-01-19", ..., "2026-06-19"]` → set `filteredExpirations` to that array
3. User clears expiration (selects "All") → reset `filteredStrikes` to `allStrikes`

This is all done in-memory — no additional Firestore calls needed after the initial index load.

### 3.4 Listing Contracts (Left Panel)

When the user clicks "List", SA calls a Firebase Callable Cloud Function that queries the Firestore index server-side and returns matching contracts:

```typescript
list: rxMethod<void>(
  pipe(
    tap(() => patchState(store, { loadingList: true, error: null })),
    switchMap(() => {
      const req: ListTimeSeriesRequest = {
        action: 'list',
        bucket: 'time-series',
        symbol: store.symbol(),
        expiration: store.expiration() ?? undefined,
        strike: store.strike() ?? undefined,
        type: store.optionType() ?? undefined,
      };
      return api.list(req).pipe(
        tap({
          next: (result) => patchState(store, {
            contracts: result.contracts,
            loadingList: false,
          }),
        }),
        catchError((err) => patchState(store, {
          loadingList: false,
          error: err.message,
        })),
      );
    }),
  ),
),
```

The backend (`queryContractsByFilters`) has four query paths depending on which filters are active:

| Filters Provided | Query Path |
|---|---|
| Symbol only | Scan all `ts-expirations` docs, collect all `contractIds` |
| Symbol + expiration | Read single doc `ts-expirations/{date}`, return its `contractIds` |
| Symbol + strike | Read single doc `ts-strikes/{strike}`, return its `contractIds` |
| Symbol + expiration + strike | Read both docs, intersect their `contractIds` sets |

Type filtering (C/P) is applied after the Firestore query by parsing each contract ID and filtering — it's a pure function, not a Firestore filter.

### 3.5 The Component Layer

The component wires FormControls to store methods:

```typescript
// Symbol input — debounced 500ms
symbolCtrl = new FormControl('QQQ', { nonNullable: true });

ngOnInit(): void {
  this.symbolCtrl.valueChanges.pipe(
    debounceTime(500),
    distinctUntilChanged(),
    takeUntilDestroyed(this.destroyRef),
  ).subscribe((value) => {
    const trimmed = value.toUpperCase().trim();
    if (trimmed) {
      this.store.setSymbol(trimmed);
      this.store.loadIndex();  // triggers Firestore index load
    }
  });
}

// Expiration dropdown — direct binding
onExpirationSelected(value: string | null): void {
  this.store.setExpiration(value ?? null);
}

// Strike autocomplete — toSignal bridges FormControl to signal
strikeCtrl = new FormControl<string>('', { nonNullable: true });
strikeInput = toSignal(this.strikeCtrl.valueChanges, { initialValue: '' });

filteredStrikes = computed<string[]>(() => {
  const input = this.strikeInput()?.toLowerCase() ?? '';
  const strikes = this.store.filteredStrikes();
  if (!input) return strikes.map((s) => String(s));
  return strikes.filter((s) => String(s).includes(input)).map((s) => String(s));
});

// Type toggle
onOptionTypeChange(value: 'C' | 'P' | null): void {
  this.store.setOptionType(value);
}

// List button
onList(): void {
  this.store.list();
}
```

### 3.6 The Template

```html
<!-- Symbol -->
<mat-form-field appearance="outline">
  <mat-label>Symbol</mat-label>
  <input matInput [formControl]="symbolCtrl" placeholder="e.g. QQQ" uppercase />
</mat-form-field>

<!-- Expiration dropdown -->
<mat-form-field appearance="outline">
  <mat-label>Expiration</mat-label>
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
</mat-form-field>

<!-- Strike autocomplete -->
<mat-form-field appearance="outline">
  <mat-label>Strike</mat-label>
  <input
    matInput type="text" [formControl]="strikeCtrl"
    [matAutocomplete]="strikeAuto"
    [disabled]="store.filtersDisabled()"
    placeholder="Search strike"
  />
  <mat-autocomplete #strikeAuto="matAutocomplete"
    (optionSelected)="onStrikeSelected($event.option.value)">
    <mat-option [value]="">All</mat-option>
    @for (strike of filteredStrikes(); track strike) {
      <mat-option [value]="strike">{{ strike }}</mat-option>
    }
  </mat-autocomplete>
</mat-form-field>

<!-- Type toggle -->
<mat-form-field appearance="outline">
  <mat-label>Type</mat-label>
  <mat-select
    [value]="store.optionType()"
    (selectionChange)="onOptionTypeChange($event.value ?? null)"
    [disabled]="store.filtersDisabled()"
  >
    <mat-option [value]="null">All</mat-option>
    <mat-option value="C">Call</mat-option>
    <mat-option value="P">Put</mat-option>
  </mat-select>
</mat-form-field>

<!-- List button -->
<button mat-flat-button color="primary" (click)="onList()"
  [disabled]="!store.symbol() || store.loadingList()">
  List
</button>
```

---

## 4. RS's Implementation (External — HTTP Endpoint)

### 4.1 Key Differences from SA

| Concern | SA (Internal) | RS (External) |
|---|---|---|
| **Dropdown data source** | Direct Firestore client SDK read of `ts-expirations` and `ts-strikes` subcollections | HTTP call to `partnerListContractsV2` endpoint |
| **Auth** | Firebase Auth with `admin` custom claim | Service account OIDC ID token + audience |
| **Index load** | One parallel fetch of both subcollections | No direct index access — RS must derive expirations and strikes from contract list responses |
| **Contract list** | Firebase Callable Function (`storageFileViewer`) | HTTP GET to `partnerListContractsV2` |
| **Response envelope** | `{ bucket, symbol, contracts, count }` | `{ ok, symbol, contracts, count }` |
| **Filter constraint** | None — can list with symbol only | **At least one of `expiration` or `strike` must be provided** (in addition to `symbol`) |
| **Allowed symbols** | Any | `QQQ` and `TQQQ` only |
| **Contract data** | Raw JSONL file content from GCS | Time series via `partnerHistoricalOptionsContractV2` (separate endpoint) |

### 4.2 The Partner Endpoint

**`partnerListContractsV2`**

```
Method: GET
URL:   https://us-central1-alpha-vantage-proxy-api.cloudfunctions.net/partnerListContractsV2
Auth:  Authorization: Bearer <Google OIDC ID token>
```

**Query parameters:**

| Parameter | Required | Description |
|---|---|---|
| `symbol` | Yes | `QQQ` or `TQQQ` |
| `expiration` | No* | `YYYY-MM-DD` format |
| `strike` | No* | Numeric (e.g., `450`) |
| `type` | No | `C` or `P` |

\* At least one of `expiration` or `strike` must be provided.

**Response:**

```json
{
  "ok": true,
  "symbol": "QQQ",
  "contracts": [
    {
      "contractId": "QQQ260619C00450000",
      "expiration": "2026-06-19",
      "strike": 450,
      "type": "call"
    }
  ],
  "count": 1
}
```

### 4.3 RS Dropdown Population Strategy

Since RS cannot read the Firestore index directly, RS must derive the expiration and strike lists from `partnerListContractsV2` responses. Here is the recommended approach:

#### Step 1: Get all expirations

Call `partnerListContractsV2` with `{ symbol, strike: <any valid strike> }` — but RS doesn't know valid strikes yet. This is a chicken-and-egg problem.

**Recommended solution:** RS should request Savant to add a lightweight "list expirations" and "list strikes" capability to the partner endpoint (or a new endpoint) that returns just the dropdown data without requiring a strike or expiration filter. This would mirror what SA gets from reading the Firestore subcollections directly.

**Workaround until then:** RS can call `partnerListContractsV2` with a known strike (e.g., a round number like 100 for QQQ) to get a batch of contracts, then extract unique expirations from the response. However, this only returns expirations that have contracts at that specific strike — it will miss expirations that don't have a contract at strike 100.

Alternatively, RS can call `partnerHistoricalOptionsV2` (the on-demand chain endpoint) for a symbol and extract all expirations and strikes from the full chain response. This is a heavier call but returns the complete universe.

#### Step 2: Get strikes for a selected expiration

Once the user selects an expiration, call:

```
GET partnerListContractsV2?symbol=QQQ&expiration=2026-01-15
```

This returns all contracts for that expiration. Extract unique strikes from the `contracts` array:

```typescript
const strikes = [...new Set(response.contracts.map(c => c.strike))].sort((a, b) => a - b);
```

#### Step 3: Get expirations for a selected strike

Once the user selects a strike, call:

```
GET partnerListContractsV2?symbol=QQQ&strike=450
```

Extract unique expirations:

```typescript
const expirations = [...new Set(response.contracts.map(c => c.expiration))].sort();
```

#### Step 4: Cross-filtering

RS can implement the same in-memory cross-filtering as SA, but instead of reading from pre-loaded Firestore maps, RS makes an HTTP call each time a filter changes:

```
User selects expiration → call partnerListContractsV2(symbol, expiration)
  → extract strikes from response → populate strike dropdown

User selects strike → call partnerListContractsV2(symbol, null, strike)
  → extract expirations from response → populate expiration dropdown
```

**Performance note:** Each filter change triggers an HTTP call. SA avoids this by pre-loading the entire index. RS should cache responses to avoid redundant calls for the same symbol+filter combination.

### 4.4 RS Contract List (Left Panel)

When the user clicks "List" (or when filters change, depending on RS UX choice), call:

```
GET partnerListContractsV2?symbol=QQQ&expiration=2026-01-15&strike=450&type=C
```

The response `contracts` array contains `ContractResult` objects:

```typescript
interface ContractResult {
  contractId: string;      // e.g., "QQQ260619C00450000"
  expiration: string;      // e.g., "2026-06-19"
  strike: number;          // e.g., 450
  type: 'call' | 'put';
}
```

Display these in the left panel. When the user selects a contract, RS calls `partnerHistoricalOptionsContractV2` with the `contractId` to fetch the time series data for charting.

### 4.5 RS Auth Flow

```typescript
import { GoogleAuth } from 'google-auth-library';

const audience = 'https://us-central1-alpha-vantage-proxy-api.cloudfunctions.net/partnerListContractsV2';
const auth = new GoogleAuth({ scopes: 'https://www.googleapis.com/auth/cloud-platform' });
const client = await auth.getIdTokenClient(audience);

// Build URL with query params
const url = new URL(audience);
url.searchParams.set('symbol', 'QQQ');
url.searchParams.set('expiration', '2026-01-15');

const response = await client.request({ url: url.toString(), method: 'GET' });
const payload = response.data; // { ok, symbol, contracts, count }
```

**Important:** The OIDC token audience must match the endpoint URL. If RS uses a different configured audience, Savant must add it to the shared allowed-audience list.

---

## 5. OCC Contract ID Format

Both SA and RS encounter OCC-format contract IDs. Understanding the format is essential for parsing.

**Format:** `{SYMBOL}{YYMMDD}{C|P}{STRIKE_8_DIGIT}`

Where:
- `SYMBOL` — underlying ticker, padded to 6 chars in some formats (SA uses unpadded)
- `YYMMDD` — expiration date (2-digit year)
- `C` or `P` — call or put
- `STRIKE_8_DIGIT` — strike price × 1000, zero-padded to 8 digits

**Example:** `QQQ260619C00450000`
- Symbol: `QQQ`
- Expiration: `2026-06-19`
- Type: Call
- Strike: `00450000` / 1000 = `450.000` → $450

**Parsing code** (from `contract-metadata.utils.ts`):

```typescript
function parseContractIDMetadata(symbol: string, contractID: string) {
  const sym = symbol.toUpperCase();
  const id = contractID.toUpperCase();
  if (!id.startsWith(sym)) return null;

  const suffix = id.slice(sym.length);
  if (suffix.length < 6 + 1 + 8) return null;

  const datePart = suffix.slice(0, 6);      // YYMMDD
  const typeCode = suffix.slice(6, 7);       // C or P
  const strikePart = suffix.slice(7, 15);    // 8-digit strike × 1000

  const expiration = `20${datePart.slice(0, 2)}-${datePart.slice(2, 4)}-${datePart.slice(4, 6)}`;
  const type = typeCode === 'C' ? 'call' : typeCode === 'P' ? 'put' : null;
  const strike = Number(strikePart) / 1000;

  return { expiration, type, strike: strike.toString() };
}
```

RS does not need to parse contract IDs — the `partnerListContractsV2` response already includes parsed `expiration`, `strike`, and `type` fields. But understanding the format helps with debugging.

---

## 6. Implementation Checklist for RS

### 6.1 Backend (RS → Savant API)

- [ ] Implement an HTTP client that mints OIDC tokens and calls `partnerListContractsV2`
- [ ] Handle the `{ ok, symbol, contracts, count }` response envelope
- [ ] Handle error responses (`ok: false`, `error`, `code`)
- [ ] Implement response caching keyed by `symbol + expiration + strike + type` to avoid redundant calls
- [ ] Implement retry with bounded exponential backoff for `429`, `502`, `504`

### 6.2 Frontend (RS UI)

- [ ] **Symbol input** — text field, uppercased, debounced (500ms recommended)
- [ ] **Expiration dropdown** — populated from contract list responses; shows date + day of week
- [ ] **Strike dropdown** — populated from contract list responses; autocomplete or filterable
- [ ] **Type toggle** — Call / Put / All
- [ ] **Cross-filtering** — when expiration changes, repopulate strikes; when strike changes, repopulate expirations
- [ ] **Contract list panel** — displays `contractId`, `expiration`, `strike`, `type` for each result
- [ ] **Loading states** — show spinner during API calls
- [ ] **Error states** — surface API errors to the user
- [ ] **Contract selection** — on click, call `partnerHistoricalOptionsContractV2` with the `contractId` to fetch time series data for charting

### 6.3 Dropdown Population — Recommended Approach

Since `partnerListContractsV2` requires at least one of `expiration` or `strike`, RS has two options:

**Option A (Recommended): Request Savant add a "list expirations/strikes" endpoint**

A lightweight endpoint that returns just the dropdown data:
```
GET partnerListOptionsIndex?symbol=QQQ
→ { expirations: [...], strikes: [...] }
```

This would let RS populate both dropdowns on symbol selection, exactly like SA does with Firestore. RS would then cross-filter in-memory using the full lists.

**Option B (Workaround): Bootstrap with a known strike**

1. On symbol selection, call `partnerListContractsV2?symbol=QQQ&strike=100` (or another common strike)
2. Extract all unique expirations from the response → populate expiration dropdown
3. When user selects an expiration, call `partnerListContractsV2?symbol=QQQ&expiration={date}` → extract strikes → populate strike dropdown
4. When user selects a strike, call `partnerListContractsV2?symbol=QQQ&strike={strike}` → extract expirations → update expiration dropdown

**Limitation of Option B:** Step 1 only returns expirations that have a contract at the bootstrap strike. Some expirations may be missing from the dropdown. The further the user drills down, the more accurate the cross-filtering becomes.

---

## 7. Key Patterns to Replicate

### Debounced Symbol Input

The symbol field should debounce input to avoid triggering API calls on every keystroke:

```typescript
symbolCtrl.valueChanges.pipe(
  debounceTime(500),
  distinctUntilChanged(),
).subscribe((value) => {
  const trimmed = value.toUpperCase().trim();
  if (trimmed) {
    // trigger index/dropdown load
  }
});
```

### Signal-Based Autocomplete (if using Angular)

SA bridges `FormControl.valueChanges` to a signal using `toSignal`, then filters with `computed`:

```typescript
strikeInput = toSignal(this.strikeCtrl.valueChanges, { initialValue: '' });

filteredStrikes = computed(() => {
  const input = this.strikeInput()?.toLowerCase() ?? '';
  const strikes = this.store.filteredStrikes();
  if (!input) return strikes.map(String);
  return strikes.filter((s) => String(s).includes(input)).map(String);
});
```

### Error Snackbar

SA watches the store's `error` signal with an `effect()`:

```typescript
constructor() {
  effect(() => {
    const error = this.store.error();
    if (error) {
      this.snackBar.open(error, 'Dismiss', { duration: 5000 });
    }
  });
}
```

### Clearing State on Symbol/Bucket Change

When the symbol changes, all filter state and results must be cleared:

```typescript
setSymbol: (symbol: string) => {
  patchState(store, {
    symbol: symbol.toUpperCase().trim(),
    expiration: null,
    strike: null,
    optionType: null,
    contracts: [],
    allExpirations: [],
    allStrikes: [],
    // ... reset everything
  });
},
```

---

## 8. File Reference (SA Source Code)

For RS engineers who want to read the actual SA implementation:

| File | Purpose |
|---|---|
| `shared/options/contract-types.ts` | Shared types: `ContractResult`, `ExpirationIndexDoc`, `StrikeIndexDoc`, request/response types |
| `src/app/feat/storage-file-viewer/store/storage-viewer.store.ts` | NgRx Signal Store — state, cross-filtering, index loading, list/read methods |
| `src/app/feat/storage-file-viewer/common/storage-viewer-api.ts` | API service wrapping Firebase Callable Function |
| `src/app/feat/storage-file-viewer/comps/storage-viewer/storage-viewer.component.ts` | Component — FormControls, autocomplete, event handlers |
| `src/app/feat/storage-file-viewer/comps/storage-viewer/storage-viewer.component.html` | Template — filter form, list panel, content panel |
| `functions/src/v2/historical-options-corpus/handlers/storage-file-viewer.http.ts` | Cloud Function handler (admin auth, dispatches to service) |
| `functions/src/v2/historical-options-corpus/services/storage-file-viewer.service.ts` | Backend service — Firestore queries, GCS reads |
| `functions/src/v2/historical-options-corpus/services/options-index-query.service.ts` | Shared query function — 4-path filter logic used by both admin and partner endpoints |
| `functions/src/v2/partner/list-contracts-partner.ts` | Partner endpoint — OIDC auth, query param parsing, calls shared query function |
| `functions/src/v2/historical-options-corpus/services/contract-metadata.utils.ts` | OCC contract ID parser |
| `shared/options/contract-length.utils.ts` | Date utilities: `dayOfWeek`, `formatDateWithDow`, `calendarDaysBetween`, `classifyContractLength` |

---

## 9. Questions for Savant

If RS needs any of the following, contact Savant:

1. **Lightweight index endpoint** — Can Savant add a `partnerListOptionsIndex` endpoint that returns just expirations and strikes for a symbol (no contract list)? This would eliminate the chicken-and-egg problem in Section 4.3.
2. **Additional symbols** — Currently limited to QQQ and TQQQ. Can RS request more?
3. **Audience configuration** — If RS needs a different OIDC audience than the endpoint URL, Savant must add it to the allowed-audience list.
4. **Rate limits** — What are the per-endpoint rate limits for `partnerListContractsV2`? RS needs this to design its caching strategy.
