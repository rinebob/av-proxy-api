# Verify: options-data-220-corpus-reconcile

**Task:** #220 — Standing coverage reconciler
**Type:** Read-only by default; `--execute` writes a real
`options_corpus_runs` doc and enqueues real seed tasks.
**Not** part of `run-all.ts` — needs `GCLOUD_PROJECT` + ADC.

## What it exercises

The real `runCorpusReconcile` core (scheduled function
`reconcileOptionsCorpusCoverage`, 22:30 PT weekdays) against prod with
production deps: the live `optionsEnabled` set, real GCS corpus listings,
real `options_corpus_runs` item state for live-queue suppression, and real
`TradingCalendarService` expected dates over
`[OPTIONS_CORPUS_DAILY_FLOOR_DATE .. yesterday ET]`.

1. **Expected-date diff** — per enabled symbol, expected trading days vs
   stored `historical-options/v1/{SYM}/{date}.json.gz` objects.
2. **Live-queue suppression** — gaps already pending/in_progress in a
   non-terminal run (< 24h old) are suppressed, not double-dispatched.
3. **Run doc** — one `options_corpus_runs` doc per sweep; items = dispatched
   gaps + flagged suspects (Task #227); `perSymbol` records
   planned/present/missing/enqueued (+flagged/thinChains).
4. **Seed dispatch** (`--execute` only) — `{runId, symbol, date, attempt:1}`
   payloads on `processHistoricalOptionsCorpusSeedTask`; flagged-suspect
   dispatches also carry `forceRefetch: true` (+`kind` when the flagged
   object had pivot provenance).

## Run it

```
cd functions
# dry (read-only) — full live enabled set:
GCLOUD_PROJECT=alpha-vantage-proxy-api npx ts-node -r tsconfig-paths/register -P scripts/tsconfig.json scripts/verify/options-data-220-corpus-reconcile.ts

# bound to specific symbols:
GCLOUD_PROJECT=alpha-vantage-proxy-api npx ts-node -r tsconfig-paths/register -P scripts/tsconfig.json scripts/verify/options-data-220-corpus-reconcile.ts --symbols QQQ,SNDK

# execute — real run doc + real seed enqueues for uncovered gaps:
GCLOUD_PROJECT=alpha-vantage-proxy-api FIREBASE_SERVICE_ACCOUNT_ID=29825344315-compute@developer.gserviceaccount.com \
  npx ts-node -r tsconfig-paths/register -P scripts/tsconfig.json scripts/verify/options-data-220-corpus-reconcile.ts --execute [--symbols …]
```

| Flag | Effect |
|---|---|
| `--symbols A,B` | Bound the sweep to a subset (still gated by the live `optionsEnabled` list) |
| `--execute` | Write the run doc + summary and enqueue real seed tasks for gaps |

Local `--execute` needs `FIREBASE_SERVICE_ACCOUNT_ID` — the Admin SDK
can't resolve a service-account identity off the metadata server.

## Pass criteria

- Dry run prints per-symbol counts and exits 0; `coverage: FULL` when no
  symbol has an uncovered expected date.
- Execute prints the same counts plus `run doc: status=completed|in_progress`
  and `perSymbol keys=N` — the doc exists at
  `options_corpus_runs/{runId}` with item docs only for dispatched gaps.

## Verified baseline (2026-10-31)

- Dry, full set: **130 symbols × 209 expected dates — 0 gaps, 0 suppressed,
  0 failed** (~90s; covered symbols cost one GCS list and no Firestore
  run-item scan).
- Execute `--symbols SNDK`: run doc `status=completed`, `totalItems=0`,
  `perSymbol.SNDK = {planned:209, present:209, missing:0, enqueued:0}`.
- SNDK/2026-09-21 (the motivating terminal hole) is covered — healed via
  the identical `planCorpusRun` + seed-queue path during Task #224 QA.

## Residue

- Execute mode leaves the `options_corpus_runs/{runId}` doc (+ item docs
  for any dispatched gaps) — normal product residue, same as any real run.
