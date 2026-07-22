# Historical Options Time Series — Phase 1b Code Review

**Date:** 2026-07-22  
**Scope:** New Phase 1b per-contract time-series builder and admin HTTP trigger (`INGEST2a`–`INGEST2d`).  
**Review lenses:** `thermo-nuclear-code-review.md` + `rel-str-coding-guidelines.md`.  
**Result:** **Not approved for backfill** until the Critical and High findings below are addressed.

---

## 1. Change inventory

```text
 M functions/src/index.ts
 M functions/src/v2/historical-options-corpus/services/index.ts
 M functions/src/v2/historical-options-corpus/types.ts
?? functions/src/v2/historical-options-corpus/handlers/trigger-historical-options-time-series-build.http.ts
?? functions/src/v2/historical-options-corpus/services/gcs-time-series-adapter.service.ts
?? functions/src/v2/historical-options-corpus/services/time-series-builder.service.ts
?? functions/src/v2/historical-options-corpus/services/time-series-contract.utils.ts
 M functions/env.functions-sample
 M firebase.json
```

Other working-tree changes (`nightly-corpus.service.ts`, `jobs/`, `trading-calendar.service.ts`, etc.) were **not reviewed in depth** because they belong to Phase 2 (daily incremental) and are out of scope for the one-time backfill.

---

## 2. Quick sanity checks

| Check | Result |
| :---- | :----- |
| `git diff --check` | No whitespace errors (only CRLF/LF warnings). |
| `npx tsc -p functions/tsconfig.json --noEmit` | Pass. |
| `npm run build` (full build with `tsc-alias`) | Not run for this review. |
| New file line counts | `time-series-contract.utils.ts` 165, `gcs-time-series-adapter.service.ts` 126, `time-series-builder.service.ts` 245, `trigger-historical-options-time-series-build.http.ts` 158. All under the 300-line target. |

---

## 3. Contract matrix

| Concern | Current state | Notes |
| :------ | :------------ | :---- |
| **Entrypoint** | `POST /triggerHistoricalOptionsTimeSeriesBuild` | Admin-only via `x-admin-secret`. |
| **Auth** | `HISTORICAL_OPTIONS_TIME_SERIES_ADMIN_SECRET` (Secret Manager) | Must be created before deploy. |
| **Env vars** | `OPTIONS_CORPUS_BUCKET`, `OPTIONS_TIME_SERIES_BUCKET` | Both must be set on the function service. |
| **Input body** | `{ symbol, startDate?, endDate?, execute? }` | `execute` defaults to `false` (plan mode). |
| **Date defaults** | `startDate` → 2019-01-01, `endDate` → yesterday ET | Computed by a bespoke `yesterdayEt()` helper in the handler. |
| **GCS source layout** | `gs://{OPTIONS_CORPUS_BUCKET}/historical-options/v1/{SYMBOL}/{YYYY-MM-DD}.json.gz` | Read by `GcsCorpusAdapter.readItem`. |
| **GCS target layout** | `gs://{OPTIONS_TIME_SERIES_BUCKET}/time-series/v1/{SYMBOL}/{CONTRACT_ID}.jsonl` | Written/overwritten by `GcsTimeSeriesAdapter.writeLines`. |
| **Error envelope** | `{ ok: false, error: string }` | Consistent with existing endpoints. |
| **Success envelope (plan)** | `{ ok: true, plan: { symbol, startDate, endDate, totalTradingDays } }` |  |
| **Success envelope (execute)** | `{ ok: true, report: TimeSeriesBuildReport }` |  |
| **Idempotency** | Merges new observations with existing `.jsonl` lines, dedup by `d` (date) | Existing date wins over new date; re-runs are safe but do not overwrite corrected values. |

---

## 4. Findings

### 4.1 Critical — do not run backfill until fixed

#### C1: `writeMerged` silently drops corrupt existing JSONL lines
**File:** `functions/src/v2/historical-options-corpus/services/time-series-builder.service.ts`, lines 189–191.

```ts
const existingRecords = (existingLines ?? [])
  .map(parseStorageLine)
  .filter((r): r is TimeSeriesStorageRecord => r !== undefined);
```

If an existing per-contract `.jsonl` file contains a malformed line, that line is filtered out without logging or failing. The function then rewrites the file with the valid subset, **permanently losing the malformed line**. For a backfill tool that overwrites GCS, silent data loss is a blocker.

**Recommended fix:** Fail the write for that contract if any existing line cannot be parsed, and report the contract as failed. If graceful degradation is intentional, log each dropped line and count them in the report.

---

### 4.2 High — should fix before backfill

#### H1: Dynamic `require('firebase-admin/storage')` in `createTimeSeriesBuilderService`
**File:** `time-series-builder.service.ts`, line 226.

```ts
const { getStorage } = require('firebase-admin/storage');
```

