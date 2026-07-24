# Code Review: Storage File Viewer & Options Index Rebuild

**Date:** 2026-07-24  
**Fixed point:** `HEAD` (bac0a2f)  
**Diff scope:** All uncommitted changes (modified + untracked files)  
**Reviewers:** Thermo-nuclear + Standards/Spec (parallel)

---

## Changed Files Inventory

### Modified
| File | Lines Changed | Concern |
|------|--------------|---------|
| `.gitignore` | +1 | Ignore `.devin/skills` |
| `docs/partner/partner-discovery.md` | +44 | Upcoming partner endpoint docs |
| `functions/src/firebase-admin-init.ts` | +3 | `FIREBASE_SERVICE_ACCOUNT_ID` env support |
| `functions/src/index.ts` | +2 | Export 2 new functions |
| `functions/src/v2/common/constants.ts` | +3 | `OPTIONS_INDEX_WRITE` enum entry |
| `functions/src/v2/historical-options-corpus/services/contract-metadata.utils.ts` | 1 | Export `parseContractIDMetadata` |
| `functions/src/v2/historical-options-corpus/services/index.ts` | +1 | Barrel export |
| `functions/src/v2/historical-options-corpus/services/time-series-builder.service.ts` | +12 | Wire `OptionsIndexWriter` into flush |

### New (untracked)
| File | Lines | Concern |
|------|-------|---------|
| `docs/operations/storage-file-viewer-design.md` | ~430 | Design doc |
| `docs/operations/storage-file-viewer-index.md` | ~108 | ADR |
| `functions/scripts/ops/rebuild-options-index.ts` | 142 | Rebuild script |
| `functions/src/v2/historical-options-corpus/handlers/options-index-write.task.ts` | 37 | Cloud Task handler |
| `functions/src/v2/historical-options-corpus/handlers/storage-file-viewer.http.ts` | 323 | Admin onCall function |
| `functions/src/v2/historical-options-corpus/services/options-index.writer.ts` | 411 | Firestore index writer service |

---

## Thermo-Nuclear Review

### TN-1: Dead code — `rebuildIndex` and `deleteExistingIndex` are unused (BLOCKER)

**File:** `options-index.writer.ts:102-181`, `383-409`  
**Severity:** Structural regression  

`rebuildIndex()` (80 lines) and `deleteExistingIndex()` (27 lines) were superseded by `prepareRebuildPayloads()` + `processWritePayload()` via Cloud Tasks. They are never called by any code in the diff. This is 107 lines of dead code that:
- Keeps the file at 411 lines (over the 400-line project limit)
- Contains the old batch-write pattern that caused the transaction size errors we migrated away from
- Will confuse future maintainers about which path is canonical

**Remedy:** Delete `rebuildIndex()`, `deleteExistingIndex()`. File drops to ~290 lines.

### TN-2: Duplicated contract parsing — `parseContractId` vs `parseContractIDMetadata` (BLOCKER)

**File:** `storage-file-viewer.http.ts:286-311`  
**Severity:** Architecture-boundary leak, canonical-helper duplication  

The handler re-implements OCC ticker parsing that already exists in `contract-metadata.utils.ts:parseContractIDMetadata()`. This same diff exports that function. The handler should use it. The duplicate also returns `type: 'call'/'put'` (lowercase) while the canonical version returns `type: 'call'/'put'` — same values but via independent code paths that can drift.

**Remedy:** Delete `parseContractId()` from the handler. Import `parseContractIDMetadata` and map to `ContractResult` inline, or better: add a `parseContractResult()` to `contract-metadata.utils.ts` that returns the full `ContractResult` shape and use it in both the handler and the writer.

### TN-3: Handler file contains business logic instead of just dispatch (BLOCKER)

**File:** `storage-file-viewer.http.ts` — 323 lines  
**Severity:** Wrong-layer, modularity violation  

The handler contains 4 business-logic functions (`handleListTimeSeries`, `handleListCorpus`, `handleReadTimeSeries`, `handleReadCorpus`) plus 2 utility functions (`parseContractId`, `filterContractsByType`). Per project rules, a handler file must own exactly one concern (HTTP dispatch). The list/read logic is service-layer business logic.

