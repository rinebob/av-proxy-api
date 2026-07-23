# `partnerHistoricalOptionsContractV2` — Re-Review Report

**Date:** 2026-07-22  
**Head:** `prod` @ `8b9687a` + remediation  
**Reviews run:** `thermo-nuclear-code-review` + `/code-review` (Standards + Spec) on the post-remediation state  

---

## 1. Scope / change inventory

| File | Status | Notes |
|---|---|---|
| `functions/src/v2/partner/historical-options-contract-partner.ts` | rewritten | Refactored handler, dependency injection, removed `withCors` |
| `functions/src/v2/historical-options-corpus/services/contract-metadata.utils.ts` | new | Extracted metadata parsing + GCS fallback |
| `functions/src/v2/partner/historical-options-request.utils.ts` | modified | Added `NOT_FOUND` error code |
| `functions/tests/v2/partner/historical-options-contract-partner.test.ts` | new | 14 Jest tests |
| `functions/src/index.ts` | modified | Export still present |
| `functions/src/v2/historical-options-corpus/services/time-series-builder.service.ts` | dirty | Pre-existing, not touched |
| `functions/src/v2/historical-options-corpus/handlers/trigger-historical-options-time-series-build.http.ts` | dirty | Pre-existing, not touched |
| `.devin/skills/code-review/` | untracked | Artifact from the earlier `/code-review` skill run |

---

## 2. What got better

- Handler is exported and dependency-injected (`authenticateRequest`, `getGcs`, `randomUUID`, `now`).
- Contract metadata parsing + GCS fallback moved to `contract-metadata.utils.ts`.
- Bucket env now fails closed (throws if `OPTIONS_TIME_SERIES_BUCKET` is missing).
- `withCors` removed for this server-to-server endpoint, so the wrong `success: false` envelope cannot fire.
- `NOT_FOUND` added to `HistoricalOptionsErrorCode` and used.
- `startDate`/`endDate` are now strings (`''` fallback at worst) instead of undocumented `null`.
- 14 Jest tests pass in `3.264s`.

---

## 3. `/code-review` — Standards

### Remaining

1. **Duplicated `isValidIsoDate`.** The same implementation exists in `historical-options-contract-partner.ts` and `contract-metadata.utils.ts`. Extract it to a shared date utility (e.g., `src/v2/utils/date.utils.ts` or `src/v2/common/utils/date-time.utils.ts` if appropriate).
2. **Test mocks use `any` / `as any`.** `mockResponse` and `createRequest` are typed `any`. Using `Partial<Request>` and a `MockResponse` interface would make the tests safer under future refactor.
3. **No dedicated unit tests for `contract-metadata.utils.ts`.** `resolveContractMetadata` is exercised indirectly, but `parseContractIDMetadata` edge cases (invalid date, invalid type code, malformed strike) are not directly tested.
4. **`toFirstString` and `parseOptionalDate` live in the HTTP file.** These are generic request helpers; if not reused elsewhere, keep them private, but `isValidIsoDate` at minimum should be shared.

### Resolved from last review

- Handler exported/testable.
- Metadata helpers extracted from endpoint file.
- Hard-coded bucket-name fallback removed.
- `withCors` catch can no longer emit the wrong envelope for this endpoint.
- `startDate`/`endDate` `null` removed.
- Tests added.

---

## 4. `/code-review` — Spec

### Resolved

- `GET` method, required/optional params, dual auth, validation all correct.
- `NOT_FOUND` uses the enum.
- Response envelope fields match PRD §5.3.
- 10 MiB serialized size guard present.
- Empty filtered series returns `ok: true`.

### Remaining / opportunities

1. **Symbol allowlist still absent.** PRD §14 lists a fixed `QQQ`/`TQQQ` allowlist as a risk control. The endpoint still accepts any `symbol` and relies on GCS 404. Add an allowlist if that risk control is still desired.
2. **Response `startDate`/`endDate` semantics are only documented by code.** The precedence is: actual first/last series date → requested filter → `''`. Update the PRD/API doc if consumers need exact behavior.
3. **GCS metadata errors all map to 400.** If `bucket.file(...).getMetadata()` returns a 403/500, `resolveContractMetadata` returns `null` and the endpoint emits `BAD_REQUEST`. A future enhancement could differentiate `UPSTREAM_ERROR` from genuinely missing data.
4. **Object-path construction is duplicated with `GcsTimeSeriesAdapter`.** `contract-metadata.utils.ts` and `GcsTimeSeriesAdapter` both build `time-series/v1/{SYMBOL}/{CONTRACT_ID}.jsonl`. A single `getTimeSeriesObjectPath` utility used by both would remove the duplication.

---

## 5. Thermo-nuclear review

### Blockers

None. The previous blockers (no tests, untestable handler, `null` dates, hard-coded bucket, `withCors` envelope) are resolved.

### Structural opportunities

1. **Shared `isValidIsoDate` function.** This is the most concrete remaining duplication.
2. **Direct tests for `contract-metadata.utils.ts`.** Add `tests/v2/historical-options-corpus/contract-metadata.utils.test.ts` to cover parse/fallback edge cases.
3. **Typed test doubles.** Replace `any` casts in the test file with `Partial<Request>` and a `MockResponse` interface.
4. **Centralized GCS path helper.** `getTimeSeriesObjectPath` should live once and be imported by `GcsTimeSeriesAdapter` and `contract-metadata.utils.ts`.
5. **Symbol allowlist.** Add if the PRD risk control is still in scope.

### Clean-up before deploy

1. Remove or ignore the untracked `.devin/skills/code-review/` directory.
2. Decide the fate of the dirty `time-series-builder.service.ts` and `trigger-historical-options-time-series-build.http.ts` changes (stash or commit separately).

---

## 6. Verdict

The original review blockers are resolved. The code is now testable, well-structured, and the targeted test suite passes. Remaining items are refinements and small shared-utility extractions, not hard blockers. Before deploy, centralize `isValidIsoDate`, clean up the dirty/artifact files, and decide on the symbol allowlist.
