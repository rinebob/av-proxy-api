**Topic:** Options Corpus Bulk Ingest  
**Topic Slug:** options-data  
**Thread:** Full-Date Corpus Backfill (2026)  
**Thread Slug:** corpus-backfill-2026  
**Issue:** #241  
**Thread Parent:** #214  
**Topic Parent:** #213  
**Task:** #223  
**Domain:** BE  
**Type:** UAT  
**Status:** Complete  
**Created:** 2026-10-29  
**Last Updated:** 2026-10-29  

# UAT — Task #223: Materialization fanout (per-symbol)

QA issue: #241 · Code review: `213-218-223-CODE-REVIEW-be-options-data.md`
(verdict: PASS, 2 passes converged)

## Scenario execution log

### S1 — Unit coverage (focused suite) — PASS

`npx jest tests/v2/historical-options-corpus/pick-materialize.service.test.ts`
→ **12/12** green. Covers: coverage iteration (sort/dedupe/2026-01-01
floor, one chain load per date), explicit-dates bound, symbol
normalization, empty-dates early return, 380-cell fanout, real-picker
pick propagation, `no_chain` on absent chain, per-date load-failure
isolation, closes-load degradation, idempotent re-run, `no_chain`→pick
repair.

### S2 — Full suite + typecheck — PASS

- Full suite (run at implementation): **94 suites / 982 tests** green.
- `npx tsc --noEmit` — clean (re-run post-review fixes).

### S3 — Prod verify: full QQQ materialization — PASS

`options-data-223-materialize-picks.ts --symbol QQQ` on real prod:

- 207 stored corpus dates walked, 207 picked, 0 load failures
- **380** `QQQ-*/years/2026` cell docs materialized, `gridVersion=1` on all
- **78,660** day entries written (**77,900** picks)
- Idempotent re-run: `daysWritten=0`, 78,660 skipped — zero writes

### S4 — Prod verify: `--date` single-date bound — PASS

`--symbol QQQ --date 2026-10-20` / `2026-10-21` (final script, post
`argOf` hardening): bounded run walks only that date, day-count scoped
correctly (380/380), re-run no-op. Confirms the payload shape #224's
nightly append reuses.

### S5 — Caller surface — PASS

- `processOptionsDeltaPickMaterializeTask` + `triggerDeltaPickMaterialize`
  exported from `functions/src/index.ts`; `materializeSymbolPicks` via
  the services barrel — `tsc` resolves all.
- Trigger enqueue path: `allSymbols` → `listOptionsEnabledSymbols` →
  Cloud Tasks — mirrors `triggerHistoricalOptionsTimeSeriesBuild`; live
  enqueue is a post-deploy exercise (queue doesn't exist pre-deploy).

## Acceptance-criteria traceability

| Issue #223 AC | Scenario | Result |
|---|---|---|
| `{symbol}` covers all stored corpus dates, floor 2026-01-01 | S1 + S3 (207 dates) | PASS |
| Ops trigger: one task per enabled symbol; GCS reads only, no AV calls | S5 (deps carry no AV client) | PASS |
| Idempotent re-run writes nothing; miss-status dates re-attempted | S1 + S3 | PASS |
| QQQ end-to-end: all 380 cell docs materialize | S3 | PASS |
| Unit tests: coverage iteration + per-date chain-load failure | S1 | PASS |

## Refinement pass

N/A — backend-only task; no user-facing surface.

## Findings

None unresolved. In-review fixes (3, across 2 review passes):
malformed/non-string `date` silently widened to full-corpus enqueue →
400; valueless `--date` flag silently widened verify run → fail-fast.
Documented nits: picker-throw aborts run (caller contract), tx failure →
task-level idempotent retry, core doesn't re-guard empty `symbol`.

## Deploy prerequisite (tracked on QA #241)

`HISTORICAL_OPTIONS_PICK_MATERIALIZE_ADMIN_SECRET` must exist in Secret
Manager before the trigger deploys — flagged for `/proj ship`.

## Verdict: QA PASS