**Remedy:** Extract to `storage-file-viewer.service.ts`. Handler keeps: auth check, request validation, dispatch to service. Service handles Firestore queries, GCS reads, contract filtering.

### TN-4: `options-index.writer.ts` has two concerns in one class (JUDGEMENT CALL)

**File:** `options-index.writer.ts`  
**Severity:** Modularity  

The `OptionsIndexWriter` class has two distinct concerns:
1. **Incremental index maintenance** — `upsertContract()`, `buildExpirationDoc()`, `buildStrikeDoc()` (used by time-series builder on every file write)
2. **Bulk rebuild pipeline** — `prepareRebuildPayloads()`, `processWritePayload()` (used by rebuild script + Cloud Task handler)

These share the `buildExpirationDoc`/`buildStrikeDoc` helpers but have different callers, different lifecycles, and different reasons to change. After deleting the dead code (TN-1), the file is ~290 lines so this isn't urgent, but if the rebuild logic grows, split into `options-index-rebuild.writer.ts`.

### TN-5: `processWritePayload` delete phase is a no-op (JUDGEMENT CALL)

**File:** `options-index.writer.ts:191-199`  

The `delete` phase payload always has `docIds: []` (line 266 in `prepareRebuildPayloads`). The handler processes it but does nothing. This is a no-op task that enqueues, dispatches, and executes for zero effect.

**Remedy:** Either remove the delete phase entirely (since the user manually deletes the collection before rebuild), or implement actual deletion logic if needed for non-manual rebuilds.

### TN-6: `upsertContract` does read-then-write instead of atomic arrayUnion (JUDGEMENT CALL)

**File:** `options-index.writer.ts:313-367`  

`upsertContract` reads the doc, checks if `contractId` is in the array, then writes. This is a read-then-write race condition if two flushes happen concurrently for the same expiration/strike. Since `FieldValue.arrayUnion` is idempotent, the read check is unnecessary — `arrayUnion` already deduplicates.

The `types` field has the same pattern: read to check if type exists, then conditionally `arrayUnion`. Since `arrayUnion` on an already-present value is a no-op, the read check adds latency and a race window for nothing.

**Remedy:** Remove the read checks. Always `arrayUnion` the contractId, strike, expiration, and type. `arrayUnion` handles deduplication natively.

### TN-7: Sequential individual `set()` calls in `processWritePayload` (JUDGEMENT CALL)

**File:** `options-index.writer.ts:202-216`  

Each doc is written with an individual `await col.doc().set()` call, serialized. For 5 docs per task this is fine, but if chunk size ever increases, this becomes a bottleneck. Could use `Promise.all()` for parallel writes or `db.batch()` for atomic writes (5 docs is well under the 500-op batch limit).

**Remedy:** Use `Promise.all()` for the 5 parallel writes. Simple, no behavior change, 5x faster per task.

---

## Standards & Spec Review

### Standards Findings

#### S-1: File exceeds 400-line limit (HARD VIOLATION)

**Rule:** `MEMORY[project-rules.md]` → "Pre-Implementation File Size Check: If the file is already over 400 lines, stop."  
**File:** `options-index.writer.ts` — 411 lines  
**Finding:** Same as TN-1. Dead code pushes file over limit.  
**Remedy:** Delete dead code.

#### S-2: Handler file contains logic beyond its concern (HARD VIOLATION)

**Rule:** `MEMORY[project-rules.md]` → "Every Cloud Functions `.ts` file must own exactly one concern."  
**File:** `storage-file-viewer.http.ts` — 323 lines with 4 handler functions + 2 utilities  
**Finding:** Same as TN-3.  
**Remedy:** Extract to service.

#### S-3: Duplicated code — contract parsing re-implemented (HARD VIOLATION)

**Rule:** `MEMORY[project-rules.md]` → "Duplicated Code" smell + "reuse existing canonical helpers"  
**File:** `storage-file-viewer.http.ts:286-311`  
**Finding:** Same as TN-2.  
**Remedy:** Use `parseContractIDMetadata`.

#### S-4: JSDoc references wrong collection name (HARD VIOLATION)