This breaks static analysis/tree-shaking and is inconsistent with the rest of the codebase (all other modules use top-level `import`). It also makes the factory untestable without monkey-patching `require`.

**Recommended fix:** Use a top-level `import { getStorage } from 'firebase-admin/storage';` and inject the `Bucket` instances in tests.

#### H2: Factory uses `console.log` instead of the project logger
**File:** `time-series-builder.service.ts`, line 242.

```ts
logger: (message, meta) => console.log(`[time-series-builder] ${message}`, meta ?? {}),
```

The project uses `createLogger` from `../../utils/utils`. `console.log` will not be captured by the configured logging sink/severity levels.

**Recommended fix:** Pass `createLogger('time-series-builder').info` (or equivalent) as the logger.

#### H3: No unit tests for pure/time-critical logic
**Files:** all four new files.

`time-series-contract.utils.ts` is pure and trivial to unit test. `TimeSeriesBuilderService` has testable seams (injected adapters, calendar, logger) but currently has no coverage. `rel-str-coding-guidelines.md` requires unit tests for new features.

**Recommended fix:** Add Jest tests mirroring the existing `functions/tests/v2/historical-options-corpus/` layout:
- `time-series-contract.utils.test.ts`: `toStorageRecord`, `toStorageLine`, `parseStorageLine`, `toApiObservation`.
- `time-series-builder.service.test.ts`: idempotent merge, missing/corrupt date handling, flush counting.
- `trigger-historical-options-time-series-build.http.test.ts`: auth failure, validation, plan vs execute.

#### H4: `any` casts in `time-series-contract.utils.ts`
**File:** `time-series-contract.utils.ts`, lines 110–114, 126–130, 155–162.

```ts
(record as any)[alias] = value;
(ordered as any)[key] = value;
(observation as any)[full] = value;
```

These hide the actual contract. They work, but they are exactly the kind of `any` index signatures the project guidelines flag.

**Recommended fix:** Use a small typed helper, e.g.:

```ts
function setIfDefined<T extends object>(obj: T, key: keyof T, value: string | undefined): void {
  if (value !== undefined && value !== '') {
    (obj as Record<string, string>)[key as string] = value;
  }
}
```

This keeps the field contract explicit while still allowing dynamic assignment.

---

### 4.3 Medium — worth fixing, not blockers

#### M1: `buildPlan` is `async` for no reason
**File:** `trigger-historical-options-time-series-build.http.ts`, lines 62–80.

`buildPlan` does no I/O. `await`ing it adds an unnecessary microtask.

**Recommended fix:** Make it synchronous and remove `await` at the call site (line 132).

#### M2: `yesterdayEt` is bespoke date arithmetic in an HTTP handler
**File:** `trigger-historical-options-time-series-build.http.ts`, lines 36–60.

The function builds yesterday in ET by hand with `Intl.DateTimeFormat` parts. If the project already has date utilities, this duplicates that logic. If not, it should live in a shared date/time utility, not an admin trigger.

**Recommended fix:** Check `TradingCalendarService` or `shared/` date utils for an existing `getPreviousTradingDate` or `getTodayInET` helper; if none exists, extract `yesterdayEt` and `getPart` to `date-time.utils.ts`.

#### M3: `isAdmin` mutates the response object
**File:** `trigger-historical-options-time-series-build.http.ts`, lines 24–34.

A helper named `isAdmin` reads `req`, writes `res.status(403)`, and returns `boolean`. This is convenient but couples auth to HTTP serialization.

**Recommended fix:** Return a boolean and let the handler send the 403, or rename to `assertAdmin`/`sendForbiddenIfNotAdmin` to make the side effect obvious.

#### M4: Raw corpus reads are sequential
**File:** `time-series-builder.service.ts`, line 86 (inside the `for` loop).

```ts
const readResult = await this.deps.sourceGcs.readItem(upperSymbol, date);
```

For a 2019→current backfill, this means ~1,500–1,900 sequential GCS/downloads. This is memory-safe but will run for many minutes. If the function times out, the partial progress is idempotent, but it is still slow.

**Recommended fix:** Consider a bounded parallel read-ahead (e.g., `p-limit` or a small async queue) of the next `N` dates before processing the current chunk. Keep memory bounded while reducing wall-clock time. Document the chosen concurrency in the `chunkDays`/`writeConcurrency` comments.

---

### 4.4 Low / informational

#### L1: `GcsTimeSeriesAdapter.exists` is unused
**File:** `gcs-time-series-adapter.service.ts`, lines 121–124.

Public method `exists` is not called by the current code. Either remove it or use it in the consumer endpoint/Phase 2.

#### L2: `as any` in `file.save` options
**File:** `gcs-time-series-adapter.service.ts`, line 104.

```ts
await file.save(content, { ... } as any);
```

