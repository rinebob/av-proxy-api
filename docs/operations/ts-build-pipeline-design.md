# TS-Build Pipeline Design

**Created:** 2026-08-02  
**Status:** Active

---

## Overview

The ts-build pipeline automatically builds per-contract time-series JSONL files after a corpus seed completes. It is an event-driven Cloud Task that fires per symbol+date as each corpus item is successfully stored — not a scheduled function.

## Architecture

```
Nightly Corpus Scheduler
  → planCorpusRun (creates run + items)
  → enqueueTask (per item) → corpus-seed.task
      → seedCorpusItem
          → on success (stored or gcs-hit)
              → onSeedSuccess callback
                  → enqueue ts-build.task ({ symbol, date })
                      → createTimeSeriesBuilderService()
                          → buildSymbol(symbol, date, date)
                              → read corpus from GCS
                              → merge into existing JSONL
                              → write back to GCS
```

## Trigger Source

The `onSeedSuccess` callback is injected by `corpus-seed.task.ts` into the `SeedWorkerDependencies`. It fires after:

1. **Successful store** — A new corpus item was fetched from Alpha Vantage and written to GCS.
2. **GCS hit (skip)** — The corpus item already existed in GCS. The ts-build enqueue is intentionally redundant because the builder is idempotent (reads existing JSONL, merges, deduplicates by date). This avoids a separate GCS check for the time-series file.

It does **not** fire on:
- `already-recorded` skip (Firestore metadata says success — the build was already triggered in a prior run)
- `permanent_failure`
- `retry_enqueued`

## Idempotency

The `TimeSeriesBuilderService.buildSymbol` method is idempotent:
- Reads existing JSONL from the target bucket (if any)
- Merges the new date's observation
- Deduplicates by date
- Writes back

This means redundant ts-build tasks (e.g., from `gcs-hit` retries) produce the same output as a single run. No data corruption or duplication occurs.

## Retry Semantics

| Property | Value | Reason |
|---|---|---|
| `maxAttempts` | 3 | Transient GCS errors, AV throttling |
| `maxConcurrentDispatches` | 1 | Avoid memory pressure (4 GiB per task) |
| `maxDispatchesPerSecond` | 1.0 | Pace builds to avoid GCS write contention |
| `timeoutSeconds` | 1200 (20 min) | Large symbol+date combos can take 10+ min |
| `memory` | 4 GiB | Builder loads full corpus file + JSONL into memory |

Retries are safe because the builder is idempotent. If a task fails mid-write, the next attempt will re-read, re-merge, and re-write correctly.

## Relationship to Existing Nightly Path

The nightly corpus scheduler (`nightly-corpus.service.ts`) plans and enqueues corpus seed tasks. The ts-build pipeline is a **downstream addition** — it does not replace the nightly scheduler. The nightly path remains responsible for:
- Determining which trading dates to process
- Enqueuing corpus seed tasks
- Tracking run metadata in Firestore

The ts-build pipeline is responsible for:
- Building time-series JSONL from the raw corpus
- Running as a separate Cloud Task to isolate failures and allow independent retries

## Error Handling

The `ts-build.task.ts` handler wraps `buildSymbol` in a try/catch:
- On success: logs the build report (found dates, missing dates, processed/failed contracts)
- On failure: logs structured error with `{ symbol, date, error }` and re-throws so Cloud Tasks retries
- Missing dates (corpus not ready): logs a warning but does not fail the task

## Configuration

The task queue name is `processHistoricalOptionsTsBuildTask` (exported as `OPTIONS_TS_BUILD_TASK_QUEUE`).

The builder service reads bucket names from environment variables:
- `OPTIONS_CORPUS_BUCKET` — source bucket for raw corpus files
- `OPTIONS_TIME_SERIES_BUCKET` — target bucket for JSONL time-series files

## Deployment

This is a new Cloud Function export (`processHistoricalOptionsTsBuildTask`) that must be deployed alongside the existing corpus seed functions. No Firestore indexes are required (the builder reads from GCS, not Firestore). No partner endpoint configuration is needed (this is an internal task queue, not an HTTPS endpoint).
