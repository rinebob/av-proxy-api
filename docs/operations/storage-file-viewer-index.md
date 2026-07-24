# ADR 0002: Firestore Index for GCS Time-Series Contract Discovery

**Date:** 2026-07-23  
**Status:** Accepted  

---

## Context

Two consumers need to discover which option contracts exist in the time-series GCS bucket:

1. **Internal admin file viewer** — an Angular UI that lets the admin browse and inspect file contents by symbol, expiration, strike, and type
2. **External partner applications** — client apps that need to know which contract IDs are available before requesting time series data through the existing `partnerHistoricalOptionsContract` endpoint

The bucket contains 500k+ files per symbol, organized as `time-series/v1/{SYMBOL}/{CONTRACT_ID}.jsonl` where `{CONTRACT_ID}` is an OCC option ticker (e.g., `QQQ260619C00450000`).

GCS natively supports only **prefix matching** on object names. This means:

- Listing by symbol (`time-series/v1/QQQ/`) returns all 500k+ files — too many for interactive UI use or API response
- Listing by symbol + expiration (`time-series/v1/QQQ/QQQ260619`) narrows to a few hundred files — acceptable but requires the consumer to already know the expiration date
- Strike price is embedded in the middle of the OCC ticker (zero-padded to 8 digits, e.g., `00450000`), so it cannot be used as a GCS prefix

Both consumers need to:
1. Discover available expiration dates for a symbol
2. Discover available strike prices for a symbol
3. Support two search paths: symbol → expiration → strike, and symbol → strike → expiration
4. Receive results in real time (UI) or with low latency (API)

---

## Decision

Create a **Firestore index** with two query paths that mirror the two search flows:

```
options-file-index/{SYMBOL}/ts-expirations/{DATE}     ← { strikes, types, contractIds }
options-file-index/{SYMBOL}/ts-strikes/{STRIKE}       ← { expirations, types, contractIds }
```

**Naming convention:** All Firestore collection names use dashes, not underscores.

The index is maintained by the time-series builder on every file write. A manual rebuild script can regenerate it from GCS filenames at any time — the script enqueues Cloud Tasks (`processOptionsIndexWriteTask`) that write docs individually, avoiding Firestore batch transaction size limits that arise with 370k+ contracts.

GCS remains the source of truth. The Firestore index is a derived cache — if it is stale or missing, the actual GCS files are unaffected.

The index is consumed by two separate Cloud Functions with different security boundaries:
- **Admin Cloud Function** (Firebase Auth, admin role) — full access: lists contracts, reads raw file contents from both buckets
- **Partner API endpoint** (service account OIDC + audience) — restricted access: lists contract IDs and metadata only, no raw file content. Clients then use the existing `partnerHistoricalOptionsContract` endpoint to fetch time series data.

Keeping the functions separate prevents any possibility of the partner endpoint exposing raw file content or corpus bucket access.

---

## Alternatives Considered

### Alternative 1: GCS Listing Only (No Index)

List GCS objects on every search and filter server-side.

**Rejected because:**
- Listing 500k+ files takes ~500 API pages and 10-20 seconds — too slow for interactive dropdown population
- Every search request would repeat this expensive listing
- No way to populate the expiration or strike dropdowns without listing all files first

### Alternative 2: Per-Contract Firestore Documents

One Firestore document per contract: `options_file_index/{SYMBOL}/ts_contracts/{CONTRACT_ID}` with fields `{ expiration, strike, type, contractLength }`. Queryable with Firestore `where` clauses.

**Rejected because:**
- Creates 500k+ documents per symbol — user explicitly rejected this
- Firestore collection scan with compound filters would still be slower than reading a single pre-aggregated doc
- Index maintenance writes would be 500k operations instead of ~200 (one per expiration/strike)

### Alternative 3: Single Index Path (Expiration Only)

Index only by expiration. Strike searches would read all expiration docs and filter.

**Rejected because:**
- Symbol + strike search (without expiration) would require reading all ~100-200 expiration docs and filtering each one — slow and wasteful
- The user explicitly wants to search by symbol + strike to see the full range of contract lengths across expirations

---

## Consequences

### Positive

- Dropdown population is a single Firestore doc read — instant
- Both search paths (by expiration, by strike) are equally fast
- Index docs are small (one expiration = ~100-200 strikes; one strike = ~100-200 expirations)
- Total doc count is low (~200 expiration docs + ~200 strike docs per symbol)
- GCS remains the source of truth — index is rebuildable
- Single index serves both internal and external consumers — no duplicate infrastructure
- Partner endpoint can be added with minimal code (read-only Firestore access to the same index)

### Negative

- Two index paths must be maintained on every write — doubles the write operations in the builder
- Index can become stale if the builder fails between the GCS write and the Firestore update
- A rebuild script is required for initial population and recovery
- Rebuild requires Cloud Tasks infrastructure (queue + task handler function) due to Firestore batch transaction size limits with large contract counts

### Mitigations

- The builder updates both index paths in the same operation as the GCS write, minimizing the window for inconsistency
- A rebuild script can regenerate the index from GCS filenames at any time
- A reconciliation script (future work) can detect and report mismatches between GCS and the index
