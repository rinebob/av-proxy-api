# `partnerHistoricalOptionsContractV2` — Re-Review #4 Report

**Date:** 2026-07-22  
**Head:** `prod` @ `8b9687a` + shared `isValidIsoDate` + `getTimeSeriesObjectPath` + tests  
**Reviews run:** `thermo-nuclear-code-review` + `/code-review` (Standards + Spec) on the latest state  

---

## 1. Scope / change inventory

| File | Status | Notes |
|---|---|---|
| `functions/src/v2/common/utils/date-time.utils.ts` | modified | Exports shared `isValidIsoDate`; now tested |
| `functions/src/v2/historical-options-corpus/services/gcs-time-series-path.utils.ts` | new | Canonical path helper used by adapter + metadata |
| `functions/src/v2/historical-options-corpus/services/gcs-time-series-adapter.service.ts` | modified | Imports `getTimeSeriesObjectPath`; no path duplication |
| `functions/src/v2/historical-options-corpus/services/contract-metadata.utils.ts` | modified | Imports `isValidIsoDate` and `getTimeSeriesObjectPath` |
| `functions/tests/v2/common/utils/date-time.utils.test.ts` | new | 6 unit tests for `isValidIsoDate` |
| `functions/tests/v2/partner/historical-options-contract-partner.test.ts` | unchanged | 14 endpoint tests |
| `functions/tests/v2/historical-options-corpus/contract-metadata.utils.test.ts` | unchanged | 8 metadata tests |
| `functions/src/index.ts` | unchanged | Export still present |
| `.devin/skills/code-review/` | untracked | **Not part of these changes; do not delete** |

---

## 2. What got better since review #3

- `isValidIsoDate` is tested directly (`tests/v2/common/utils/date-time.utils.test.ts`):
  - valid ISO date, leap day, non-existent date, invalid format, non-date string, empty string.
- `getTimeSeriesObjectPath` is now a single shared utility consumed by both `GcsTimeSeriesAdapter` and `contract-metadata.utils.ts`.
- Combined targeted test suite now passes **28 / 28** in `~5.7s`.

---

## 3. `/code-review` — Standards

### Remaining

1. **Partner endpoint tests still use `any` for helpers.** `mockResponse`, `createRequest`, `buildDeps`, and several inline `getGcs` mocks are typed with `any` or broad `as any` casts. Tighten to typed test doubles (`MockRequest` / `MockResponse` / `Partial<PartnerHistoricalOptionsContractDependencies>` with `as unknown as` casts at the call site).
2. **`gcs-time-series-path.utils.ts` has no dedicated unit tests.** It is trivial, but if `project-rules.md` is strictly interpreted, new utility files should have at least one test each. Consider adding `tests/v2/historical-options-corpus/services/gcs-time-series-path.utils.test.ts`.
3. **`GcsTimeSeriesAdapter` still depends on `TIME_SERIES_PREFIX` for its constructor default.** This is fine, but the prefix now also lives in `gcs-time-series-path.utils.ts` via `TIME_SERIES_PREFIX`; no logic divergence, only one import.

### Resolved

- `isValidIsoDate` duplication removed and tested.
- `getTimeSeriesObjectPath` duplication removed.
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

---

## 5. Thermo-nuclear review

### Blockers

None. The handler is testable, metadata utilities are extracted and tested, the path helper is centralized, and the test suite passes.

### Structural opportunities

1. **Tighten `any` in `historical-options-contract-partner.test.ts`.** This is the largest remaining hygiene item.
2. **Add a trivial unit test for `getTimeSeriesObjectPath`.** Especially the `toUpperCase()` normalization behavior.
3. **Consider typed `getGcs` test doubles.** `buildDeps` still relies on `as any` for the adapter/bucket mocks.

### Clean-up / side notes

1. The `.devin/skills/code-review/` directory is **not** part of these changes and should not be deleted.
2. The dirty `time-series-builder.service.ts` and `trigger-historical-options-time-series-build.http.ts` changes are outside this scope; handle them separately before deploy.

---

## 6. Verdict

The code is now clean, well tested, and the previous structural issues are resolved. The remaining items are test-hygiene (`any` in mocks) and optional spec enhancements (symbol allowlist, date semantics docs, GCS error mapping). No hard blockers remain. Before deploy:

- Decide on the symbol allowlist.
- Handle the dirty builder/build-trigger files separately.
