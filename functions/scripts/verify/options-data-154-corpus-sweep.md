# Verification Guide — Task #154: corpus sweep + interim supersede

Topic: #102 (Swing-driven options corpus) · Thread: #106 (Options corpus ingest) · Blueprint: #149 (BE)

## What this verifies

The coverage-aware reconcile path end-to-end against prod: seeded swing doc + staged GCS objects → `fanoutPivotSeeds` → only missing dates dispatched (payloads carry pivot `kind`), superseded interim objects deleted, non-interim-provenance objects (nightly/pilot) never touched.

## Scripts

| Script | Pipeline stage | What it checks |
|---|---|---|
| `options-data-154-corpus-sweep.ts` | Reconcile diff + supersede delete + dispatch | missing-only dispatch, `kind` stamped through to item docs, `kind=interim` object deleted when its date exits the planned set, unmarked objects retained |

## Usage

```bash
cd functions
$env:OPTIONS_CORPUS_BUCKET="av-hist-options-corpus-bucket"
npx ts-node -r tsconfig-paths/register -P scripts/tsconfig.json scripts/verify/options-data-154-corpus-sweep.ts
```

Requires: deployed `processHistoricalOptionsCorpusSeedTask`, `roles/iam.serviceAccountTokenCreator` on `alpha-vantage-proxy-api@appspot.gserviceaccount.com` (task OIDC signing), and `OPTIONS_CORPUS_BUCKET` set (script fails fast without it).

## Passing result

`planned=3, enqueued=2, deleted=1`, all `PASS` lines including GCS assertions, then `=== All verification checks passed ===` (exit 0).

## Failing result

`FAIL: {description}` exit 1. Note: the supersede rule keys on the object's `kind` custom metadata — objects written before #154 have no stamp and are always retained.

## Setup/teardown

**Mutating** — writes then deletes `options-swing-sets/ZZTEST_dev2_L2_R2_1barY_projY`, three `historical-options/v1/ZZTEST/*` GCS objects, and one corpus run. ZZTEST stays options-disabled so dispatched tasks terminal-skip with zero AV calls. Not in `run-all`.
