# Code Review: Data Quality Diagnostics Toolkit

**Date:** 2026-07-26  
**Fixed point:** `HEAD` (commit `87a46d9`)  
**Change set:** All untracked files under `functions/scripts/diagnostics/` plus tracked modifications to `.gitignore`, `TASK.md`, and `content-viewer.directive.ts`

---

## Change Set Inventory

### Untracked diagnostic scripts (new)
| File | Lines | Purpose |
|------|-------|---------|
| `data-quality-detect.ts` | 688 | Core anomaly detection library (pure functions) |
| `data-quality-utils.ts` | 161 | Black-Scholes math + market holidays + weekday counting |
| `scan-data-quality.ts` | 545 | Main scan orchestrator: GCS listing, download, detect, CSV output |
| `scan-zero-drops.ts` | 491 | Earlier standalone zero-drop scanner (superseded by scan-data-quality.ts) |
| `classify-zero-drops.ts` | 501 | Post-scan classifier: fetches underlying closes, labels anomalies |
| `check-alt-fields.ts` | 305 | Sample checker: inspects mark/bid/ask availability on corrupted dates |
| `audit-timeseries-coverage.ts` | 328 | Coverage audit: GCS metadata-only CSV report |
| `repair-corrupted-contracts.ts` | 504 | Repair script: patches JSONL from corpus data (not yet used) |

### Tracked file modifications
| File | Change |
|------|--------|
| `.gitignore` | Adds `.devin/skills/**/*` |
| `TASK.md` | Adds completed task entry for storage viewer refactor |
| `content-viewer.directive.ts` | Removes `DomSanitizer` import, sets `innerHTML` directly (escapeHtml is the security boundary) |

---

## Standards

*Standards sources: `rel-str-coding-guidelines.md` + `rh-agent-coding-guidelines.md` + project rules in `MEMORY[project-rules.md]`*

### Hard Violations

1. **Duplicated Code — `fetchUnderlyingCloses` + `lookupClose` copied across 3 files**  
   `classify-zero-drops.ts` (lines 172-223) and `scan-data-quality.ts` (lines 191-218) contain near-identical implementations of `fetchUnderlyingCloses` and `lookupClose`/`lookupUnderlyingClose`. The detect file also has its own `lookupUnderlyingClose` (lines 229-251). This violates the rel-str guideline: *"Is this logic duplicated anywhere in the frontend, backend, or across the boundary?"*  
   **Fix:** Extract a shared `underlying-closes.service.ts` in the diagnostics folder.

2. **Duplicated Code — `parseCsvLine` copied across 2 files**  
   `classify-zero-drops.ts` (lines 85-116) and `check-alt-fields.ts` (lines 72-103) have identical `parseCsvLine` implementations.  
   **Fix:** Extract to a shared `csv-utils.ts`.

3. **`scan-zero-drops.ts` is dead code — superseded by `scan-data-quality.ts`**  
   The rel-str guidelines say: *"Do not keep functions that are never called"* and *"Helper functions defined but never called."* This entire 491-line file is superseded.  
   **Fix:** Delete `scan-zero-drops.ts`.

4. **`repair-corrupted-contracts.ts` is unused and unauthorized**  
   User explicitly stated no repair will be done. This 504-line file is dead code.  
   **Fix:** Delete `repair-corrupted-contracts.ts`.

5. **`any` casts in Firestore data access**  
   `scan-data-quality.ts` line 208: `const data = snap.data() as any` and line 209: `const bars: any[]`. Same pattern in `classify-zero-drops.ts` line 189-190. Violates rel-str guideline: *"Do not use `any` index signatures to hide shape mismatches."*  
   **Fix:** Define a minimal `TimeSeriesYearDoc` interface with a `bars: CompactBar[]` field.

6. **`any` cast in GCS API response**  
   `scan-data-quality.ts` line 329: `const nextPageToken = (apiResponse as any)?.nextPageToken`.  
   **Fix:** Use the typed `GetFilesResponse` from `@google-cloud/storage`.

