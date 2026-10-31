**Topic:** Options Corpus Bulk Ingest  
**Topic Slug:** options-corpus-bulk-ingest  
**Thread:** Contract Availability Endpoint  
**Thread Slug:** availability-endpoint  
**Issue:** #242  
**Thread Parent:** #237  
**Topic Parent:** #213  
**Task:** #251  
**Domain:** BE  
**Type:** Code Review  
**Status:** Complete  
**Created:** 2026-10-31  
**Last Updated:** 2026-10-31  

# Code Review — Task #251: bound availability primary-range reads

## Scope

| File | Change |
|---|---|
| `functions/src/v2/historical-options-corpus/services/contract-availability-query.service.ts` | MOD — both scan paths moved from `get()`/paged-get to `Query.stream()` under a 25k scanned-doc ceiling; shared `scanBounded` loop; `expirations` `in` path streamed under the same ceiling; `pageSize` ctor param removed |
| `shared/options/contract-availability.types.ts` | MOD — `truncated` doc now covers read-ceiling semantics |
| `functions/tests/v2/historical-options-corpus/contract-availability-query.service.test.ts` | MOD — fake `Query.stream()` + cancellation tracking; dead page machinery removed; 6 new/rewritten tests |
| `functions/scripts/verify/options-data-251-availability-read-ceiling.ts` | NEW — prod timing verify vs 60s budget |
| `functions/scripts/verify/options-data-251-availability-read-ceiling.md` | NEW — companion guide |
| `functions/scripts/verify/README.md` | MOD — registry row + execution-order entry |
| `functions/scripts/verify/run-all.ts` | MOD — registered in read-only SCRIPTS list |

## Axis results

| Axis | Verdict |
|---|---|
| Standards | PASS WITH MINORS |
| Spec | PASS |
| Thermo-nuclear | PASS WITH MINORS |

## Deviation from the task's stated mechanism

The issue's first AC suggested `limit` + `startAfter` paging. A paged
implementation was built first and **failed prod verification**:
sequential page round-trips capped at ~360-700 docs/s (178.4s for the
widest range — over the 60s budget). Pivoted to `Query.stream()` in the
same `orderBy(primary, __name__)` order — ~830 docs/s. Documented on
#251; all three axes judged it the right call — the partner contract
exposes `truncated`, never page mechanics. (Early `for await` exit
destroys the consumer-side stream; it does NOT cancel the upstream
gRPC `runQuery` RPC — the SDK's pipe chain doesn't forward destroy.
Upstream delivery pauses via flow-control backpressure, billed reads
stay bounded near the ceiling, and the RPC closes on server idle
timeout. See pass-2 findings.)

## Findings and dispositions

### Fixed during review

| Sev | Finding | Disposition |
|---|---|---|
| Major | `fetchByExpirationList` still fired unbounded `get()`s — the 30-value `in` cap bounds value count, not doc count; a dense expiration could materialize ~100k docs (same blast radius this task exists to fix) | **Fixed** — each `in` chunk now streams under the same scanned-doc ceiling; sequential per chunk since the ceiling makes fan-out pointless; new test asserts the ceiling fires on the `in` path |
| Minor | `truncated` public-contract docs lied — "capped at maxContracts" in the service and shared `contract-availability.types.ts`, but it now also means "ceiling fired" | **Fixed** — both JSDoc sites updated |
| Minor | Dead page machinery in the test fake — `limit()`/`startAfter()`/`limitN`/`afterDoc`/`QueryMeta.limit`/`startAfter` no longer called by the service | **Fixed** — removed; `QueryMeta` keeps `orderBy` + `via` |
| Minor | No assertion that early exit actually cancels the stream — `streamed.count` proves consumption stopped, not that `return()`/`destroy` reached the resource | **Fixed** — fake generator `finally` counts early closes; ceiling test asserts `streamed.cancelled === 1` |
| Minor | Stale terminology — verify-script header said 50k (ceiling is 25k); guide said "paging"; README execution-order said ~100k vs row's ~50k | **Fixed** — all aligned to streamed scan / 25k / ~50k |
| Minor | Tautological assertion `strike >= 0` in the verify script | **Fixed** — now also asserts non-empty result set |
| Nit | `q.stream() as unknown as AsyncIterable<DocumentSnapshot>` — literal hit on the no-`as unknown as` checklist | **Accepted** — the SDK types `stream(): NodeJS.ReadableStream` which omits `[Symbol.asyncIterator]`; runtime is an object-mode Readable. Documented in `scan()` JSDoc — the cast is the single seam |
| Nit | Duplicated scan-loop skeleton across the two fetch methods | **Fixed** — extracted `scanBounded(q, visit)`; both paths plus the `in` path share it |
| Nit | Mid-stream error discards `matched` → propagates to 500 | **Accepted + documented** — honest failure, no silent partial results; JSDoc notes it |

