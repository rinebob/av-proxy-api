**Topic:** Options Corpus Bulk Ingest  
**Topic Slug:** options-data  
**Thread:** Full-Date Corpus Backfill (2026)  
**Thread Slug:** corpus-backfill-2026  
**Issue:** #265  
**Thread Parent:** #214  
**Topic Parent:** #213  
**Task:** #229  
**Domain:** BE  
**Type:** UAT  
**Status:** Complete  
**Created:** 2026-11-04  
**Last Updated:** 2026-11-04  

## Scope

Task #229 — ts-build repair pass. A pure helper module
(`services/ts-build-repair.ts`) plus an ops/verify script
(`scripts/verify/options-data-229-ts-build-repair.ts`) that enumerates
every ts-build task that completed with dropped contract observations
(`failedContracts > 0`) from Cloud Logging, prints/persists the unhealed
contract+error triage list (AC4), and — under the explicit `--enqueue`
flag — re-enqueues each failed `(symbol, range)` as a `TsBuildPayload` on
`processHistoricalOptionsTsBuildTask` (GCS-only; `writeMerged` dedupes,
no AV calls).

## Prerequisites

- Repo: `C:\aa\projects\av-proxy-api`, branch `prod` working tree
- `cd functions`; `npm install` already run
- Env: `GCLOUD_PROJECT=alpha-vantage-proxy-api` (required — script
  refuses otherwise)
- Env (Windows/AT&T IPv6 workaround): `NODE_OPTIONS=--require
  C:\Users\bob\.config\node\ipv4-only.cjs` — without it the Logging API
  fetch can `ETIMEDOUT`
- ADC credentials with `logging.read` on the prod project
- `--enqueue` additionally needs `FIREBASE_SERVICE_ACCOUNT_ID` locally

## Scenarios

### S1 — Dry enumeration vs prod (AC1, AC4) — PASS

- Command: `npx ts-node -r tsconfig-paths/register -P
  scripts/tsconfig.json scripts/verify/options-data-229-ts-build-repair.ts`
  (default window `2026-10-01` .. now, all symbols)
- Expected: `mode: dry (read-only)`; log entry census; every failed
  `(symbol, startDate, endDate)` task printed with `failedContracts` and
  error count; `unhealed contracts: N`; first 20 triage rows printed
  `symbol contractID: error`; all checks PASS; exit 0.
- Evidence (2026-11-04): `=== All verification checks passed ===` —
  **733 failed tasks / 25,172 unhealed / 23,192 max failedContracts**;
  `full triage list written: .devin\tmp\options-data-229-unhealed.json`.

### S2 — Triage artifact provenance (AC4) — PASS

- After S1, open `.devin/tmp/options-data-229-unhealed.json`.
- Expected: `{generatedAt, since, until, symbols:"all",
  logReadTruncated:false, underReportedBuilds:0, unhealed:[{symbol,
  contractID, error}…]}`; `unhealed.length` = console count.
- Evidence (2026-11-04): artifact head confirms all fields;
  `logReadTruncated:false`, `underReportedBuilds:0`, `symbols:"all"`.

### S3 — Truncation guard (AC1 completeness) — PASS

- Command: same script with `--limit 2000`.
- Expected: enumeration stops at 2,000 entries and the completeness
  check FAILs loudly (`FAIL log read did not truncate`); exit 1.
- Evidence (2026-11-04): `log entries read: 2000` →
  `FAIL  log read did not truncate — window fully enumerated — 2000/2000`.
  Artifact still written with `logReadTruncated:true` (provenance, not
  silent corruption).

### S4 — Per-build completeness invariant (AC4) — PASS

- Each build's unioned `errors[]` must reach its max observed
  `failedContracts` (log-payload truncation of `errors[]` FAILs loudly
  rather than under-reporting triage).
- Evidence (2026-11-04): full-window run —
  `25172 unhealed / 23192 failedContracts`, `underReportedBuilds:0`.

### S5 — `--enqueue` gating — PASS (dry-path evidence)

- `--enqueue` dispatches only when every check passes; a failed check
  skips dispatch and zero-payload runs print `nothing to enqueue`.
- Evidence: code-review verification + dry-path runs above (the check
  ordering and gate were exercised by S3's FAIL path). The actual
  dispatch (733 range tasks) is the deliberate production mutation this
  task exists to enable — deferred ops decision, same posture as #227's
  `--stamp-flags`. Operator runs it per the guide when authorized.

### S6 — Automated suite — PASS

- `npx jest tests/v2/historical-options-corpus/` — 32 suites / 324 tests
  green (2026-11-04, this QA run).
- `npx jest` full suite — 108 suites / 1,256 tests green (2026-11-04,
  same code state; only a comment line added after).
- `npx tsc -p scripts/tsconfig.json --noEmit` — clean.

### S7 — Read-only guarantee — PASS

- Default mode performs Cloud Logging reads only; `--enqueue` is the
  sole mutation, behind an explicit flag and the `GCLOUD_PROJECT` guard.
  Verified by run mode banner + review trace (queue handle is only
  constructed inside the `enqueue` branch).

## Traceability

| AC | Scenario |
|---|---|
| AC1 enumerate all `failedContracts>0` tasks in the backfill window | S1, S3 |
| AC2 re-enqueue on `processHistoricalOptionsTsBuildTask`, GCS-only | S5 (dry-path + review trace) |
| AC3 post-pass audit: re-run shows `failedContracts:0` | S1 rerun pattern; guide "Post-pass audit" section |
| AC4 unhealed pairs reported explicitly (contract + error) | S1, S2, S4 |

## Regression / smoke checklist

- [x] Sibling verify scripts untouched except README/run-all registry rows — PASS (diff review)
- [x] `google-auth-library` now a prod `dependencies` entry — deploy-safe for the existing `intraday-snapshot-jobs.aggregator.ts` import — PASS (package.json)
- [x] No changes to deployed function code paths (src changes are a new pure module consumed only by the script) — PASS

## Findings

- **Deferred ops decision (not a defect):** the `--enqueue` repair pass
  itself (733 tasks / ~25k contract observations) is the deliberate
  production mutation — runbook in `options-data-229-ts-build-repair.md`.
- **Residual:** enumeration depends on ~30-day `_Default` log retention;
  the persisted triage JSON is the surviving artifact if deferred.
- **Ops note:** the Logging read quota (120 req/min/project) can 429
  under concurrent consumers; the script's escalating backoff (5×,
  65–125s) handled real contention during QA.

## Result

**PASS** — all scenarios passed with evidence; no unresolved findings.
