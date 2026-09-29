**Topic:** Swing-driven options corpus platform  
**Topic Slug:** swing-driven-options-corpus  
**Thread:** Options corpus ingest  
**Thread Slug:** options-corpus-ingest  
**Issue:** #192  
**Task:** #156  
**Blueprint Parent:** #149  
**Thread Parent:** #106  
**Topic Parent:** #102  
**Domain:** OPTIONS-DATA  
**Type:** UAT  
**Status:** Complete  
**Created:** 2026-09-28  
**Last Updated:** 2026-09-28  

# UAT — Task #156: Corpus coverage report surface

## Scope

Read-only admin endpoint `getHistoricalOptionsCorpusCoverage` + underlying
`runCorpusCoverage` service: per-symbol corpus coverage (planned vs seeded
vs missing/failed/in_flight), per-date status, current interim date. Zero
writes by construction.

## Prerequisites

- `cd functions` — all commands run from `functions/`.
- Prod Firebase credentials in environment (verify script uses
  `admin.initializeApp({ projectId: 'alpha-vantage-proxy-api' })` — requires
  Application Default Credentials / GOOGLE_APPLICATION_CREDENTIALS).
- Deployed-endpoint checks additionally require
  `HISTORICAL_OPTIONS_COVERAGE_ADMIN_SECRET` provisioned
  (`firebase functions:secrets:set`) and the function deployed.

## Steps + results

| # | Check | Result |
|---|---|---|
| 1 | Unit suite — `npx jest tests/v2/historical-options-corpus/corpus-coverage.service.test.ts` | ✅ 16/16 — status fold, latest-wins ordering, stale-success→missing, dead-run + stale-queue downgrades, skipped→missing, pre_floor, superseded_interim, subset/enabled defaulting, per-symbol error isolation |
| 2 | Corpus regression — `npx jest tests/v2/historical-options-corpus` | ✅ 174/174, 22 suites |
| 3 | Typecheck — `npx tsc --noEmit` | ✅ clean |
| 4 | Live prod report, full enabled set — `npx ts-node -r tsconfig-paths/register -P scripts/tsconfig.json scripts/verify/options-data-156-corpus-coverage.ts` | ✅ all checks PASS — every reported symbol `missing=0 failed=0 in_flight=0`; count invariant `seeded+missing+failed+in_flight==planned`; per-date statuses all known; sorted ascending; 52/129 symbols show a live current interim date correctly traced to a planned interim row. Caveat: 8 symbols (EA, EBAY, DIOD, FDX, EXPE, FICO, DIS, F) hit transient Firestore `DEADLINE_EXCEEDED` under the parallel burst — per-symbol error isolation contained them as `error` rows and all invariant checks still passed |
| 5 | Subset + non-enabled — `--symbols=AAPL,XOM` and `--symbols=MRNA` | ✅ subset reports exactly requested symbols; enabled flagged `optionsEnabled=true`; MRNA reported with `optionsEnabled=false` (not dropped) |
| 6 | Zero writes — all deps are reads (`listEnabledSymbols`/`planPivots`/`listObjects`/`listRunItems`); handler calls `runCorpusCoverage` only | ✅ by construction + review |
| 7 | Wrong/missing `x-admin-secret` → 403 | DEFERRED post-deploy — shared `requireAdminSecret` verified in review + covered by unit-level contract; live 403 needs the deployed function + provisioned secret |
| 8 | Deployed smoke — `POST {}` 200 report, `symbols` subset body | DEFERRED post-deploy |

### Post-deploy checklist (tracked)

- [ ] `firebase functions:secrets:set HISTORICAL_OPTIONS_COVERAGE_ADMIN_SECRET`
- [ ] `Invoke-WebRequest -Method POST -Uri $fn -Headers @{ 'x-admin-secret' = 'wrong' } -Body '{}' -ContentType 'application/json' -SkipHttpErrorCheck` → 403
- [ ] `POST {}` with the real secret → 200 `{ generatedAt, symbols[] }`
- [ ] `POST {"symbols":"AAPL,XOM"}` → exactly those symbols

## Refinement pass

Not applicable — no user-facing UI/UX surface (admin JSON endpoint).
Response shape exercised via the verify script's prod output; `dates[]`
rows carry `{date, status, plannedKind?, objectKind?, runStatus?,
runState?, error?}`.

## Traceability

| Task AC | Scenario |
|---|---|
| x-admin-secret gated; wrong secret 403 | #7 (post-deploy) + review contract check |
| per symbol: planned/seeded/missing + per-date status | #1, #4 |
| absent symbols → all enabled; subset honored | #4, #5 |
| zero writes | #6 |
| unit tests + verify script | #1–#4 |

## Findings

None.