### Judgement Calls (Baseline Smells)

7. **Duplicated Code — `detectZeroDrops` and `detectMarkZeroDrops` are ~90% identical**  
   `data-quality-detect.ts` lines 152-218 and 262-352 share the same structure: iterate, check threshold, find run end, push anomaly. The only differences are the field (`l` vs `m`), the threshold config keys, and the ITM filter.  
   **Fix:** Extract a generic `detectZeroDropsForField(obs, base, config, field, opts)` that both call.

8. **Data Clumps — `base` object passed to every detection function**  
   The `Pick<Anomaly, 'contractId' | 'expiration' | 'strike' | 'type' | 'totalObs' | 'firstTradedDate' | 'fileStartDate' | 'fileEndDate'>` type is repeated 8 times across function signatures.  
   **Fix:** Extract as a named `AnomalyBase` type alias.

9. **Shotgun Surgery — adding a new detection requires editing 3 places**  
   To add a new detection, you must: (1) write the function in `data-quality-detect.ts`, (2) add it to `runAllDetections`, (3) potentially update `scan-data-quality.ts` imports and the `markOnly` branch.  
   **Acceptable for now** — the pattern is clear and documented.

10. **`check-alt-fields.ts` line 260: hardcoded `const symbol = 'QQQ'`**  
    Comment says "All suspicious anomalies are QQQ" but this is a brittle assumption.  
    **Fix:** Extract symbol from contract ID like other scripts do.

---

## Spec

*No formal spec/PRD exists for this work. The user's evolving requests drove the design. Assessing against the stated objectives.*

### Objectives Met

- ✅ Detect zero-drop anomalies in `l` (last) field across all time-series files
- ✅ Classify anomalies as legitimate vs suspicious using underlying closes + moneyness
- ✅ Detect zero-drop anomalies in `m` (mark) field with ITM filtering
- ✅ Confirm mark field is clean across all 359K files (0 anomalies)
- ✅ Check alternative field availability for potential repair

### Issues

1. **Scope creep — `repair-corrupted-contracts.ts` was built but user explicitly said no repair**  
   The repair script was created during the session but the user later stated: "no we're not going to repair anything thats on them. we just won't use it." This file should not be in the change set.

2. **Scope creep — `audit-timeseries-coverage.ts` is unrelated to data quality detection**  
   This is a coverage audit tool, not an anomaly detector. It's useful but shouldn't be bundled with the data-quality review.

3. **`scan-zero-drops.ts` is an earlier iteration that was superseded by `scan-data-quality.ts`**  
   Keeping both creates confusion about which is the canonical entry point.

4. **Missing: `--mark-only` flag not documented in file header**  
   `scan-data-quality.ts` header (lines 1-44) documents all env vars and flags but does not mention `--mark-only`.  
   **Fix:** Add `--mark-only` to the flags section.

5. **Missing: `MARK_PREVIOUS_THRESHOLD` and `MARK_ZERO_THRESHOLD` env vars not documented**  
   These new env vars are parsed in `buildConfig()` but not listed in the file header.

---

## Thermo-Nuclear

*Whole-Change Protocol: inventory all files, trace full data path, read transitive consumers, build contract matrix.*

### Contract Matrix

| Concern | Status |
|---------|--------|
| Input validation | ✅ Env vars validated, bucket name required |
| Authorization | N/A — diagnostic scripts, not deployed functions |
| Persistence | ✅ CSV output only, no Firestore writes |
| Provider calls | ✅ GCS reads only, no external API calls |
| Error envelopes | ⚠️ Errors logged but not structured |
| Response schema | ✅ CSV format consistent across scripts |
| Shared enums | ⚠️ Anomaly type strings are inline, not enum constants |
| Observability | ✅ Progress logging with running counts |
| Tests | ❌ Zero tests for any detection function |
| Documentation | ⚠️ File headers good, but missing `--mark-only` docs |

### Structural Findings

