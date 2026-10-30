**Topic:** Options Corpus Bulk Ingest  
**Topic Slug:** options-corpus-bulk-ingest  
**Thread:** Contract Availability Endpoint  
**Thread Slug:** availability-endpoint  
**Issue:** #242  
**Thread Parent:** #237  
**Topic Parent:** #213  
**Task:** #244  
**Domain:** BE  
**Type:** CODE-REVIEW  
**Status:** Complete  
**Created:** 2026-10-30  
**Last Updated:** 2026-10-30

# Code Review — Task #244: Availability data services (query + corpus-dates)

Scope: `functions/src/v2/historical-options-corpus/services/contract-availability-query.service.ts` (new),
`functions/src/v2/historical-options-corpus/services/corpus-dates.service.ts` (new),
`functions/tests/v2/historical-options-corpus/contract-availability-query.service.test.ts` (new),
`functions/tests/v2/historical-options-corpus/corpus-dates.service.test.ts` (new),
`functions/scripts/verify/options-data-244-availability-services.ts` (new),
`functions/scripts/verify/options-data-244-availability-services.md` (new),
`firestore.indexes.json` (+2 composite indexes — review-driven fix).

Three axes ran in parallel (Standards, Spec, Thermo-nuclear). Verdict
below reflects post-fix state.

## Thermo-nuclear — PASS (after fixes)

**Critical — found and fixed:**

