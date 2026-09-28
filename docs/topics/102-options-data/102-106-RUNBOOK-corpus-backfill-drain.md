**Topic:** Swing-driven options corpus platform  
**Topic Slug:** swing-driven-options-corpus  
**Thread:** Options corpus ingest  
**Thread Slug:** options-corpus-ingest  
**Issue:** #106  
**Topic Parent:** #102  
**Domain:** OPTIONS-DATA  
**Type:** RUNBOOK  
**Status:** Complete  
**Created:** 2026-09-27  
**Last Updated:** 2026-09-27  

---

# Options corpus backfill drain — runbook

Status doc for the 2026-09-27 bulk drain: what should be happening, and how to
confirm it. All timestamps/logs in `us-central1`, project `alpha-vantage-proxy-api`.

## What should be happening

Three queues work in concert. The intended end state is 129 options-enabled
symbols with ≥2019-01-01 historical option chains in the corpus bucket and
per-contract JSONL time series in the time-series bucket.

```
swing-set docs (Firestore options-swing-sets, corpus paramsId, source='sa')
      │  planPivotSeeds — floor-filtered to >= 2019-01-01
      ▼
processHistoricalOptionsCorpusSeedTask queue   (1 dispatch/s, 3 retries)
      │  seedCorpusItem: enabled gate → pre-floor skip → AV fetch → GCS write
      │  → symbol-metrics compute → enqueue ts-build task
      ▼
GCS: av-hist-options-corpus-bucket/historical-options/v1/<SYM>/<date>.json.gz
      │
      ▼
processHistoricalOptionsTsBuildTask queue      (10 concurrent, 5/s, 15-min budget)
      │  buildSymbol: per-date corpus read → contract ID → merge into JSONL
      │  (skip-unchanged; per-symbol lease; self-continues at resumeDate)
      ▼
GCS: av-options-time-series-bucket/time-series/v1/<SYM>/<CONTRACT>.jsonl
Firestore: ts-contracts (catalog), options-contract-index, options-ts-build-leases
```

Expected steady-state signals during the drain:

- **Seed side**: `seed.stored` lines at ~1/s interleaved with `seed.skip.pre-floor`
  (instant, zero AV calls). ~25k total seed tasks enqueued by the sweep re-fanout.
- **Ts-build side**: range tasks `start { startDate: '2019-01-01' }`, then either
  `done` (whole range fit in the 15-min budget) or `continue` → a re-enqueued
  continuation at `resumeDate`. Dense symbols need 2–3 continuations; sparse
  symbols finish a full range in seconds (mostly `missingDates`).
- **No new pre-2019 work anywhere**: any task payload carrying a pre-2019 date
  is a legacy leftover that the floor now clamps/skips — bounded to one
  in-flight generation after the floor deploy.
- **Zero `lease busy` churn**: seed completions skip the ts-build enqueue
  entirely while a range lease is held (`seed.skip.ts-enqueue-lease-held`).

## Confirmation queries

### Log ingestion sanity check

Log-based metrics and Logs Explorer can **lag behind `gcloud tasks list`**. If a
query looks too quiet, check queue depth directly:

```powershell
gcloud tasks list --queue processHistoricalOptionsTsBuildTask `
  --location us-central1 --project alpha-vantage-proxy-api --limit 2000 `
  --format="csv[no-heading](name)" | Measure-Object -Line
```

### Seed drain — is AV fetching progressing?

Stored chains (the real work, ~1/s pace is expected):

```
resource.labels.service_name="processhistoricaloptionscorpusseedtask"
AND textPayload:"seed.stored"
```

Pre-floor skips draining cheaply:

```
resource.labels.service_name="processhistoricaloptionscorpusseedtask"
AND textPayload:"seed.skip.pre-floor"
```

Seed failures to investigate:

```
resource.labels.service_name="processhistoricaloptionscorpusseedtask"
AND textPayload:"seed.error"
```

### Ts-build drain — is the build progressing?

Range task starts (every one should show `2019-01-01`, never earlier):

```
resource.labels.service_name="processhistoricaloptionstsbuildtask"
AND textPayload:"start"
```

Completions and continuations:

```
resource.labels.service_name="processhistoricaloptionstsbuildtask"
AND textPayload:"done"
```

