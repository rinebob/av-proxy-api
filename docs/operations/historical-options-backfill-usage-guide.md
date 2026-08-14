# Historical Options Backfill & Operations Guide

**Created**: July 31, 2026  
**Last Updated**: July 31, 2026

This document is the definitive reference for backfilling and operating the QQQ/TQQQ historical options corpus and time-series pipeline. It covers every command you need — no guessing, no fumbling.

---

## Table of Contents

1. [Architecture Overview](#1-architecture-overview)
2. [Prerequisites & Authentication](#2-prerequisites--authentication)
3. [Cloud Run Service URLs](#3-cloud-run-service-urls)
4. [Secrets Reference](#4-secrets-reference)
5. [Backfill a Single Date](#5-backfill-a-single-date)
6. [Backfill a Date Range](#6-backfill-a-date-range)
7. [Time-Series Build Only (Corpus Already Exists)](#7-time-series-build-only-corpus-already-exists)
8. [Dry Run / Plan Without Executing](#8-dry-run--plan-without-executing)
9. [Nightly Scheduler Operations](#9-nightly-scheduler-operations)
10. [Monitoring & Logs](#10-monitoring--logs)
11. [Troubleshooting](#11-troubleshooting)
12. [Quick Reference Card](#12-quick-reference-card)

---

## 1. Architecture Overview

The pipeline has three stages:

```
Nightly Scheduler (7 PM PT, weekdays)
  └─> NightlyCorpusService.run()
        └─> Enqueues Corpus Seed Tasks (Cloud Tasks)
              └─> processHistoricalOptionsCorpusSeedTask
                    ├─ Fetches data from Alpha Vantage
                    ├─ Writes gzipped JSON to GCS corpus bucket
                    └─ onSeedSuccess callback
                          └─> Enqueues TS Build Task (Cloud Tasks)
                                └─> processHistoricalOptionsTsBuildTask
                                      ├─ Reads corpus from GCS
                                      ├─ Merges into per-contract JSONL files
                                      └─ Writes to GCS time-series bucket
```

**Key points:**
- Corpus seed tasks fetch raw options data from Alpha Vantage and store as gzipped JSON in GCS.
- TS build tasks read the corpus, merge into per-contract JSONL time-series files (read-merge-write, idempotent).
- The `onSeedSuccess` callback automatically enqueues a TS build task after each successful corpus seed.
- Both the pilot HTTP trigger and the nightly scheduler can kick off corpus seed tasks.
- The TS build HTTP trigger can build time-series directly without going through the corpus seed path.

**Deployed Cloud Functions:**

| Function Name | Type | Purpose |
|---|---|---|
| `refreshHistoricalOptionsCorpusNightly` | Scheduled (7 PM PT weekdays) | Nightly corpus update for QQQ/TQQQ |
| `triggerHistoricalOptionsPilot` | HTTP POST | Manual corpus backfill trigger |
| `processHistoricalOptionsCorpusSeedTask` | Cloud Task | Seeds a single symbol+date into GCS corpus |
| `processHistoricalOptionsTsBuildTask` | Cloud Task | Builds time-series JSONL from corpus |
| `triggerHistoricalOptionsTimeSeriesBuild` | HTTP POST | Manual TS build trigger (single symbol) |

---

## 2. Prerequisites & Authentication

### gcloud CLI

All commands require an authenticated gcloud CLI session:

```powershell
gcloud auth login
gcloud config set project alpha-vantage-proxy-api
```

### Identity Token (required for HTTP triggers)

Cloud Run functions require an IAM-authenticated request. Generate a token before calling any HTTP endpoint:

```powershell
$token = gcloud auth print-identity-token
```

**This token expires (~1 hour). Re-run the command if you get a 403.**

### PowerShell Session Setup

Run this once at the start of each PowerShell session where you'll invoke backfill commands:

```powershell
# Set project
gcloud config set project alpha-vantage-proxy-api

# Generate auth token (re-run if commands start returning 403)
$token = gcloud auth print-identity-token

# Store secrets as variables (look up from Secret Manager — see Section 4)
$pilotSecret = gcloud secrets versions access latest --secret HISTORICAL_OPTIONS_PILOT_ADMIN_SECRET --project alpha-vantage-proxy-api
$tsSecret = gcloud secrets versions access latest --secret HISTORICAL_OPTIONS_TIME_SERIES_ADMIN_SECRET --project alpha-vantage-proxy-api
```

---

## 3. Cloud Run Service URLs

**These are the correct URLs for Gen 2 (Cloud Run) functions.**  
The old `cloudfunctions.net` URLs return 403 — do not use them.

| Function | URL |
|---|---|
| Pilot / Corpus Backfill | `https://triggerhistoricaloptionspilot-lsluydmucq-uc.a.run.app` |
| Time-Series Build | `https://triggerhistoricaloptionstimeseriesbuild-lsluydmucq-uc.a.run.app` |

### How to Look Up URLs (if they change after deploy)

```powershell
gcloud run services describe triggerhistoricaloptionspilot --region us-central1 --project alpha-vantage-proxy-api --format="value(status.url)"
gcloud run services describe triggerhistoricaloptionstimeseriesbuild --region us-central1 --project alpha-vantage-proxy-api --format="value(status.url)"
```

---

## 4. Secrets Reference

Secrets are stored in Google Cloud Secret Manager. Look them up with:

```powershell
gcloud secrets versions access latest --secret HISTORICAL_OPTIONS_PILOT_ADMIN_SECRET --project alpha-vantage-proxy-api
gcloud secrets versions access latest --secret HISTORICAL_OPTIONS_TIME_SERIES_ADMIN_SECRET --project alpha-vantage-proxy-api
```

| Secret Name | Used By | Header |
|---|---|---|
| `HISTORICAL_OPTIONS_PILOT_ADMIN_SECRET` | `triggerHistoricalOptionsPilot` | `x-admin-secret` |
| `HISTORICAL_OPTIONS_TIME_SERIES_ADMIN_SECRET` | `triggerHistoricalOptionsTimeSeriesBuild` | `x-admin-secret` |

---

## 5. Backfill a Single Date

Use this when the nightly run failed for a specific date and you need to re-run it manually.

### Step 1: Trigger Corpus Seed

The pilot trigger will check GCS for existing data. If the corpus doc already exists, it will skip (no seed task enqueued). If missing, it will enqueue a seed task that fetches from Alpha Vantage.

```powershell
$token = gcloud auth print-identity-token
$pilotSecret = gcloud secrets versions access latest --secret HISTORICAL_OPTIONS_PILOT_ADMIN_SECRET --project alpha-vantage-proxy-api

$response = Invoke-RestMethod -Method POST `
  -Uri "https://triggerhistoricaloptionspilot-lsluydmucq-uc.a.run.app" `
  -Headers @{
    "Content-Type" = "application/json"
    "x-admin-secret" = $pilotSecret
    "Authorization" = "Bearer $token"
  } `
  -Body '{"symbols":["QQQ","TQQQ"],"startDate":"2026-07-30","referenceDate":"2026-07-30","maxTradingDatesPerSymbol":1,"dryRun":false,"execute":true}'

$response | ConvertTo-Json -Depth 5
```

**Expected output:**
```json
{
  "ok": true,
  "report": {
    "runId": "options_corpus_runs-QQQ-TQQQ-2026-07-30-2026-07-30-md1-pilot",
    "totalItems": 2,
    "missingItems": 0,
    "executed": true,
    ...
  }
}
```

- If `missingItems > 0`: seed tasks were enqueued. TS build tasks will auto-trigger via `onSeedSuccess`.
- If `missingItems = 0`: corpus data already exists. Proceed to Step 2 to build the time-series manually.

### Step 2: Trigger Time-Series Build (if corpus already existed)

Only needed if Step 1 reported `missingItems: 0`. Run once per symbol:

```powershell
$token = gcloud auth print-identity-token
$tsSecret = gcloud secrets versions access latest --secret HISTORICAL_OPTIONS_TIME_SERIES_ADMIN_SECRET --project alpha-vantage-proxy-api

# QQQ
$qqqResponse = Invoke-RestMethod -Method POST `
  -Uri "https://triggerhistoricaloptionstimeseriesbuild-lsluydmucq-uc.a.run.app" `
  -Headers @{
    "Content-Type" = "application/json"
    "x-admin-secret" = $tsSecret
    "Authorization" = "Bearer $token"
  } `
  -Body '{"symbol":"QQQ","startDate":"2026-07-30","endDate":"2026-07-30","execute":true}'

$qqqResponse | ConvertTo-Json -Depth 5

# TQQQ
$tqqqResponse = Invoke-RestMethod -Method POST `
  -Uri "https://triggerhistoricaloptionstimeseriesbuild-lsluydmucq-uc.a.run.app" `
  -Headers @{
    "Content-Type" = "application/json"
    "x-admin-secret" = $tsSecret
    "Authorization" = "Bearer $token"
  } `
  -Body '{"symbol":"TQQQ","startDate":"2026-07-30","endDate":"2026-07-30","execute":true}'

$tqqqResponse | ConvertTo-Json -Depth 5
```

**Expected output:**
```json
{
  "ok": true,
  "report": {
    "symbol": "QQQ",
    "startDate": "2026-07-30",
    "endDate": "2026-07-30",
    "totalTradingDays": 1,
    "foundDates": 1,
    "missingDates": 0,
    "processedContracts": 450,
    "failedContracts": 0,
    ...
  }
}
```

---

## 6. Backfill a Date Range

Use this for bulk backfilling multiple dates at once.

### Corpus Seed for a Date Range

```powershell
$token = gcloud auth print-identity-token
$pilotSecret = gcloud secrets versions access latest --secret HISTORICAL_OPTIONS_PILOT_ADMIN_SECRET --project alpha-vantage-proxy-api

# Backfill all trading days from 2026-07-01 to 2026-07-30
# maxTradingDatesPerSymbol caps the number of dates per symbol
# Set it high enough to cover all trading days in the range
$response = Invoke-RestMethod -Method POST `
  -Uri "https://triggerhistoricaloptionspilot-lsluydmucq-uc.a.run.app" `
  -Headers @{
    "Content-Type" = "application/json"
    "x-admin-secret" = $pilotSecret
    "Authorization" = "Bearer $token"
  } `
  -Body '{"symbols":["QQQ","TQQQ"],"startDate":"2026-07-01","referenceDate":"2026-07-30","maxTradingDatesPerSymbol":30,"dryRun":false,"execute":true}'

$response | ConvertTo-Json -Depth 5
```

The pilot will skip dates where corpus data already exists in GCS. Only missing dates will have seed tasks enqueued. Each seed task's `onSeedSuccess` callback will auto-enqueue a TS build task.

### Time-Series Build for a Date Range

If corpus data already exists for the entire range and you only need to rebuild the time-series:

```powershell
$token = gcloud auth print-identity-token
$tsSecret = gcloud secrets versions access latest --secret HISTORICAL_OPTIONS_TIME_SERIES_ADMIN_SECRET --project alpha-vantage-proxy-api

# QQQ — full range in one call
$qqqResponse = Invoke-RestMethod -Method POST `
  -Uri "https://triggerhistoricaloptionstimeseriesbuild-lsluydmucq-uc.a.run.app" `
  -Headers @{
    "Content-Type" = "application/json"
    "x-admin-secret" = $tsSecret
    "Authorization" = "Bearer $token"
  } `
  -Body '{"symbol":"QQQ","startDate":"2026-07-01","endDate":"2026-07-30","execute":true}'

$qqqResponse | ConvertTo-Json -Depth 5

# TQQQ — full range in one call
$tqqqResponse = Invoke-RestMethod -Method POST `
  -Uri "https://triggerhistoricaloptionstimeseriesbuild-lsluydmucq-uc.a.run.app" `
  -Headers @{
    "Content-Type" = "application/json"
    "x-admin-secret" = $tsSecret
    "Authorization" = "Bearer $token"
  } `
  -Body '{"symbol":"TQQQ","startDate":"2026-07-01","endDate":"2026-07-30","execute":true}'

$tqqqResponse | ConvertTo-Json -Depth 5
```

The TS builder is idempotent (read-merge-write). It will only add missing dates and deduplicate by date. Existing data is preserved.

---

## 7. Time-Series Build Only (Corpus Already Exists)

If you know the corpus data is already in GCS (e.g., the nightly corpus seed worked but the TS build didn't trigger), skip the pilot and call the TS build trigger directly.

### Single Symbol, Single Date

```powershell
$token = gcloud auth print-identity-token
$tsSecret = gcloud secrets versions access latest --secret HISTORICAL_OPTIONS_TIME_SERIES_ADMIN_SECRET --project alpha-vantage-proxy-api

$response = Invoke-RestMethod -Method POST `
  -Uri "https://triggerhistoricaloptionstimeseriesbuild-lsluydmucq-uc.a.run.app" `
  -Headers @{
    "Content-Type" = "application/json"
    "x-admin-secret" = $tsSecret
    "Authorization" = "Bearer $token"
  } `
  -Body '{"symbol":"QQQ","startDate":"2026-07-30","endDate":"2026-07-30","execute":true}'

$response | ConvertTo-Json -Depth 5
```

### Single Contract Only

Add `contractID` to build only one specific contract:

```powershell
$body = '{"symbol":"QQQ","startDate":"2026-07-30","endDate":"2026-07-30","execute":true,"contractID":"QQQ240719C00450000"}'
```

---

## 8. Dry Run / Plan Without Executing

Both triggers support a dry-run mode that reports what *would* happen without making any changes.

### Pilot Dry Run

```powershell
$token = gcloud auth print-identity-token
$pilotSecret = gcloud secrets versions access latest --secret HISTORICAL_OPTIONS_PILOT_ADMIN_SECRET --project alpha-vantage-proxy-api

$response = Invoke-RestMethod -Method POST `
  -Uri "https://triggerhistoricaloptionspilot-lsluydmucq-uc.a.run.app" `
  -Headers @{
    "Content-Type" = "application/json"
    "x-admin-secret" = $pilotSecret
    "Authorization" = "Bearer $token"
  } `
  -Body '{"symbols":["QQQ","TQQQ"],"startDate":"2026-07-01","referenceDate":"2026-07-30","maxTradingDatesPerSymbol":30,"dryRun":true}'

$response | ConvertTo-Json -Depth 5
```

Reports `totalItems`, `presentItems`, `missingItems`, and `estimatedApiCalls` without enqueuing any tasks.

### TS Build Plan (no execute)

```powershell
$token = gcloud auth print-identity-token
$tsSecret = gcloud secrets versions access latest --secret HISTORICAL_OPTIONS_TIME_SERIES_ADMIN_SECRET --project alpha-vantage-proxy-api

$response = Invoke-RestMethod -Method POST `
  -Uri "https://triggerhistoricaloptionstimeseriesbuild-lsluydmucq-uc.a.run.app" `
  -Headers @{
    "Content-Type" = "application/json"
    "x-admin-secret" = $tsSecret
    "Authorization" = "Bearer $token"
  } `
  -Body '{"symbol":"QQQ","startDate":"2026-07-01","endDate":"2026-07-30"}'

$response | ConvertTo-Json -Depth 5
```

Reports `totalTradingDays` for the date range without touching GCS.

---

## 9. Nightly Scheduler Operations

### Scheduler Details

| Property | Value |
|---|---|
| Job ID | `firebase-schedule-refreshHistoricalOptionsCorpusNightly-us-central1` |
| Location | `us-central1` |
| Schedule | `0 19 * * 1-5` (7:00 PM Pacific, weekdays) |
| Timezone | `America/Los_Angeles` |
| State | `ENABLED` |

### Check Scheduler Status

```powershell
gcloud scheduler jobs describe firebase-schedule-refreshHistoricalOptionsCorpusNightly-us-central1 --location us-central1 --project alpha-vantage-proxy-api
```

Key fields to check:
- `state`: should be `ENABLED`
- `status.code`: `13` means the last attempt failed (INTERNAL error)
- `lastAttemptTime`: when it last tried to run

### Manually Trigger the Nightly Run

```powershell
gcloud scheduler jobs run firebase-schedule-refreshHistoricalOptionsCorpusNightly-us-central1 --location us-central1 --project alpha-vantage-proxy-api
```

This triggers the function for the current date (yesterday in Pacific time). It will enqueue corpus seed tasks for QQQ and TQQQ, which will auto-trigger TS build tasks via `onSeedSuccess`.

### Fix Stale Scheduler URL (Gen 2 Migration Issue)

If the scheduler is targeting a `cloudfunctions.net` URL instead of `.run.app`, update it:

```powershell
# Get the correct Cloud Run URL
$nightlyUrl = gcloud run services describe refreshhistoricaloptionscorpusnightly --region us-central1 --project alpha-vantage-proxy-api --format="value(status.url)"

# Update the scheduler to point to the correct URL
gcloud scheduler jobs update http firebase-schedule-refreshHistoricalOptionsCorpusNightly-us-central1 `
  --location us-central1 `
  --project alpha-vantage-proxy-api `
  --uri="$nightlyUrl" `
  --oidc-service-account-email="29825344315-compute@developer.gserviceaccount.com" `
  --oidc-token-audience="$nightlyUrl" `
  --schedule="0 19 * * 1-5" `
  --time-zone="America/Los_Angeles" `
  --http-method=POST
```

### List All Scheduler Jobs

```powershell
gcloud scheduler jobs list --location us-central1 --project alpha-vantage-proxy-api
```

---

## 10. Monitoring & Logs

### Logs Explorer Queries

Open [Logs Explorer](https://console.cloud.google.com/logs/query?project=alpha-vantage-proxy-api) and paste these queries. Set the time range appropriately.

**Nightly scheduler function:**
```
resource.type="cloud_run_revision"
resource.labels.service_name="refreshhistoricaloptionscorpusnightly"
```

**Corpus seed tasks:**
```
resource.type="cloud_run_revision"
resource.labels.service_name="processhistoricaloptionscorpusseedtask"
```

**TS build tasks (automated path via onSeedSuccess):**
```
resource.type="cloud_run_revision"
resource.labels.service_name="processhistoricaloptionstsbuildtask"
```

**Pilot HTTP trigger:**
```
resource.type="cloud_run_revision"
resource.labels.service_name="triggerhistoricaloptionspilot"
```

**TS build HTTP trigger:**
```
resource.type="cloud_run_revision"
resource.labels.service_name="triggerhistoricaloptionstimeseriesbuild"
```

**All historical options functions (broad):**
```
resource.type="cloud_run_revision"
resource.labels.service_name=~"historicaloptions"
```

**Errors only (any historical options function):**
```
resource.type="cloud_run_revision"
resource.labels.service_name=~"historicaloptions"
severity>=ERROR
```

### Key Log Messages to Look For

| Service | Log Message | Meaning |
|---|---|---|
| Nightly | `[historical-options-nightly]` | Scheduler ran (check the report object) |
| Corpus Seed | `[corpus-seed] seed.store.success` | Corpus doc written to GCS |
| Corpus Seed | `[corpus-seed] seed.skip.gcs-hit` | Corpus doc already existed, skipped |
| Corpus Seed | `[corpus-seed] enqueued ts-build` | TS build task enqueued via onSeedSuccess |
| TS Build Task | `[ts-build-task] start` | TS build started for symbol+date |
| TS Build Task | `[ts-build-task] done` | TS build completed (check foundDates/missingDates) |
| Pilot | `trigger_pilot.start` | Pilot trigger received |
| Pilot | `trigger_pilot.success` | Pilot completed (check missingItems/executed) |
| TS Build HTTP | `trigger_time_series_build.start` | TS build trigger received |
| TS Build HTTP | `trigger_time_series_build.success` | TS build completed |

### Check Cloud Task Queues

```powershell
# List all task queues
gcloud tasks queues list --location us-central1 --project alpha-vantage-proxy-api

# Check a specific queue
gcloud tasks queues describe processHistoricalOptionsCorpusSeedTask --location us-central1 --project alpha-vantage-proxy-api
gcloud tasks queues describe processHistoricalOptionsTsBuildTask --location us-central1 --project alpha-vantage-proxy-api
```

---

## 11. Troubleshooting

### 403 Forbidden on HTTP Trigger

**Cause:** Either the auth token expired, or you're using a stale `cloudfunctions.net` URL.

**Fix:**
1. Regenerate token: `$token = gcloud auth print-identity-token`
2. Verify you're using the `.run.app` URL (see [Section 3](#3-cloud-run-service-urls))
3. Verify the `x-admin-secret` header value is correct

### Scheduler status.code: 13

**Cause:** The scheduler is targeting a wrong URL (Gen 1 `cloudfunctions.net` instead of Gen 2 `.run.app`).

**Fix:** See [Fix Stale Scheduler URL](#fix-stale-scheduler-url-gen-2-migration-issue) in Section 9.

### "No document to update" Error in Nightly Run

**Cause:** The `NightlyCorpusService` calls `planRun()` without passing `metadata`, so the Firestore run document is never created. Then `markRunStatus` fails with NOT_FOUND.

**Fix:** This was fixed by passing `metadata` to `planRun()`. If it recurs, check that `nightly-corpus.service.ts` line 50 includes `metadata: this.deps.metadata` in the `planRun` call.

### "Missing required symbol" Error from TS Build

**Cause:** The TS build trigger takes a single `symbol` (string), not `symbols` (array).

**Fix:** Use `"symbol":"QQQ"` in the body, not `"symbols":["QQQ"]`. Run separately for each symbol.

### TS Build Reports missingDates > 0

**Cause:** The corpus data for that date doesn't exist in GCS yet. Either the seed task hasn't completed or failed.

**Fix:**
1. Check corpus seed task logs (see [Section 10](#10-monitoring--logs))
2. Re-trigger the corpus seed via the pilot trigger (see [Section 5](#5-backfill-a-single-date))
3. Wait for seed tasks to complete, then re-run the TS build

### PowerShell `curl` Alias Issues

**Cause:** PowerShell aliases `curl` to `Invoke-WebRequest`, which has different parameter syntax.

**Fix:** Always use `Invoke-RestMethod` with PowerShell-native syntax. See all examples in this guide.

### `gcloud alpha logging tail` Hangs

**Cause:** `tail` streams indefinitely and doesn't support `--limit`.

**Fix:** Use Logs Explorer in the Cloud Console instead, or pipe to `Select-Object -First N`:
```powershell
gcloud alpha logging tail 'resource.type="cloud_run_revision" resource.labels.service_name="refreshhistoricaloptionscorpusnightly"' --project alpha-vantage-proxy-api --format="value(timestamp,textPayload)" 2>$null | Select-Object -First 20
```

---

## 12. Quick Reference Card

### Session Setup (run once per session)
```powershell
gcloud config set project alpha-vantage-proxy-api
$token = gcloud auth print-identity-token
$pilotSecret = gcloud secrets versions access latest --secret HISTORICAL_OPTIONS_PILOT_ADMIN_SECRET --project alpha-vantage-proxy-api
$tsSecret = gcloud secrets versions access latest --secret HISTORICAL_OPTIONS_TIME_SERIES_ADMIN_SECRET --project alpha-vantage-proxy-api
```

### Backfill Single Date (corpus + TS)
```powershell
# Step 1: Corpus seed (skips if already exists, auto-triggers TS build if new)
Invoke-RestMethod -Method POST -Uri "https://triggerhistoricaloptionspilot-lsluydmucq-uc.a.run.app" -Headers @{"Content-Type"="application/json";"x-admin-secret"=$pilotSecret;"Authorization"="Bearer $token"} -Body '{"symbols":["QQQ","TQQQ"],"startDate":"2026-07-30","referenceDate":"2026-07-30","maxTradingDatesPerSymbol":1,"dryRun":false,"execute":true}' | ConvertTo-Json -Depth 5

# Step 2 (only if Step 1 shows missingItems=0): TS build manually
Invoke-RestMethod -Method POST -Uri "https://triggerhistoricaloptionstimeseriesbuild-lsluydmucq-uc.a.run.app" -Headers @{"Content-Type"="application/json";"x-admin-secret"=$tsSecret;"Authorization"="Bearer $token"} -Body '{"symbol":"QQQ","startDate":"2026-07-30","endDate":"2026-07-30","execute":true}' | ConvertTo-Json -Depth 5
Invoke-RestMethod -Method POST -Uri "https://triggerhistoricaloptionstimeseriesbuild-lsluydmucq-uc.a.run.app" -Headers @{"Content-Type"="application/json";"x-admin-secret"=$tsSecret;"Authorization"="Bearer $token"} -Body '{"symbol":"TQQQ","startDate":"2026-07-30","endDate":"2026-07-30","execute":true}' | ConvertTo-Json -Depth 5
```

### Trigger Nightly Run Manually
```powershell
gcloud scheduler jobs run firebase-schedule-refreshHistoricalOptionsCorpusNightly-us-central1 --location us-central1 --project alpha-vantage-proxy-api
```

### Deploy Functions
```powershell
npx firebase deploy --only functions --project alpha-vantage-proxy-api
```

### Check Logs (URL)
```
https://console.cloud.google.com/logs/query?project=alpha-vantage-proxy-api
```

### Check Scheduler
```powershell
gcloud scheduler jobs describe firebase-schedule-refreshHistoricalOptionsCorpusNightly-us-central1 --location us-central1 --project alpha-vantage-proxy-api
```