### Accepted as-is

| Sev | Finding | Disposition |
|---|---|---|
| Info | Stream exhausting exactly at the ceiling reports `truncated` — can't prove exhaustion without reading one more doc | Accepted — conservative, never wrong |
| Info | `filtered.sort()` on ordered-scan output is redundant (already in response order) | Accepted — idempotent, keeps one sort contract |

## Test results

- Focused suite: 29 tests (incl. `in`-path ceiling + stream-cancellation assertions)
- Full suite: **102 suites / 1,127 tests — green**
- `tsc --noEmit` (functions + scripts): clean
- `npm run build:shared` run after the shared types doc edit
- Prod verify (`options-data-251-availability-read-ceiling.ts`, QQQ):
  `strikeGte=0` → 34.9s/55.7s across two runs (network variance — both
  under the 60s budget; in-function same-region reads are much faster),
  `firstObservedLte=2999-12-31` → 39.5s/43.5s, both `truncated=true`
  (ceiling fired), narrow range 0.6s untruncated

## Review pass 2 (post-fix re-review)

A second three-axis pass ran on the post-fix diff.

| Axis | Verdict |
|---|---|
| Standards | PASS WITH MINORS |
| Spec | PASS |
| Thermo-nuclear | PASS WITH MINORS |

### Fixed during pass 2

| Sev | Finding | Disposition |
|---|---|---|
| Minor | `for await` break does NOT cancel the gRPC `runQuery` RPC — verified against `@google-cloud/firestore@7.11.3` internals: the consumer `Transform` is destroyed but `pipe()` doesn't forward destroy upstream; the RPC pauses on flow-control backpressure and closes on server idle timeout. Billed reads still bounded — the ceiling's purpose holds — but the class/scan JSDoc, verify guide, and this doc all overclaimed "cancels the server-side read" | **Fixed** — all four docs now state the actual semantics; test-fake `cancelled` renamed `closed` (asserts consumer-side iterator close, which is what exists) |
| Minor | Per-chunk ceiling reset on the `expirations` path — `scanBounded` declared `scanned` per call, so the bound was per-chunk (N×25k), not per-request. Moot via HTTP (`MAX_EXPIRATIONS_LIST = 30` → single chunk) but silently scaled for non-parser callers | **Fixed** — `scanBounded` takes a shared `{ scanned }` budget; `fetchByExpirationList` threads one across chunks. New test: neither chunk alone reaches ceiling 5 but the shared budget does |
| Minor | `fetchByPrimaryRange` param typed `RangeField` (includes `'expiration'`) — a future caller passing it would get a silently unfiltered scan | **Fixed** — narrowed to `'firstObserved' | 'strike'` — misuse now fails at compile time |
| Minor | Stale ">50k matching docs" in verify guide (:31, :45, failure modes) | **Fixed** — ">25k scanned docs" |
| Nit | Dead `via: 'get' | 'stream'` union member in test `QueryMeta` | **Fixed** — `via: 'stream'` |
| Nit | `AsyncIterable<DocumentSnapshot>` — `stream()` yields `QueryDocumentSnapshot` | **Fixed** — precise type |
| Nit | Class JSDoc named only 2 of the 4 composite indexes used | **Fixed** — all four listed |
| Nit | Test comment claimed "no doc passes the step" — doc C9 (strike 510) does; the ceiling stops the scan first | **Fixed** — comment corrected |

### Accepted / info

- Exact-ceiling exhaustion reports `truncated` (conservative, never wrong).
- Verify script doesn't exercise the `in`-path ceiling or `type`-filtered composite variants prod-side — unit-tested; acknowledged in the guide.
- The lingering-RPC nuance is a resource footnote, not a billing or correctness issue — no public SDK API to cancel exists; not actionable in-repo.

Pass-2 verdict: **PASS** — focused suite 30/30, `tsc` clean.

## Verdict

**PASS** — all ACs met (first via a justified, measured deviation);
the single major finding (`in`-path bound) and all pass-2 minors were
fixed during review. Task advances to `7_QA`.
