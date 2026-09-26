# Verification Guide — Task #153: pivot-seed fanout (enable trigger)

Topic: #102 (Swing-driven options corpus) · Thread: #106 (Options corpus ingest) · Blueprint: #149 (BE)

## What this verifies

The enable-transition corpus fanout end-to-end against prod: a seeded corpus swing doc → `fanoutPivotSeeds` → `options_corpus_runs` run + item docs → real Cloud Tasks dispatch → `processHistoricalOptionsCorpusSeedTask` terminal item statuses.

Probe symbol `ZZTEST` is **not** options-enabled, so every dispatched task lands in the worker's curation gate → item `skipped` — zero AV calls, zero GCS writes — while still proving dispatch, worker execution, and run/item metadata.

## Scripts

| Script | Pipeline stage | What it checks |
|---|---|---|
| `options-data-153-enable-seed-fanout.ts` | Fanout → dispatch → worker | run doc created (`totalItems`, date range, `in_progress`), N item docs, real task dispatch, all items terminal `'skipped'` via the options-disabled gate, no-doc no-op path |

## Usage

```bash
cd functions
npx ts-node -r tsconfig-paths/register -P scripts/tsconfig.json scripts/verify/options-data-153-enable-seed-fanout.ts
```

Requires: deployed `processHistoricalOptionsCorpusSeedTask`, and the caller's gcloud identity must have `roles/iam.serviceAccountTokenCreator` on `alpha-vantage-proxy-api@appspot.gserviceaccount.com` (the SA used to sign task OIDC tokens; override via `FIREBASE_SERVICE_ACCOUNT_ID`).

## Passing result

`PASS` lines for enqueue count, run doc fields, item count, terminal statuses (`→ ZZTEST_{date}: skipped` ×3), no-doc no-op, then `=== All verification checks passed ===` (exit 0). Worker dispatch latency is typically a few seconds; the script polls item statuses up to 4 minutes.

## Failing result

`FAIL: {description}` exit 1. Common causes: `Failed to determine service account` → missing/incorrect `serviceAccountId`; items stuck `pending` → seed task function not deployed or queue drained; `PERMISSION_DENIED` on enqueue → caller lacks Token Creator on the SA.

## Setup/teardown

**Mutating** — writes `options-swing-sets/ZZTEST_dev2_L2_R2_1barY_projY` and one `options_corpus_runs` run (run doc + items subcollection), deletes both in `finally`. ZZTEST's tracked doc is never created, so the worker's curation gate makes every item a cheap terminal skip. Not in `run-all`.
