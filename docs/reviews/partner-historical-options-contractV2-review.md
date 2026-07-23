# `partnerHistoricalOptionsContractV2` — Code Review Report

**Date:** 2026-07-22  
**Head:** `prod` @ `8b9687a`  
**Reviews run:** `.devin/skills/thermo-nuclear-code-review.md` + `.devin/skills/code-review/SKILL.md` (Standards + Spec axes)  

---

## 1. Scope / change inventory

| File | Status | Notes |
|---|---|---|
| `functions/src/v2/partner/historical-options-contract-partner.ts` | new | New partner HTTPS endpoint |
| `functions/src/index.ts` | modified | Adds one export line |
| `functions/src/v2/historical-options-corpus/services/time-series-builder.service.ts` | dirty | Pre-existing `contractID` arg + extra logging |
| `functions/src/v2/historical-options-corpus/handlers/trigger-historical-options-time-series-build.http.ts` | dirty | Pre-existing `contractID` body field + doc update |

The two dirty backfill/builder files were not modified by this endpoint task, but they are in the working tree and would ride along in any commit or deploy if not stashed/committed separately.

---

## 2. Contract matrix

| Concern | Implementation | PRD / `project-rules.md` | Verdict |
|---|---|---|---|
| Method `GET` | `if (req.method !== 'GET')` 405 | PRD §5.1 | OK |
| Dual auth (`ALLOWED_SERVICE_ACCOUNT_EMAILS` / `EXPECTED_GOOGLE_AUDIENCE`) | `authenticateRequestEither` + secrets | PRD §5.1 | OK |
| Required `symbol`, `contractID` | yes | PRD §5.1 | OK |
| Optional `startDate`, `endDate` | yes | PRD §5.1 | OK |
| Symbol trimmed, uppercased, non-empty | yes | PRD §5.2 | OK |
| `contractID` starts with `symbol` | yes | PRD §5.2 | OK |
| Date range valid, `startDate <= endDate` | yes | PRD §5.2 | OK |
| Storage path `time-series/v1/{SYMBOL}/{CONTRACT_ID}.jsonl` | `getTimeSeriesObjectPath` + `GcsTimeSeriesAdapter` | PRD §6.2 | OK |
| Read via `GcsTimeSeriesAdapter.readLines` | yes | request | OK |
| Expand with `parseStorageLine` / `toApiObservation` | yes | request | OK |
| Extract `expiration`/`type`/`strike` from `contractID` or GCS metadata | yes, with fallback | request | OK |
| Success envelope fields | mostly | PRD §5.3 | `startDate`/`endDate` semantics undefined; can be `null` |
| `series` ascending | file order | PRD §5.3 | OK (depends on builder invariant) |
| Inclusive date filtering | yes | PRD §5.3 | OK |
| Empty series returns `ok: true` | yes | PRD §5.3 | OK |
| 10 MiB serialized size guard | yes | PRD §5.3 | OK |
| Partner error envelope | mostly | PRD §5.4 | `withCors` catch can emit `success: false` |
| Unit tests | none | `project-rules.md` §Testing | FAIL |
| Handler exported / dependency-injected | no | Existing `historical-options-partner.ts` precedent | FAIL |

---

## 3. `/code-review` — Standards

### Documented-standard breaches (hard)

1. **No Jest unit tests.** `project-rules.md` §Testing & Reliability: "Create full unit tests for all new features (functions, classes, routes, etc.)" with "at least: 1 test for expected use, 1 edge case, 1 failure case." The new file has none.
2. **Handler is not exported or dependency-injected.** `project-rules.md` §Testing & Reliability and the existing `historical-options-partner.ts` precedent require an exportable handler with injectable dependencies. The new file hard-codes `getStorage()`, `GcsTimeSeriesAdapter`, `authenticateRequestEither`, `randomUUID`, and `Date.now`.
3. **Contract metadata helpers live in the HTTP file.** `project-rules.md` §Single Responsibility Per File and §No Cross-Concern Imports suggest contractID parsing (`parseContractIDMetadata`) and GCS metadata fallback (`readCustomMetadata`) belong in `historical-options-corpus/services` as a shared utils/service module, not in a partner endpoint.
4. **Hard-coded bucket name fallback.** `process.env.OPTIONS_TIME_SERIES_BUCKET ?? 'av-options-time-series-bucket'` hard-codes infrastructure. The builder throws on missing env; the endpoint should fail closed too.
5. **JSDoc missing on `handler`.** `project-rules.md` §Documentation & Explainability expects JSDoc for all functions.

### Baseline smells (judgement calls)

