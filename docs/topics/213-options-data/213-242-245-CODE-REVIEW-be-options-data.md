**Topic:** Options Corpus Bulk Ingest  
**Topic Slug:** options-corpus-bulk-ingest  
**Thread:** Contract Availability Endpoint  
**Thread Slug:** availability-endpoint  
**Issue:** #245  
**Thread Parent:** #237  
**Topic Parent:** #213  
**Task:** #245  
**Domain:** BE  
**Type:** Code Review  
**Status:** Complete  
**Created:** 2026-10-30  
**Last Updated:** 2026-10-30

# Code Review — Task #245: `partnerContractAvailabilityV1` handler + wiring

## Scope

| File | Change |
|---|---|
| `functions/src/v2/partner/contract-availability-partner.ts` | NEW — handler + `onRequest` export (512MiB/60s/max20, partner secrets) |
| `functions/src/v2/partner/contract-availability-request.utils.ts` | MOD — `MAX_EXPIRATIONS_LIST = 30` cap + rejection |
| `functions/src/index.ts` | MOD — export line (other pending diffs are unrelated work) |
| `functions/tests/v2/partner/contract-availability-partner.test.ts` | NEW — 20 tests |
| `functions/tests/v2/partner/contract-availability-request.utils.test.ts` | MOD — cap boundary test |
| `docs/topics/213-options-data/213-237-239-IMPL-be-availability-endpoint.md` | MOD — amended decision 2 for the cap |
| `docs/topics/213-options-data/213-237-239-TEST-be-availability-endpoint.md` | verified already consistent with cap |

## Axis results

| Axis | Verdict |
|---|---|
| Standards | PASS WITH MINORS |
| Spec | PASS WITH MINORS |
| Thermo-nuclear | PASS WITH MINORS |

## Findings and dispositions

### Fixed during review

| Sev | Finding | Disposition |
|---|---|---|
| Minor | Log events used `contractAvailability.*` prefix vs sibling family convention (`partnerContractCatalog.*`, `partnerListContracts.*`) | **Fixed** — renamed all 5 sites to `partnerContractAvailability.*` |
| Minor | IMPL doc decision 2 still described chunked-accept for `expirations` >30 | **Fixed** — doc amended to record the T3 cap decision (`MAX_EXPIRATIONS_LIST = 30`, 400 on overflow); TEST doc already consistent |
| Info | Error-envelope `timestamp` never asserted despite injected `now` | **Fixed** — 400 test now asserts `timestamp: FIXED_NOW.toISOString()` |

### Accepted / documented

| Sev | Finding | Disposition |
|---|---|---|
| **Major (inherited)** | Unbounded single `get()` on `firstObserved`/`strike`-primary queries — `?symbol=QQQ&strikeGte=0` can materialize the full ~395k-doc collection → likely 60s timeout/OOM. Ordered-scan path: dense range + sparse post-filter can scan all pages before cap+1. Inherited from #244's design; #245 is the first live caller. Fails loud (500), never wrong data | **Follow-up task created: #251** — paged primary-range scan + scanned-doc ceiling + honest `truncated`. Do NOT cap range width at parser (legitimate queries). Accepted for ship: discovery endpoint, low partner volume, loud failure mode |
| Minor | Validation order differs from V2 — this handler validates ALL params before the optionsEnabled gate (V2 gates after symbol only) | **Accepted** — deliberate; validating input shape before the resource gate is more correct and simpler (gate needs the parsed symbol). Spec doesn't mandate order |
| Minor | Empty-string params treated as absent, not malformed (`?expirationGte=` ignored) | **Accepted** — parser's documented `rawScalar` semantics; internally consistent |
| Nit | Repeated params take `value[0]` silently (`expirations=d1&expirations=d2` uses only d1) | **Accepted** — consistent with every sibling parser; documented in code |
| Nit | Defensive `lastUpdated` strip in handler is dead per declared types (service strips; `ContractCatalogEntry` already omits it) | **Kept** — mirrors V2 parity; commented + tested as contract guarantee |
| Nit | Cap error message inline vs named `EXPIRATIONS_ERROR` const | **Accepted** — cosmetic symmetry only |
| Info | PRD mentions `historical-options-corpus/` while code + docs use canonical `historical-options/v1/` | **Noted** — PRD documents original intent; code/docs are self-consistent on the canonical prefix |