**Rule:** `MEMORY[project-rules.md]` → "Write JSDoc comments for all classes and functions."  
**File:** `options-index.writer.ts:81` — says `options_file_index`, actual is `options-file-index`  
**Also:** `rebuild-options-index.ts:5` — same issue  
**Remedy:** Fix to `options-file-index`.

#### S-5: No barrel export for handlers directory (JUDGEMENT CALL)

**Rule:** `MEMORY[project-rules.md]` → "Every handlers/ subdirectory that contains more than 2 files must have an index.ts barrel."  
**Finding:** `handlers/` directory now has 4+ files but no `index.ts` barrel. Consumers import from `index.ts` at the `src/` level which re-exports individually.  
**Remedy:** Add `handlers/index.ts` barrel. Low priority since `src/index.ts` already handles exports.

#### S-6: `partner-discovery.md` references old collection names (JUDGEMENT CALL)

**File:** `docs/partner/partner-discovery.md:434` — says `options_file_index/{SYMBOL}/ts_expirations` and `ts_strikes`  
**Finding:** Should be `options-file-index/{SYMBOL}/ts-expirations` and `ts-strikes` (dashes).  
**Remedy:** Update doc.

### Spec Findings

**Spec source:** `docs/operations/storage-file-viewer-design.md`

#### SP-1: Design doc specifies `onCall` with Firebase Auth — implemented correctly ✓

The spec says "Admin Cloud Function (Firebase Auth, admin role)". Handler checks `request.auth` and `request.auth.token.admin`. ✓

#### SP-2: Design doc specifies dual index paths — implemented correctly ✓

`ts-expirations` and `ts-strikes` subcollections match spec. Collection names use dashes per spec. ✓

#### SP-3: Design doc specifies Cloud Tasks rebuild — implemented correctly ✓

Spec says "enqueue tasks to Cloud Tasks queue". Script uses `getFunctions().taskQueue().enqueue()`. Handler uses `onTaskDispatched`. ✓

#### SP-4: Design doc specifies 4 list/read actions — implemented correctly ✓

`list + time-series`, `list + corpus`, `read + time-series`, `read + corpus` — all 4 implemented. ✓

#### SP-5: `partnerListContractsV2` endpoint documented but not implemented (SCOPE CORRECT)

Design doc Phase 3 mentions partner endpoint. `partner-discovery.md` marks it as "Not yet implemented." This is correct — it's future work, not in scope for this diff.

#### SP-6: Rebuild script `runId` not in original spec (SCOPE CREEP — JUSTIFIED)

`rebuildRunId` was added during implementation for run traceability. Not in the original design doc but justified — enables verification of which docs came from which rebuild run. Design doc has been updated to mention it.

---

## Summary

| Axis | Findings | Worst Issue |
|------|----------|-------------|
| Thermo-nuclear | 7 (3 blockers, 4 judgement calls) | TN-1: 107 lines dead code keeping file over 400-line limit |
| Standards | 6 (4 hard, 2 judgement calls) | S-1/S-2/S-3: file size, wrong-layer logic, duplicated parsing |
| Spec | 6 (all pass or justified) | No spec violations |

### Consolidated Remediation Plan

1. **Delete dead code** — Remove `rebuildIndex()` and `deleteExistingIndex()` from `options-index.writer.ts` (TN-1, S-1)
2. **Extract service** — Move list/read logic from `storage-file-viewer.http.ts` into `storage-file-viewer.service.ts` (TN-3, S-2)
3. **Deduplicate parsing** — Delete `parseContractId()` from handler, use `parseContractIDMetadata()` from utils (TN-2, S-3)
4. **Fix JSDoc/comments** — Update `options_file_index` → `options-file-index` in JSDoc and script header (S-4)
5. **Fix partner doc** — Update collection names in `partner-discovery.md` (S-6)
6. **Remove no-op delete phase** — Drop the empty delete payload from `prepareRebuildPayloads` (TN-5)
7. **Simplify `upsertContract`** — Remove read checks, use `arrayUnion` directly (TN-6)
8. **Parallelize writes** — Use `Promise.all()` for 5-doc writes in `processWritePayload` (TN-7)

Items 1-4 are blockers. Items 5-8 are recommended but not blocking.