This mirrors `GcsCorpusAdapter` and is likely caused by the same upstream `@google-cloud/storage` type mismatch. Not a new smell, but worth typing properly if the upstream types allow it.

#### L3: `writeLines` is an unconditional overwrite
**File:** `gcs-time-series-adapter.service.ts`, lines 82–119.

This is intentional for the backfill, but a future Phase 2 append worker will need conditional/generation-aware writes. Consider documenting that this adapter is **overwrite-only** and that append logic will need a different method or `ifGenerationMatch`.

---

## 5. Deployment/operational prerequisites

Before the function can run, these must be configured:

1. **Secret:** `HISTORICAL_OPTIONS_TIME_SERIES_ADMIN_SECRET` in Secret Manager.
2. **Env var:** `OPTIONS_TIME_SERIES_BUCKET=av-options-time-series-bucket` on the Cloud Run service.
3. **Env var:** `OPTIONS_CORPUS_BUCKET` already set from Phase 1a.
4. **Deploy:** `firebase deploy --only functions:triggerHistoricalOptionsTimeSeriesBuild`.
5. **Build:** run `npm run build` (full `tsc-alias` + `copy-shared`) before deploying to catch alias/runtime issues not found by `tsc --noEmit`.

---

## 6. Verdict

**Do not run the one-time backfill until the following are fixed:**

1. **C1** — stop silently dropping corrupt existing `.jsonl` lines (data-loss risk).
2. **H1** — replace `require` with a top-level import.
3. **H2** — use the project `createLogger` in the factory.
4. **H4** — remove `any` casts from `time-series-contract.utils.ts` (or accept them explicitly with a typed helper).

After those, optionally address **M1–M4** and add the unit tests in **H3** before or immediately after the first backfill pilot. Once the fixes are in, re-run `tsc --noEmit` and `npm run build` and re-review the diff.

---

## 7. Re-Review — 2026-07-22

**Date:** 2026-07-22  
**Scope:** Verify fixes from Section 6 and identify remaining opportunities.  
**Result:** Critical/High blockers resolved. New code is now **approved for backfill pilot** after optional cleanup pass.

### 7.1 Verification commands

| Check | Result |
| :---- | :----- |
| `npx tsc -p functions/tsconfig.json --noEmit` | Pass. |
| `npx jest time-series` | 16/16 pass. |

### 7.2 Fixed since original review

- **C1** — `writeMerged` now logs corrupt existing JSONL lines under `builder.line.corrupt` and continues (`time-series-builder.service.ts:193-203`).
- **H1** — `require('firebase-admin/storage')` replaced by top-level static import (`time-series-builder.service.ts:1`).
- **H2** — factory logger now uses `createLogger('time-series-builder').info` (`time-series-builder.service.ts:249-255`).
- **H4** — `toStorageRecord` no longer uses `as any`; uses `Partial<TimeSeriesStorageRecord> & { d: string }` (`time-series-contract.utils.ts:110`).
- **M1** — `buildPlan` is now synchronous (`trigger-historical-options-time-series-build.http.ts:57-75`).
- **M3** — `isAdmin` is a pure boolean; handler sends 403 (`trigger-historical-options-time-series-build.http.ts:24-29,103-106`).
- **L1** — unused `GcsTimeSeriesAdapter.exists` removed.
- **H3** — unit tests added for `time-series-contract.utils.ts`, `time-series-builder.service.ts`, and `gcs-time-series-adapter.service.ts`.

### 7.3 Remaining opportunities

- **H4-continued** — `toStorageLine`, `toApiObservation`, and `parseStorageLine` still contain `as unknown` / `as any` casts. Recommend building typed working objects (`Partial<...>` / `Partial<...> & { d: string }`) and validating in `parseStorageLine`.
- **L2** — `file.save(content, { ... } as any)` in `gcs-time-series-adapter.service.ts:104` remains. Low risk.
- **M2** — `yesterdayEt`/`getPart` still bespoke in the HTTP handler. Extract to shared date utilities when possible.
- **M4** — `TimeSeriesBuilderService` still reads raw corpus dates sequentially. Bounded read-ahead is still an opportunity.
- **Report clarity** — `TimeSeriesBuildReport.processedContracts` counts per-chunk contract-file writes, not unique contracts. Add JSDoc or rename to `flushedContractFiles` to avoid confusion.

### 7.4 Verdict

The Critical and High findings that originally blocked the backfill are resolved and covered by tests. The remaining items are Medium/Low typing, clarity, and performance opportunities. The code is safe to deploy for the one-time backfill; address the remaining cleanups before or during Phase 2.

---

## 8. Post-Cleanup Review — 2026-07-22