### Verified-clean (thermo axis, checked against real code)

- `authenticateRequestEither` writes 401/403 itself and returns null — `if (!authResult) return` does not double-write; `'serviceAccountEmail' in authResult` correctly splits
- Function options (512MiB/60s/max20/secrets) match IMPL line 38's explicit bump; secrets objects identical to V2's
- `getStorage().bucket(optionsCorpusBucket())` → `av-hist-options-corpus-bucket`; `CorpusDatesBucket` structural fit proven by existing `storage-file-viewer` getFiles destructure
- `Promise.all` — both reject-handlers attached eagerly; independent reads correctly parallel
- Response shape == `ContractAvailabilityResponse` (7 fields, no extras); `lastUpdated` strip compiles and is proven by test
- 404 + `OPTIONS_NOT_ENABLED` gate code — deliberate IMPL-locked divergence from V2's 400
- 30-cap equals `IN_CHUNK_SIZE` — exactly one `in` chunk; service chunker retained as defense-in-depth
- `SYMBOL_PATTERN` excludes `/` — safe Firestore doc ids

## Verification evidence

- Focused: **36/36** availability tests (20 handler + 16 parser) · `tsc --noEmit` clean
- Full suite: 99 suites / 1,067 tests green
- **Real prod smoke** (throwaway script, deleted): handler → real `ContractAvailabilityQueryService` + `CorpusDatesService` → `200`, 1,670 COST puts only, `lastUpdated` absent, 532 corpus dates, ~18s (well under 60s)
- Caveat recorded for #246: real GCS calls need `GCLOUD_PROJECT=alpha-vantage-proxy-api` (default ADC resolves the dev project → OAuth token fetch fails)

## Handoff to #246 (verify script task)

- Permanent verify script should cover: auth paths (401/403), optionsEnabled 404, envelope shape, expirations cap boundary, a firstObserved/strike-primary query (bounds the new index paths), and the GCLOUD_PROJECT prerequisite.
- Deployed function needs IAM `run.invoker` for the partner SA group post-deploy (same as V2 — runbook note).

## Verdict: **PASS**

All acceptance criteria met and observed in tests; all actionable findings fixed or dispositioned. One inherited Major (#251) tracked as follow-up — not blocking: loud failure, low-volume endpoint, designed trade-off in #244.

## Re-review — 2026-10-30 (second pass)

Re-read of both session files (`contract-availability-partner.ts`, `contract-availability-request.utils.ts`) against sibling conventions, plus focused test re-run (36/36 green).

| Check | Result |
|---|---|
| `requestId` echoed in response / `Cache-Control` header | V2 parity — neither sibling does either; no finding |
| 405-before-auth ordering | V2 parity (method check precedes `authenticateRequest` in both) |
| `expirations` list hygiene | `parseOptionalDateList` validates every element as a real date, dedupes via `Set`, sorts ascending — verified, no finding |
| Range params validated before `expirations` override | Accepted — a malformed range 400s even though the list would discard it; rejecting malformed input beats silently dropping it |
| Git state | Session files = handler (new), handler test (new), parser +10, parser test +9, `index.ts` +2 lines; unrelated edits (`iv-rank`, `ts-build-*`, ops) correctly excluded from this task's scope |

**Housekeeping fix made during this pass:** duplicate QA issue #253 was created in error during the first review's gate bookkeeping (the real QA issue #252 already existed, QA'd, and closed). #253 closed as duplicate, removed from #213's children, and the anchor index corrected to `#245 → QA #252 — QA PASS` with the UAT doc link.

**Conclusion:** no new code findings. Another pass is not needed — remaining candidates are documented nits accepted by disposition.