A `done` with `resumeDate` set means the 15-min budget expired and a
continuation was re-enqueued — normal for dense symbols, not an error.

Per-symbol focus (swap the ticker):

```
resource.labels.service_name="processhistoricaloptionstsbuildtask"
AND textPayload:"'AAPL'"
```

### Failure watch

Task-level failures (maxAttempts=3; each retry restarts the range):

```
resource.labels.service_name="processhistoricaloptionstsbuildtask"
AND textPayload:"failed"
```

Contract-level write failures (per-contract now; previously one bad contract
could crash the task — `builder.read.error` was added 2026-09-27 to isolate a
failed GCS read to its contract):

```
resource.labels.service_name="processhistoricaloptionstsbuildtask"
AND (textPayload:"builder.write.error"
  OR textPayload:"builder.read.error"
  OR textPayload:"builder.index.upsert.error")
```

Lease contention (should be rare after the seed-side lease check landed):

```
resource.labels.service_name="processhistoricaloptionstsbuildtask"
AND textPayload:"lease busy"
```

Queue-level dispatch health (non-200 responses):

```
resource.type="cloud_tasks_queue"
AND resource.labels.queue_id="processHistoricalOptionsTsBuildTask"
AND jsonPayload.attemptResponseLog.responseCode!="200"
```

### Coverage audit (drain-complete check)

Counts of symbols present in each bucket vs the 129-symbol enabled set:

```powershell
gcloud storage ls "gs://av-hist-options-corpus-bucket/historical-options/v1/" `
  --project alpha-vantage-proxy-api | Measure-Object -Line

gcloud storage ls "gs://av-options-time-series-bucket/time-series/v1/" `
  --project alpha-vantage-proxy-api | Measure-Object -Line
```

For a symbol absent from both, the seed run items explain why
(`seed.skip.pre-floor`, `seed.error`, or silence = no swing-set doc):

```
resource.labels.service_name="processhistoricaloptionscorpusseedtask"
AND textPayload:"'TSLA'"
```

### Pre-floor cleanup sweep

The 2026-09-27 sweep run deletes all corpus objects with `date < 2019-01-01`
regardless of provenance, in the same reconcile pass that deletes superseded
interims:

```
resource.labels.service_name="sweephistoricaloptionscorpus"
AND textPayload:"deleted"
```

`deleted pre-floor <date>` = floor cleanup. `deleted superseded interim <date>`
= swing moved on. `delete failed` = retry-worthy outliers.

Edge case: a symbol with **zero** ≥2019 pivots early-returns before the object
scan (absent/empty plan can't safely drive deletes), so its pre-floor objects
remain — check for `deleted=0` sweep lines paired with `enqueued 0`.

## What NOT to panic about

- **`missing dates … corpus may not be ready`** — a range task scanned ahead of
  its seeds; those dates fill in when their seed completes and enqueues its own
  ts-build task.
- **`lease busy` / 300s deferrals still in the queue** — pre-floor-deploy
  single-date tasks resolving themselves; each resolves fast once its symbol's
  range task finishes.
- **`processHistoricalOptionsCorpusSeedTask` queue deep at 1/s** — the queue
  depth now includes dispatch-cheap pre-floor skips; effective AV-paced progress
  is the `seed.stored` rate.
- **Pre-2019 lines inside JSONL files** — corpus objects are deleted but
  already-merged observations remain in contract time series; reads filter by
  `startDate`. Bloat only, not served unless requested.
- **`partnerIvMetricsV2`/partner endpoints returning 400 for new symbols** —
  fixed 2026-09-27: `ALLOWED_SYMBOLS` pilot list replaced by the `optionsEnabled`
  Firestore gate. A 400 now means genuinely not enabled.

## Knobs if the drain needs to move faster

| Knob | Where | Trade-off |
|---|---|---|
| Seed `maxDispatchesPerSecond` > 1 | `corpus-seed.task.ts` queue config | AV rate-limit retries; self-corrects via `retry_enqueued` but wastes calls |
| Ts-build `maxConcurrentDispatches` > 10 | `ts-build.task.ts` queue config | GCS/Firestore write contention; leases already prevent same-symbol races |
| Seed concurrency > 1 | same | Multiple instances = throttle no longer paces the *fleet* — AV burst risk |