- **Missing composite indexes → `FAILED_PRECONDITION` on valid input.**
  `type ==` is pushed server-side on every query path, and the primary
  range can be `firstObserved` or `strike`. Every existing `type`-leading
  composite index on `ts-contracts` pairs it with `expiration` — so
  `?type=put&firstObservedGte=…` and `?type=put&strikeGte=…` would have
  thrown on prod (the verify script only exercised the covered
  `type`+`expiration` combo; the FakeQuery can't see index requirements).
  **Fix:** added `(type ASC, firstObserved ASC)` and
  `(type ASC, strike ASC)` composite indexes on the `ts-contracts`
  collection group to `firestore.indexes.json`. **Deploy dependency:**
  indexes must be deployed (`firebase deploy --only firestore:indexes`)
  before the #245 handler goes live — flagged for the ship step.

**Majors — dispositioned:**

- **Unbounded full-subcollection read** (no `.limit()` before in-memory
  cap). Accepted as spec'd — the IMPL explicitly mandates
  read-all→sort→cap because a server-side `limit` cannot guarantee
  `maxContracts` results after post-filtering. **Real prod data point:**
  unfiltered `?symbol=QQQ` scanned ~7 min on run one and hit Firestore's
  streaming timeout on run two (QQQ's catalog is ~50k+ docs). The
  suggested `orderBy+limit` fast path for the bare-`{symbol}` case would
  itself need a new 3-field composite index (none of
  `expiration+strike+contractId` exists), so it was not taken.
  **Handoff to #245:** decide between required-minimum filters, raised
  function timeout/memory, or response caching; also consider an
  `expirations` list length cap in the parser (unbounded today →
  unbounded sequential `in`-chunk queries).
- **Third corpus-listing implementation.** `GcsCorpusAdapter.listItems`,
  `StorageFileViewerService.listCorpus`, and now `CorpusDatesService`
  all walk `historical-options/v1/{symbol}/`. Kept as a dedicated
  service deliberately: its contract differs (strict `isValidIsoDate`
  calendar validation, nested-path exclusion, sorted dates-only output)
  AND its structural `CorpusDatesBucket` dep keeps it unit-testable
  without the adapter's bucket/prefix wiring. Delegating to `listItems`
  would weaken semantics (its regex accepts `2026-13-40` and matches
  nested paths). Recorded as known debt — a future consolidation should
  extract one strict listing primitive.

**Minors — fixed:**

- Service JSDoc claimed a "+1 read" truncation mechanism that doesn't
  exist (reads are unbounded) — reworded to match reality.
- `postFilter`'s fused guard (`primary !== 'expiration' &&
  expirations === undefined`) now carries a comment stating the
  parser-mutual-exclusivity contract.
- Dead `filters.expirations ?? []` fallback removed (caller guarantees
  presence).
- `strikeStep < 0.005` → `stepCents = 0` → filter silently skipped.
  Analyzed rather than "fixed": every cent-quantized strike passes a
  sub-cent grid anyway for realistic inputs, and the parser enforces
  `step > 0`; documented approximation per the "evaluated in cents"
  contract. No code change.
- `FakeQuery` was blind to document paths — now records
  `collection/doc/collection` segments; new test asserts
  `options-file-index/QQQ/ts-contracts` and lowercase-symbol
  normalization.
- Coverage gaps added: `expirations: []` (zero queries issued),
  `expirations` + `firstObserved` post-filter, `expirations` +
  stray `expirationGte` (range correctly ignored — parser contract),
  corpus-date dedup across pages, same-`pageToken` loop guard.

## Standards — PASS (after fixes)

**Minors — found and fixed:**

- Test file covered two services under one filename — split:
  `corpus-dates.service.test.ts` now holds the `CorpusDatesService`
  suite (per-service naming convention).
- `as never` casts on the fake bucket — eliminated by typing the fake
  as `CorpusDatesBucket` directly (the structural interface exists for
  exactly this).
- Verify-script header overstated a check (`>= 2026-01-01` — real
  corpus reaches 2019) — corrected.
- `--symbol` parsing accepted another flag as its value — now uses the
  `argOf` guard convention from sibling verify scripts.
- Hardcoded `2000` in the verify script → `CONTRACT_AVAILABILITY_MAX_CONTRACTS`.

**Clean (explicit):** Firestore SDK contract (`in` ≤ 30, single range
field per query, valid 3-segment path, Map dedupe), GCS pagination
(faithful copy of the proven `listCorpus` pattern incl. same-token
guard), never-null return contract, no dead code, no secrets, no
handler wiring leaked (that's #245).

## Spec — PASS

All 10 acceptance criteria verified MET with file:line evidence:

1. Primary-range precedence `expiration > firstObserved > strike` —
   `selectPrimaryRange` + per-branch `where`s; others post-filtered.
2. `expirations` overrides the expiration range (parser drops the
   fields; service defends in depth).
3. `in` chunked at 30, merged, deduped by `contractId`.
4. `strikeStep` in integer cents (`Math.round(x*100) % stepCents`).
5. Sort: `expiration asc → strike asc → contractId asc`.
6. Cap+1 semantics: `truncated` when matches exceed 2000.
7. `lastUpdated` stripped → `ContractCatalogEntry`.
8. Corpus dates: `historical-options/v1/{SYMBOL}/` prefix, `.json.gz`
   + strict `YYYY-MM-DD`, nested excluded, sorted dates only.
9. Unit tests use in-memory fakes, not the SDK/emulator.
10. No handler wiring (correctly deferred to #245).

Result-equivalent deviations (noted, not violations): `type` equality
is pushed server-side rather than filtered in memory; truncation is
detected by `filtered.length > cap` rather than a literal cap+1 read
(required by the read-all design).

## Test results

- Focused suites: **23/23 green** (18 query-service + 5 corpus-dates).
- Full suite: **97 suites / 1,037 tests green.**
- `npx tsc --noEmit` (src + scripts tsconfigs): clean.
- Prod verify script: **PASS on COST** (13/13 asserts — 2,000 contracts
  truncated, 45 puts on 2019-01-25, 178 on two-expiration list, $10
  grid, 532 corpus dates). QQQ run one: all query asserts passed (~7
  min); run two hit Firestore streaming timeout on the unfiltered scan
  — recorded as the #245 handoff risk.

## Pass 2 — re-review of post-fix code (all three axes)

**Design change during pass 2 (author-driven):** the service was
rewritten from unbounded-read → **ordered paging** — for the
expiration-primary and unfiltered paths it now scans in response order
(`orderBy(expiration, strike, __name__).limit(pageSize)` + `startAfter`
cursor, post-filtering each doc, early-exit at `maxContracts + 1`
matches). An unfiltered `?symbol=QQQ` reads ~2,001 docs instead of the
full ~395k collection — using only the pre-existing
`(expiration, strike)` and `(type, expiration, strike)` composite
indexes. `firstObserved`/`strike` primaries keep the single-`get()`
range path (the range bounds the read; its stream order is not the
response order, so early-exit would be incorrect there). Five new tests
pin the paging semantics; the earlier unbounded-read major is
substantially mitigated for the dominant request shapes.

**Spec axis — PASS.** Enumerated every reachable server-side where
combination against `firestore.indexes.json`: all covered (incl. the
ordered path's `(type, expiration, strike)` and `(expiration, strike)`
requirements — both pre-existing). New index entries valid
(JSON/schema/field-order). No AC regressed.

**Thermo-nuclear axis — PASS.** Verified the index fix is the right
fix (post-filtering `type` would double reads on the costliest axis —
`type` cardinality is 2, the best available reducer). No dispositioned
finding overturned. Minors applied: `expirations` narrowed via param
(`as string[]` removed); `in`-chunk fetches parallelized
(`Promise.all`); verify-script `truncated` assert corrected
(`!truncated || length === MAX`); two asserts added exercising the NEW
index paths (`type`+`firstObserved`, `type`+`strike`) — they will fail
until `firebase deploy --only firestore:indexes` runs, intentionally.

**Standards axis — PASS.** All six pass-1 fixes verified real.
Minors applied: new index entries moved to canonical lexicographic
position (end of the `type` block); stale `historical-options-corpus/`
prefix corrected to `historical-options/v1/` in the shared types doc.
Remaining nits accepted: `argOf` doesn't fail-loud like #223's (benign
for a read-only script); `maxResults` unasserted in the bucket fake.

## Verdict: **PASS**

The one critical (missing composite indexes) is fixed in-repo; the
indexes file needs deploying before the endpoint goes live. All
minors addressed or dispositioned with reasoning. The unbounded-read
design risk is spec-accepted and explicitly handed to Task #245.
