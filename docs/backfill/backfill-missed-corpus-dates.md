# Backfill Missed Corpus Dates

**Status:** Proposed
**Owner:** Savant API
**Last updated:** 2026-07-24

---

## 1. Problem

The nightly corpus scheduler (`refreshHistoricalOptionsCorpusNightly`) runs at 7 PM Pacific on weekdays. If the scheduler misses a day (deploy gap, function error, market holiday miscalculation), the raw Alpha Vantage options data for that date is never fetched and stored in the GCS corpus bucket. Without the corpus item, the time-series builder cannot merge that day's observations into per-contract JSONL files.

### Example

July 22 and July 23, 2024 were missed. The corpus bucket has no `historical-options/v1/QQQ/2024-07-22.json.gz` or `2024-07-23.json.gz` objects. All per-contract time series files are missing those trading days.

## 2. Two-Phase Backfill

### Phase 1: Corpus Seed (fetch raw AV data)

The nightly corpus seeder only runs on schedule — there is no ad-hoc HTTP trigger for seeding specific dates. We need a script that:

1. Takes `DATES=2024-07-22,2024-07-23` and `SYMBOLS=QQQ,TQQQ` env vars.
2. Uses `planCorpusRun` to create a run for the specified dates and symbols.
3. Enqueues `CorpusSeedPayload` tasks to the existing Cloud Tasks queue (`processHistoricalOptionsCorpusSeedTask`).
4. The seed worker is idempotent — if GCS already has the item, it skips without an AV call.

**Cost:** 4 AV API calls (QQQ + TQQQ × 2 dates). Cloud Tasks queue is rate-limited to 1 dispatch/second.

### Phase 2: Time-Series Build (merge into per-contract files)

Once the corpus items exist, run the existing HTTP trigger:

```powershell
curl -X POST `
  -H "x-admin-secret: $SECRET" `
  -H "Content-Type: application/json" `
  -d '{"symbol":"QQQ","startDate":"2024-07-22","endDate":"2024-07-23","execute":true}' `
  https://us-central1-alpha-vantage-proxy-api.cloudfunctions.net/triggerHistoricalOptionsTimeSeriesBuild
```

Repeat for `TQQQ`. The builder:
1. Reads the corpus items for those dates from GCS.
2. Merges them into existing per-contract JSONL files (idempotent — date deduplication).
3. Calls `upsertContract` to update the Firestore index.

## 3. Proposed Script: `backfill-corpus-dates.ts`

**Location:** `functions/scripts/ops/backfill-corpus-dates.ts`

### Usage

```bash
# From functions/ directory
DATES=2024-07-22,2024-07-23 SYMBOLS=QQQ,TQQQ \
  npx ts-node -r tsconfig-paths/register ./scripts/ops/backfill-corpus-dates.ts
```

### Environment Variables

| Variable | Required | Default | Description |
|---|---|---|---|
| `DATES` | Yes | — | Comma-separated `YYYY-MM-DD` dates to backfill |
| `SYMBOLS` | No | `QQQ,TQQQ` | Comma-separated symbols |
| `DRY_RUN` | No | `0` | Set to `1` to plan without enqueuing tasks |
| `OPTIONS_CORPUS_BUCKET` | Yes | — | GCS bucket name for corpus data |

### Flow

1. Parse dates and symbols from env vars.
2. Call `planCorpusRun({ symbols, startDate, endDate, dryRun, pilot: false })`.
3. For each planned item:
   - Check if GCS already has the item (idempotency check).
   - If missing, enqueue a `CorpusSeedPayload` task to the Cloud Tasks queue.
4. Log enqueued vs. skipped counts.
5. Print instructions for Phase 2 (the `curl` command with the correct date range).

### What the script does NOT do

- Does not wait for seed tasks to complete (Cloud Tasks process asynchronously).
- Does not trigger the time-series builder automatically (user runs the `curl` command after confirming corpus items are stored).
- Does not handle retries or failure monitoring (Cloud Tasks handles retries; Firestore run docs track status).

## 4. Verification

After Phase 1 completes (check Cloud Tasks logs or Firestore run status):

```bash
# Verify corpus items exist in GCS
gsutil ls gs://av-hist-options-corpus-bucket/historical-options/v1/QQQ/2024-07-22.json.gz
gsutil ls gs://av-hist-options-corpus-bucket/historical-options/v1/QQQ/2024-07-23.json.gz
```

After Phase 2 completes (check function logs):

- Open the Storage File Viewer and select a contract that was trading on those dates.
- Verify the JSONL content includes observations for `2024-07-22` and `2024-07-23`.

## 5. Future Improvements

- Add a `--wait` flag to the script that polls Firestore run status until all seed tasks complete.
- Automatically trigger the time-series builder after corpus seeding is confirmed.
- Add monitoring/alerting for missed nightly runs (e.g., check that the most recent corpus item date matches yesterday).
