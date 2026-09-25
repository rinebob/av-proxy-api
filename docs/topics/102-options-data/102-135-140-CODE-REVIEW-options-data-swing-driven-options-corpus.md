**Topic:** Swing-driven options corpus platform
**Topic Slug:** swing-driven-options-corpus
**Thread:** Symbol flags curation
**Thread Slug:** symbol-flags-curation
**Blueprint:** #135 (BE Blueprint)
**Task:** #140 (setOptionsEnabledV2 callable)
**Thread Parent:** #105 (Symbol flags curation)
**Topic Parent:** #102 (Swing-driven options corpus)
**Domain:** OPTIONS-DATA
**Type:** CODE-REVIEW
**Status:** Approved
**Created:** 2026-09-25
**Last Updated:** 2026-09-25

# Code Review — Task #140: setOptionsEnabledV2 curation callable

## Scope reviewed

- `functions/src/v2/symbol-flags/functions/set-options-enabled.{core,function,errors}.ts`
- `functions/src/v2/common/functions/save-tracked-symbol.function.ts`
- `functions/src/v2/symbol-flags/utils/options-flag-defaults.ts`
- `functions/tests/v2/symbol-flags/{set-options-enabled,ingestion-defaults}.test.ts`
- `functions/tests/v2/swing-set/fake-firestore.ts`
- `functions/scripts/verify/options-data-140-set-options-enabled.{ts,md}`
- `shared/alpha-vantage/av-symbol-search.ts`

## Findings and remediation

### Resolved during review

- **Verify script could leave a symbol disabled:** it now flips to the opposite state, checks the idempotent no-op, then restores the original state. It leaves two audit entries and stubs enqueue.
- **Client could forge `optionable=true`:** `saveTrackedSymbol` now strips all curation/probe-owned fields (`optionable`, probe timestamps/summary/error, `optionsEnabled`, and history) before applying defaults and writing. A regression test covers all six fields. Existing server-owned values survive the merge; onboarding probe still writes them server-side.
- **Callable error contract mismatch:** failures now throw Firebase `HttpsError`s: `OPTIONS_NOT_OPTIONABLE` maps to `failed-precondition`, `SYMBOL_NOT_FOUND` to `not-found`, and auth/input failures to their corresponding callable codes. Stable domain `errorCode` and symbol are included in `details` for the client.
- **Unrestricted CORS on new callable:** `setOptionsEnabledV2` now uses the shared `ALLOWED_ORIGINS` list.
- **Non-atomic history update:** history now uses `FieldValue.arrayUnion` in the same merge write as the flag and `_lastUpdated`.
- **Timestamp transform inside array union:** Firestore rejects transforms nested inside array elements. Audit entries therefore use `Timestamp.now()` for `changedAt`; `_lastUpdated` uses `FieldValue.serverTimestamp()`. The IMPL contract records this constraint.
- **Fake masked that SDK constraint:** fake Firestore now rejects nested `serverTimestamp()` in an `arrayUnion` element, with a regression test.
- **Malformed symbol path:** input validation rejects invalid symbol keys before Firestore lookup.
- Shared callable boundary types and coded errors are exported from `@shared/alpha-vantage`.

### Verified clean

- Auth required; optionable gate enforced; audit history atomically appended; `_lastUpdated` bumped; enqueue only on false→true, warns on enqueue failure; same-value updates are no-ops.
- Enqueue occurs after the persisted update; `enqueueSwingSetGeneration` re-reads the tracked-symbol flag.
- `bulkImportSymbolsV2` constructs tracked docs from provider fields and metadata; caller-supplied flag fields do not reach that write.
- Single-user authorization model remains authenticated-user-only in code; custom-claim admin enforcement is deferred as recorded in the callable comment and accepted for the current deployment.

### Accepted follow-ups

- `saveTrackedSymbol` retains its pre-existing `cors: true`; repo-wide CORS cleanup is separate. The new curation callable itself uses the explicit allowlist.
- Curation history uses arrayUnion, but other read-modify-write defaults still have their documented narrow race windows.
- `ALLOWED_ORIGINS` is a static list; unknown hosted-app origins need to be added explicitly.

## Verification

- Full Functions build passed (`npm run build`).
- Full Functions suite: **621 tests passed**.
- Focused symbol-flags + swing-set suites: **87 tests passed**.
- `npx tsc --noEmit` clean.
- Prod verification script passed (AAPL flag restored to its original value, enqueue stubbed; two auditable verify entries left in history).
- `git diff --check` checked before commit.

## Verdict

**PASS** — third-pass blockers are resolved; no remaining task-blocking findings.