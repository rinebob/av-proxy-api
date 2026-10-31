**Topic:** Options Corpus Bulk Ingest  
**Topic Slug:** options-corpus-bulk-ingest  
**Thread:** Contract Availability Endpoint  
**Thread Slug:** availability-endpoint  
**Issue:** #252  
**Thread Parent:** #237  
**Topic Parent:** #213  
**Task:** #245  
**Domain:** BE  
**Type:** UAT  
**Status:** Complete  
**Created:** 2026-10-30  
**Last Updated:** 2026-10-30

# UAT — Task #245: `partnerContractAvailabilityV1` handler + wiring

## Scope

The partner-facing GET endpoint: `partnerContractAvailabilityV1` — auth
identical to `partnerContractCatalogV2`, `optionsEnabled` → 404, #243
parser → 400 envelope, #244 services → combined
`{contracts, truncated, corpusDates}` response.

## Prerequisites

- Working tree at post-review state of #245.
- `cd functions`; `GCLOUD_PROJECT=alpha-vantage-proxy-api` for real GCS/Firestore.
- New composite indexes (type+firstObserved, type+strike) deployed + READY — done 2026-10-30.

## Scenarios

### S1 — Focused suites
```
cd functions; npx jest tests/v2/partner/contract-availability
```
Expected: 2 suites green (handler 20 + parser 16+).

### S2 — Full suite + typecheck
```
cd functions; npx jest; npx tsc --noEmit; npx tsc --noEmit -P scripts/tsconfig.json
```
Expected: all green.

### S3 — Export + function options (static)
- `index.ts` exports `partnerContractAvailabilityV1` from `./v2/partner/contract-availability-partner`
- `functionOptions`: `512MiB` / `timeoutSeconds: 60` / `maxInstances: 20` / secrets `[allowedServiceAccounts, expectedGoogleAudience]`

### S4 — Real end-to-end (handler over prod deps)
Drive `partnerContractAvailabilityHandler` with real
`ContractAvailabilityQueryService`/`CorpusDatesService`/`createOptionsEnabledChecker`;
mock only `authenticateRequest` (+`now`). Checks:
1. `POST` → 405
2. auth `null` → no response written (401 seam)
3. non-SA auth → 403 `FORBIDDEN`
4. `symbol=NOSUCHSYM1` (valid pattern, not enabled) → **404 `OPTIONS_NOT_ENABLED` via the real Firestore gate**
5. `?symbol=cost` (lowercase) → 200, `symbol: 'COST'`
6. `?symbol=COST&type=put&expirationGte=2026-01-01&expirationLte=2026-03-31` → 200, only puts, in range, no `lastUpdated`, `corpusDates` ascending
7. `expirations=` 31 dates → 400 cap
8. `type=bogus` → 400

### S5 — Deployed-function check (deferred)
The function is not yet deployed; post-deploy: grant `run.invoker` to the partner
SA group, then a real HTTPS call (#246's verify script owns this).

## Traceability

| AC | Scenario |
|---|---|
| Export + options | S3 |
| Auth 401/403 | S4 (1,2,3) + unit |
| optionsEnabled → 404 | S4 (4) + unit |
| 400 envelope | S4 (7,8) + unit |
| Response shape + strip | S4 (5,6) + unit |
| Injectable deps | unit tests |
| Tests pass | S1, S2 |

## Results

| Scenario | Result | Evidence |
|---|---|---|
| S1 focused | PASS | 36/36 (handler 20 + parser 16) |
| S2 full+tsc | PASS | 99 suites / 1,070 tests; `tsc --noEmit` clean (main + scripts) |
| S3 static | PASS | `index.ts:46` export; functionOptions = 512MiB/60s/max20/partner secrets |
| S4 real e2e | PASS | 13/13 — real services + real gate: 405, 401 seam (no write), 403, **404 `OPTIONS_NOT_ENABLED` on real Firestore lookup**, lowercase→200 `COST`, filtered puts-only in range, no `lastUpdated`, full envelope, ascending corpusDates, >30 expirations → 400, bad type → 400 |
| S5 deployed | DEFERRED | pre-deploy; #246 owns the deployed-call verify + `run.invoker` grant |