**Date:** 2026-07-22  
**Scope:** Re-run the `.devin/skills` thermo-nuclear and `rel-str` regular reviews over the final time-series cleanup diff, verify the previous opportunities are resolved, and look for new ones.  
**Result:** Previous Section 7 opportunities are resolved. A small number of new low/medium polish items remain; no new critical or high blockers.

### 8.1 Verification commands

| Check | Result |
| :---- | :----- |
| `git diff --check` | Pass (only existing CRLF/LF warnings). |
| `npx tsc -p functions/tsconfig.json --noEmit` | Pass. |
| `npx jest time-series` | 16/16 pass. |

### 8.2 Opportunities resolved since Section 7.3

- **H4-continued** — `toStorageLine`, `toApiObservation`, and `parseStorageLine` no longer contain `as unknown` / `as any` casts. `parseStorageLine` now validates incoming JSONL fields by alias and builds a typed `Partial<TimeSeriesStorageRecord> & { d: string }` (`time-series-contract.utils.ts:125-173`).
- **L2** — `gcs-time-series-adapter.service.ts:99-106` now types `file.save` options as `SaveOptions` from `@google-cloud/storage` instead of `as any`.
- **M2** — `yesterdayEt` and `getPart` extracted to `functions/src/v2/common/utils/date-time.utils.ts`; the HTTP trigger imports `getYesterdayEt`.
- **M4** — `TimeSeriesBuilderService.buildSymbol` now pre-fetches raw corpus dates using bounded read-ahead (default concurrency of 5) via a `readQueue` (`time-series-builder.service.ts:92-106`).
- **Report clarity** — `TimeSeriesBuildReport.processedContracts` now has JSDoc clarifying it counts successful per-chunk contract-file writes (`time-series-builder.service.ts:36-37`).

### 8.3 Thermo-nuclear review findings

The cleanup pass is structurally sound. Files remain small and single-purpose, and the previous `any`/unknown casts are gone. New findings are polish-level:

1. **Residual non-null assertions in `TimeSeriesBuilderService` (M)** — `readQueue.shift()!` (`time-series-builder.service.ts:101`) and `chunk.get(contractID)!` (`time-series-builder.service.ts:187`) still use `!`. Both are safe by construction, but the pattern can be removed without casts by pulling the optional value through a guard (`const nextRead = readQueue.shift(); if (!nextRead) break;`).
2. **`flushChunk` serializes batches (L)** — `flushChunk` awaits each `flushBatch` in a `for` loop (`time-series-builder.service.ts:167-170`). Because `flushBatch` already parallelizes writes inside the batch, this two-level orchestration is acceptable, but it should be intentional: a short comment explaining why batches are not all launched at once would help.
3. **`readConcurrency` is not tunable (L)** — `DEFAULT_READ_CONCURRENCY = 5` is hard-coded and not exposed in `createTimeSeriesBuilderService`. For a one-time backfill this is fine; for Phase 2 or larger symbols, consider reading it from an env var or function option.
4. **`toApiObservation` sets `date` twice (L)** — `observation` is initialized with `date: record.d` and then the `d` alias is written again in the `aliasToFull` loop (`time-series-contract.utils.ts:165-170`). Skipping `alias === 'd'` in the loop removes the redundancy without changing behavior.

### 8.4 `rel-str` regular review findings

Checked against the project-wide coding guidelines. The time-series code satisfies the file-size, single-purpose, and test-coverage rules. No new critical/regular blockers:

- **Entry-point separation** — `triggerHistoricalOptionsTimeSeriesBuild` continues to only parse input, validate auth, call `buildPlan`/`buildSymbol`, and return a response.
- **Shared utility reuse** — `getYesterdayEt` now lives in `common/utils` and is consumed by the trigger.
- **Type boundaries** — The remaining `error: any` catch parameters (`gcs-time-series-adapter.service.ts:107`, `time-series-builder.service.ts:191`, `trigger...http.ts:130`) are acceptable for this pass; converting them to `unknown` and narrowing is a future low-risk cleanup.
- **`GcsTimeSeriesAdapter.readLines` trimming** (`gcs-time-series-adapter.service.ts:63`) — `line.trim()` only removes whitespace around the JSON object, so it is safe, but `filter(line => line.trim() !== '')` without mapping `trim` over every line is a clearer expression of intent.
- **Sibling `as any` retained** — `gcs-corpus-adapter.service.ts:125` still uses `as any` for its gzipped `file.save` options. This is outside the time-series diff and was not changed; it can be addressed when that adapter is next touched or when a shared typed save helper is introduced.

### 8.5 Verdict

The Section 7 cleanup opportunities are fully resolved and tests continue to pass. The new thermo/regular findings are low-to-medium polish items (non-null assertions, redundant `date` assignment, hard-coded concurrency, minor intent-clarity improvements). **There are no new critical or high findings.** The code remains approved for the one-time backfill; address the Section 8.3/8.4 nits before Phase 2 if desired.
