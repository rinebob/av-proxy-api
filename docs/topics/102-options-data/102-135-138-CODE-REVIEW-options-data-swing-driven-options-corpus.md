**Topic:** Swing-driven options corpus platform  
**Topic Slug:** swing-driven-options-corpus  
**Thread:** Symbol flags curation  
**Thread Slug:** symbol-flags-curation  
**Issue:** #135 (BE Blueprint)  
**Task:** #138  
**Thread Parent:** #105  
**Topic Parent:** #102  
**Domain:** OPTIONS-DATA  
**Type:** CODE-REVIEW  
**Status:** Approved  
**Created:** 2026-09-24  
**Last Updated:** 2026-09-24  

# Code Review — Task #138: OptionableProbeService + backfill refactor

## Scope reviewed

- `functions/src/v2/symbol-flags/services/optionable-probe.service.ts` (new)
- `functions/tests/v2/symbol-flags/optionable-probe.service.test.ts` (new, 14 tests)
- `functions/scripts/backfill/backfill-optionable.ts` (refactored onto the service)
- `functions/scripts/verify/options-data-138-optionable-probe.{ts,md}` (new)
- `functions/tests/v2/swing-set/fake-firestore.ts` (DeleteTransform handling)
- `shared/alpha-vantage/av-symbol-search.ts` (`optionableProbeError` + constant)

## Findings and remediation

### Remediated during review

- **persist-failure mislabeled as probe failure (both axes):** `persist()` was inside the `try` with `probe()` — a db write error overwrote a good probe result with `optionable=false` and re-persisted. Catch now scopes to `probe()` only; persist errors propagate unchanged. Regression test added.
- **Stale sibling fields:** `merge` writes never deleted the sibling field — a stale `optionableProbeError` survived a later success (and vice versa). `persist()` now writes `FieldValue.delete()` for the unused sibling; fake-firestore extended to honor `DeleteTransform` sentinels; two regression tests.
- **Field-name literals:** service + script now use `TRACKED_SYMBOL_V2_FIELDS` / `FirestoreCollection` constants (contract drift risk closed).
- **`isQuotaError` instanceof fragility:** duck-typed on `category` so errors crossing module boundaries (script `require` vs compiled `lib`) still abort.
- **QUOTA_MESSAGE `'daily'` false-positive:** tightened to `daily (call|limit|quota)` — an unrelated "TIME_SERIES_DAILY_ADJUSTED" message no longer aborts a run.
- **Misleading dry-run comment** fixed; verify-script assertion on failure path tightened.

### Verified clean

- All 5 task ACs: probe/summary incl. `expirations`; defaults-only-when-absent; `optionable=false`+`optionableProbeError` on non-quota failure; full CLI parity (dry-run/symbols/delay/limit/force, quota abort incl. `Information`, resumable skip, error-path throttle); 14 unit tests + mutating verify script not in run-all.
- PRD field names match §75/§80 exactly; §76 defaults; §88 carve-out (quota rethrow, never block ingestion on other failures) documented in header.
- `Timestamp.now()` consistent with swing-set service precedent (script-invoked, testable).

### Accepted (documented, non-blocking)

- **Read-modify-write race on `optionsEnabled`:** a curator flipping the flag between `get()` and `set(merge)` could get clobbered — narrow window, `DocRefLike` has no transaction surface; documented in the service.
- **Spec carve-out (noted by spec axis):** `isQuotaError` rethrows on quota — diverges from PRD §88's literal "mark false on failure," required for backfill abort semantics; the #139 on-add trigger must catch quota errors itself (already in IMPL §3).
- Dry-run counter skew (probe throws → `errors` not `notOptionable`) — cosmetic.
- `analysis: any` on `OptionableRetrievalLike` — seam validated by `toSummaryFields`; typed alias deferred.
- Double doc read per symbol (script + service) — inherent to the seam.

## Test results

- 14/14 service unit tests; 61/61 across symbol-flags + swing-set suites; **579/579** full functions suite; `tsc --noEmit` clean.
- Verify script PASS on prod (AAPL round-trip incl. `optionableProbeError cleared on success`); refactored backfill verified end-to-end (MSFT: 3568 contracts, 146 strikes, 22 expirations; defaults patched).

## Re-review (second pass)

All first-pass findings verified fixed on all three axes:

- Catch scoped to `probe()` only — `persist()` failures propagate unwrapped, no false stamp.
- `FieldValue.delete()` verified correct against the real SDK (`DeleteTransform` sentinel, honored inside `set({merge:true})`; fake updated, both directions tested).
- Constants adopted in service and script (post-pass sweep covered the script's `snap.get`/`defaults` literals too).
- `isQuotaError` duck-type and tightened regex confirmed.
- No new issues from the fixes; `premium` in QUOTA_MESSAGE intentionally aborts (every symbol fails identically when the key is gated).

Remaining nits applied: dead `originalSet` removed; verify script asserts `optionableProbeError` cleared on success.

## Verdict

**PASS** — re-review confirmed all fixes; no critical or major findings remain.
