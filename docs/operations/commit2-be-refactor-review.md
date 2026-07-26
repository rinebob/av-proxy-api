# Code Review: Commit 2 — BE-REFACTOR-STORAGE-VIEWER

**Review date:** 2026-07-24
**Commit message:** `BE-REFACTOR-STORAGE-VIEWER: extract shared types and fix contract parsing`
**Design doc ref:** `docs/operations/storage-file-viewer-design.md` Phase 1–2; `docs/operations/storage-file-viewer-code-review.md` findings

---

## Files in commit

| File | Status | Summary |
|---|---|---|
| `shared/options/contract-types.ts` | New | Shared `ContractResult`, `BucketName`, request/response types |
| `shared/options/index.ts` | New | Barrel export for `shared/options` |
| `functions/src/v2/historical-options-corpus/services/contract-result.utils.ts` | New | Shared `parseContractResult` + `filterContractsByType` |
| `functions/src/v2/historical-options-corpus/services/index.ts` | Modified | Added barrel export for `contract-result.utils` |
| `functions/src/v2/historical-options-corpus/services/storage-file-viewer.service.ts` | Modified | Removed inline types/parsing, import shared utils, fix null-handling + Path 4 |
| `functions/src/v2/historical-options-corpus/handlers/storage-file-viewer.http.ts` | Modified | Import shared types, add symbol validation |

---

## Standards

### Hard Violations

1. **Missing validation for `contractId` and `date` on read actions** — `storage-file-viewer.http.ts:48-55` passes `data.contractId` and `data.date` directly to the service without checking presence. If a caller sends `{ action: 'read', bucket: 'time-series', symbol: 'QQQ' }` without `contractId`, the service at `storage-file-viewer.service.ts:137` calls `contractId.toUpperCase()` on `undefined` → `TypeError` crash. Same for `date` in `readCorpus`. The handler validates `symbol` (line 32-34) but not the action-specific required fields.

2. **Duplicated index doc interfaces in frontend store** — `ExpirationIndexDoc` and `StrikeIndexDoc` are defined in both `options-index.writer.ts:15-27` (backend) and `storage-viewer.store.ts:25-37` (frontend). The `shared/options/contract-types.ts` file was created to centralize types but omits these two interfaces. They should be added to shared types so both frontend and backend import from one place.

3. **Duplicated Firestore collection constants** — `OPTIONS_FILE_INDEX_COLLECTION`, `TS_EXPIRATIONS_SUBCOLLECTION`, `TS_STRIKES_SUBCOLLECTION` are defined in both `options-index.writer.ts:7-13` (backend) and `storage-viewer.store.ts:21-23` (frontend). These should live in `shared/options/contract-types.ts` and be imported by both.

### Judgement Calls

4. **Trailing blank line** — `storage-file-viewer.service.ts:180` has an extra blank line at end of file. Minor.

5. **`storage-file-viewer.service.ts` naming** — Named `.service.ts` which is correct per project rules (it performs Firestore/GCS I/O, not just pure computation). ✓

---

## Spec

1. **Strike division bug is fixed** — `contract-result.utils.ts:22` returns `strike: strikeNumeric` (no division). `parseContractIDMetadata` at `contract-metadata.utils.ts:39` already divides by 1000 and returns a string. The old code divided again. This is now correct. ✓

2. **Path 4 uses `filterContractsByType`** — `storage-file-viewer.service.ts:92` calls `filterContractsByType(allIds, upperSymbol, type)` instead of the old inline `id.includes()` string matching. ✓

3. **Null-handling for `strike`** — All four paths now check `strike === undefined || strike === null`. ✓

4. **Shared types extraction** — `ContractResult`, `BucketName`, and all request/response types are in `shared/options/contract-types.ts`. Both backend and frontend import from `@shared/options`. ✓

5. **Symbol validation added to handler** — `storage-file-viewer.http.ts:32-34`. ✓ (But incomplete — see Standards #1)

---

## Thermo-Nuclear

1. **`parseContractResult` is now a single shared function** — Eliminates the possibility of strike divergence between admin and partner endpoints. This was the highest-priority remediation item from the code review. ✓

2. **`filterContractsByType` is now a single shared function** — Both endpoints import from `contract-result.utils.ts`. Consistent type comparison logic (`parsed.type !== expectedType` where `expectedType = type === 'C' ? 'call' : 'put'`). ✓

3. **Dependency direction is clean** — `contract-result.utils.ts` → imports `contract-metadata.utils` (utils → utils). `storage-file-viewer.service.ts` → imports `contract-result.utils` (service → utils). `storage-file-viewer.http.ts` → imports `storage-file-viewer.service.ts` (handler → service). No circular dependencies. ✓

4. **Barrel export added** — `services/index.ts:2` re-exports `contract-result.utils`. No logic in barrel. ✓

---

## Verdict: Approve with findings

The core refactoring is correct and addresses all high-priority code review findings. The missing `contractId`/`date` validation (Standards #1) is a real runtime crash risk but low-probability for an admin-only endpoint. The duplicated types/constants (Standards #2-3) are a standards issue but don't cause bugs.

### Recommended follow-ups (not blocking)
- Add `contractId` / `date` presence validation to the handler
- Move `ExpirationIndexDoc`, `StrikeIndexDoc`, and collection constants to `shared/options/contract-types.ts`
