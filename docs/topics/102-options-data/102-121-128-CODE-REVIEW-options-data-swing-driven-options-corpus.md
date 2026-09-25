**Topic:** Swing-driven options corpus platform  
**Topic Slug:** swing-driven-options-corpus  
**Thread:** Swing-set generation platform  
**Thread Slug:** swing-set-platform  
**Issue:** #121  
**Thread Parent:** #103  
**Topic Parent:** #102  
**Task:** #128  
**Domain:** OPTIONS-DATA  
**Type:** Code Review  
**Status:** Complete  
**Created:** 2026-09-25  
**Last Updated:** 2026-09-25  

---

# Code Review — Task #128: partnerSwingSetsV2

Three axes reviewed: `partner/swing-sets-partner.ts`, its test, `options-data-128-partner-swing-sets.{ts,md}`, the `index.ts` export, and partner docs registration.

## Standards

- Byte-identical envelope + error-envelope, deps-injection seam, dual-auth ordering, and secret usage vs `historical-options-partner.ts`. `SwingSetsErrorCode` follows the string-enum pattern.
- **Fixed:** no `SYMBOL_PATTERN` validation (historical parity) — now `400` on malformed symbols; `PARAMS_ID_PATTERN` added since paramsId is interpolated into a doc id.
- **Fixed:** header overpromised "all canonical docs" while `listBySymbol` returns every doc for the symbol — now filters to `CANONICAL_PARAMS_IDS`; docstring documents partial sets.
- **Fixed:** sparse rejection logging — `warn` on each rejection path + `swingSets.response` with doc counts (parity with `historicalOptions.response`).

## Spec

- All ACs met: registered in `index.ts`; envelope matches; `OPTIONS_NOT_ENABLED` (403 — spec doesn't pin a status; consistent with FORBIDDEN) and `NOT_FOUND` paths tested; sole external read path.
- **Fixed:** partner docs registration gap — added rows to `partner-endpoint-inventory.md`, `partner-discovery.md`, the deploy-list in `partner-auth-and-audience.md`, and `deploy-partner-endpoint.md`.
- `data` keyed by `paramsId` (omitted-paramsId) and 404 on enabled-but-empty are judgement calls the spec leaves open — both documented and tested.

## Thermo-nuclear

- **Fixed (minor):** free-form `paramsId` could address nested Firestore paths → `PARAMS_ID_PATTERN` guard; `?paramsId=a&paramsId=b` fails it too.
- **Fixed (minor):** non-canonical docs filtered from the all-docs response; partial-map documented (canonical four is fixed today).
- **Fixed (minor):** spy assertions — unused dep (`getSwingSet`/`listSwingSets`) asserted `not.toHaveBeenCalled()` per branch.
- Accepted: uncached `getTrackedFlags` doc-get (fresher for the optionsEnabled gate); module-scope repository (stateless, warm-reuse); no `MAX_RESPONSE_BYTES` (docs capped at 1 MiB each, ~4 MiB worst case).

## Test results

- `tests/v2/partner/`: **16/16** new endpoint tests (incl. malformed symbol/paramsId, canonical filter, partial map, spy assertions); **111/111** across partner suite.
- Verify script: **PASS** against prod — every gate + response shape, full cleanup incl. `symbol-data/ZZTEST`.
- Build clean.

## Verdict

**PASS** — all ACs; minors fixed. Deploy: `firebase deploy --only functions` — no new secrets (reuses `ALLOWED_SERVICE_ACCOUNT_EMAILS` + `EXPECTED_GOOGLE_AUDIENCE`).