- **Duplicated Code:** `isValidIsoDate` / `parseOptionalDate` duplicate the date validation already in `historical-options-request.utils.ts` (`parseHistoricalOptionsRequest`). A canonical date validator should be reused.
- **Feature Envy:** `readCustomMetadata` builds a GCS object path and reads metadata. That path construction should be owned by `GcsTimeSeriesAdapter`.
- **Data Clumps:** `symbol` + `contractID` are passed together through `parseContractIDMetadata`, `readCustomMetadata`, `getTimeSeriesObjectPath`, and `gcs.readLines`.
- **Primitive Obsession:** `contractID` is passed as a raw string and repeatedly re-parsed. A small `ContractID` value type could own `symbol`, `expiration`, `type`, `strike`, and `gcsPath`.

---

## 4. `/code-review` — Spec

### Missing / partial requirements

1. **`startDate` / `endDate` response semantics are undefined.** PRD §5.3 example shows `startDate: "2024-07-01"`, `endDate: "2026-08-29"`. The implementation returns the requested filter when provided, otherwise the actual first/last series date, and `null` when no observations exist. `null` is not shown in the PRD example and is not documented.
2. **No symbol allowlist.** PRD §14 Risks lists "Fixed symbol allowlist (`QQQ`, `TQQQ`)". The endpoint accepts any `symbol` and only 404s when the object is missing.

### Scope creep / not explicitly asked

1. **`timestamp` / `processingTimeMs` omitted.** PRD §5.3 example does not include them, so this is correct. Other partner endpoints add `processingTimeMs`, but that is outside this PRD contract.
2. **GCS custom metadata fallback.** PRD §6.4 says custom metadata "may include" these fields. The implementation reads metadata when `contractID` parsing fails. This is a reasonable interpretation but not explicitly required.

### Implemented but worth checking

1. **Strike parsing.** `QQQ260116C00490000` → `490` and `QQQ260829C00250000` → `250` match the PRD examples. Good.
2. **Error code `NOT_FOUND`.** PRD §5.4 says 404 with `NOT_FOUND`. The implementation emits literal `'NOT_FOUND'`; the `HistoricalOptionsErrorCode` enum does not contain it, so the static contract is inconsistent but the runtime envelope matches.
3. **Size guard runs after full download + parse.** A >10 MiB JSONL object will be fully downloaded and parsed before rejection. PRD only requires the response guard, not pre-emption. Acceptable but worth noting.

---

## 5. Thermo-nuclear code review

### Blockers

1. **No tests.** Same as Standards finding #1. Primary blocker before code-complete.
2. **Handler not exportable / testable.** Unit testing requires module-level mocking or a refactor to dependency injection.
3. **`withCors` catch violates the partner error contract.** `cors-middleware.ts` catches unhandled errors and responds `res.status(200).json({ success: false, error: 'Internal server error' })`. The partner contract is `{ ok: false, code, timestamp }`. If the handler `catch` already sent headers, `withCors` can still emit the wrong envelope.
4. **`startDate`/`endDate` can be `null`.** Undocumented and likely to break consumers expecting strings.

### Structural opportunities

1. **Extract contract metadata helpers.** Move `parseContractIDMetadata` / `readCustomMetadata` to `historical-options-corpus/services/contract-metadata.utils.ts`. The partner file should only validate HTTP input, call the service, build the response, and handle HTTP status codes.
2. **Introduce a `ContractID` value type.** Bundle `symbol`, `contractID`, `expiration`, `type`, `strike`, and `gcsPath` into one typed object to remove repeated `(symbol, contractID)` parameter pairs.
3. **Fail closed on missing bucket env.** Remove the `'av-options-time-series-bucket'` fallback.

### Minor positives

- Logs `requester`, `seriesCount`, `responseBytes`, and `processingTimeMs` — good observability.
- Uses `randomUUID` for request tracing.

---

## 6. Consolidated remediation plan

Do not apply code edits until this report is reviewed and approved.

1. Export `partnerHistoricalOptionsContractHandler(req, res, dependencies)` with dependency injection for `authenticateRequestEither`, a `GcsTimeSeriesAdapter`, `randomUUID`, and `now`.
2. Move `parseContractIDMetadata` / `readCustomMetadata` to `historical-options-corpus/services/contract-metadata.utils.ts` and update any barrel export.
3. Reuse or canonicalize the existing date validator instead of re-implementing it in the endpoint file.
4. Remove the hard-coded bucket-name fallback; fail closed if `OPTIONS_TIME_SERIES_BUCKET` is unset.
5. Decide and document the `startDate`/`endDate` response contract (request echo vs actual range vs fixed fallback) and avoid returning undocumented `null`.
6. Add `functions/tests/v2/partner/historical-options-contract-partner.test.ts` covering expected use, edge, and failure cases.
7. Decide the fate of the dirty backfill/builder changes before any deploy (stash or commit separately).
8. Optionally fix `cors-middleware.ts` to emit the partner error envelope on unhandled errors, or stop wrapping partner endpoints with `withCors`.