1. **`data-quality-detect.ts` at 688 lines — approaching the 500-line project limit**  
   Project rules state: *"Never create a file longer than 500 lines of code."* This file is at 688. The `detectMarkZeroDrops` addition (lines 220-352) pushed it over.  
   **Presumptive blocker.** Split: extract `detectMarkZeroDrops` + `lookupUnderlyingClose` + `UnderlyingCloses` into a `mark-zero-drop.detect.ts` file, or extract the structural issues detection into its own file.

2. **`scan-data-quality.ts` at 545 lines — also over the 500-line limit**  
   The `fetchUnderlyingCloses` function (lines 191-218) and the `--mark-only` branching added bulk.  
   **Presumptive blocker.** Split: extract `fetchUnderlyingCloses` to a shared service, extract CSV writing to a utility.

3. **`classify-zero-drops.ts` at 501 lines — just over the limit**  
   Barely over. Extracting the duplicated `fetchUnderlyingCloses` + `lookupClose` + `parseCsvLine` would bring it well under.

4. **Anomaly type strings are not typed**  
   `anomalyType` is a `string` in the `Anomaly` interface. All detection functions use string literals like `'ZERO_DROP_RECOVERY'`, `'MARK_TRAILING_ZEROS'`, etc. No union type or enum. This means a typo in any detection function silently produces an unclassifiable anomaly.  
   **Fix:** Define `type AnomalyType = 'ZERO_DROP_RECOVERY' | 'TRAILING_ZEROS' | 'MARK_TRAILING_ZEROS' | ...` and use it in the `Anomaly` interface.

5. **No tests for any detection function**  
   All detection functions in `data-quality-detect.ts` are pure functions — ideal for unit testing. Zero tests exist. Project rules say: *"Create full unit tests for all new features."* and *"1 test for expected use, 1 edge case, 1 failure case."*  
   **Presumptive blocker.** At minimum, test `detectZeroDrops`, `detectMarkZeroDrops`, and `classifyAnomaly`.

6. **`scanContract` makes 2 GCS calls per contract (metadata + download)**  
   `scan-data-quality.ts` lines 240-247: `getMetadata()` then lines 250-251: `download()`. For 359K files, that's 718K GCS API calls. The metadata call is for `firstObserved` — consider whether this is needed for the mark-only scan (it's not used by `detectMarkZeroDrops`).  
   **Optimization:** Skip metadata fetch in `--mark-only` mode.

7. **`detectMarkZeroDrops` ITM filter silently skips when underlying data is missing**  
   Lines 291-296: if `underlyingClose == null`, the anomaly is skipped with `continue`. This means if Firestore has a gap, a real mark corruption would be missed. This is a design choice (avoid false positives) but should be documented as a known limitation.

### Approval Bar Assessment

- ❌ **File size explosion**: 3 files over 500-line limit
- ❌ **No tests**: Zero unit tests for pure detection functions
- ❌ **Duplicated code**: `fetchUnderlyingCloses` × 2, `parseCsvLine` × 2, `lookupClose` × 2
- ❌ **Dead code**: `scan-zero-drops.ts` (superseded), `repair-corrupted-contracts.ts` (unused)

**Verdict: Not approved.** Address the presumptive blockers before committing.

---

## Summary

| Axis | Findings | Worst Issue |
|------|----------|-------------|
| Standards | 6 hard violations, 4 judgement calls | Duplicated `fetchUnderlyingCloses` across 3 files |
| Spec | 5 issues | Dead code (`repair-corrupted-contracts.ts`, `scan-zero-drops.ts`) |
| Thermo-Nuclear | 7 findings | 3 files over 500-line limit + zero tests |

### Recommended Remediation Priority

1. Delete `scan-zero-drops.ts` and `repair-corrupted-contracts.ts`
2. Extract shared `underlying-closes.service.ts` and `csv-utils.ts`
3. Split `data-quality-detect.ts` to get under 500 lines
4. Add `AnomalyType` union type
5. Document `--mark-only` flag and mark threshold env vars
6. Add unit tests for detection functions
7. Replace `any` casts with typed interfaces
