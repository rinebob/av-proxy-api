# `partnerHistoricalOptionsContractV2` — Re-Review #3 Report

**Date:** 2026-07-22  
**Head:** `prod` @ `8b9687a` + isValidIsoDate extraction + metadata unit tests  
**Reviews run:** `thermo-nuclear-code-review` + `/code-review` (Standards + Spec) on the latest state  

---

## 1. Scope / change inventory

| File | Status | Notes |
|---|---|---|
| `functions/src/v2/common/utils/date-time.utils.ts` | modified | Now exports shared `isValidIsoDate` |
| `functions/src/v2/historical-options-corpus/services/contract-metadata.utils.ts` | modified | Imports shared `isValidIsoDate`; private copy removed |
| `functions/src/v2/partner/historical-options-contract-partner.ts` | modified | Imports shared `isValidIsoDate`; private copy removed |
| `functions/tests/v2/historical-options-corpus/contract-metadata.utils.test.ts` | new | 8 unit tests for `resolveContractMetadata` |
| `functions/tests/v2/partner/historical-options-contract-partner.test.ts` | new (unchanged) | 14 endpoint tests |
| `functions/src/v2/partner/historical-options-request.utils.ts` | modified | Added `NOT_FOUND` earlier |
| `functions/src/index.ts` | modified | Export still present |
| `functions/src/v2/historical-options-corpus/services/time-series-builder.service.ts` | dirty | Pre-existing, not touched |
| `functions/src/v2/historical-options-corpus/handlers/trigger-historical-options-time-series-build.http.ts` | dirty | Pre-existing, user-modified timeout to 1200s; not touched by these changes |
| `.devin/skills/code-review/` | untracked | **Not part of these changes; do not delete** |

---

## 2. What got better since review #2

- `isValidIsoDate` is no longer duplicated; it lives in `date-time.utils.ts` and is imported by both consumers.
- `contract-metadata.utils.test.ts` provides direct coverage of `resolveContractMetadata`:
  - valid OCC-style `contractID` parsing
  - symbol prefix mismatch
  - GCS custom-metadata fallback
  - missing/incomplete/invalid GCS metadata
  - GCS metadata fetch failure
  - invalid date and invalid type code in `contractID`
- Combined targeted test suite now passes **22 / 22** in `3.71s`.

---

## 3. `/code-review` — Standards

### Remaining

1. **New exported `isValidIsoDate` has no dedicated unit tests.** `project-rules.md` requires tests for all new functions/features. Add `tests/v2/common/utils/date-time.utils.test.ts` covering valid dates, invalid formats, and non-existent dates (e.g., `2024-02-31`).
2. **Partner endpoint tests still use `any` for mocks.** `mockResponse`, `createRequest`, and `buildDeps` are typed with `any`/`as any`. Tighten to `Partial<Request>` / `Partial<Response>`-style typed test doubles.
3. **`getObjectPath` duplication with `GcsTimeSeriesAdapter` persists.** `contract-metadata.utils.ts` and `GcsTimeSeriesAdapter` both build `time-series/v1/{SYMBOL}/{CONTRACT_ID}.jsonl`. Extract to a single shared `time-series-path.utils.ts` or export `getObjectPath` from a storage-path module.
4. **Generic request helpers still live in the endpoint file.** `toFirstString` and `parseOptionalDate` are not reused but are not the endpoint's core concern. If they stay private, keep small; otherwise move to `request.utils.ts`.

### Resolved

- `isValidIsoDate` duplication removed.
- `contract-metadata.utils.ts` has direct unit tests.
- Handler remains dependency-injected and exported.
- File size and single-responsibility constraints are still satisfied.

---

## 4. `/code-review` — Spec

### Resolved

- `GET` method, required/optional params, dual auth, validation all correct.
- `NOT_FOUND` uses the enum.
- Response envelope fields match PRD §5.3.
- 10 MiB serialized size guard present.
- Empty filtered series returns `ok: true`.

### Remaining / opportunities

1. **Symbol allowlist still absent.** PRD §14 lists a fixed `QQQ`/`TQQQ` allowlist as a risk control. The endpoint still accepts any `symbol` and relies on GCS 404. Add an allowlist if that risk control is still intended.
2. **Response `startDate`/`endDate` semantics are only documented by code.** The precedence is: actual first/last series date → requested filter → `''`. Update the PRD/API doc if consumers need exact behavior.
3. **GCS metadata errors all map to 400.** If `bucket.file(...).getMetadata()` returns a 403/500, `resolveContractMetadata` returns `null` and the endpoint emits `BAD_REQUEST`. A future enhancement could differentiate `UPSTREAM_ERROR` from genuinely missing data.
4. **No tests for `isValidIsoDate` edge cases.** As above, this is both a standards and a spec-coverage item.

---

## 5. Thermo-nuclear review

### Blockers

None. The handler is testable, metadata utilities are extracted and tested, and the test suite passes.

### Structural opportunities

1. **Add `tests/v2/common/utils/date-time.utils.test.ts` for `isValidIsoDate`.** This is the highest-value new test gap.
2. **Tighten `any` in `historical-options-contract-partner.test.ts`.** Replace broad `any` helpers with typed `MockRequest` / `MockResponse` and cast to `Request`/`Response` at the call site.
3. **Centralize `getTimeSeriesObjectPath`.** Both `contract-metadata.utils.ts` and `GcsTimeSeriesAdapter` should consume the same path-building function.
4. **Consider typed `getGcs` test doubles.** `buildDeps` still relies on `as any` for the `adapter`/`bucket` mocks.

### Clean-up / side notes

1. The `.devin/skills/code-review/` directory is **not** part of these changes and should not be deleted.
2. The dirty `time-series-builder.service.ts` and `trigger-historical-options-time-series-build.http.ts` changes are outside this scope; handle them separately before deploy.

---

## 6. Verdict

The code is now cleaner and better tested than in review #2. The remaining work is refinements and test coverage for the newly shared `isValidIsoDate`. No hard blockers remain. Before deploy:

- Add unit tests for `isValidIsoDate`.
- Decide on the symbol allowlist.
- Handle the dirty builder/build-trigger files separately.
