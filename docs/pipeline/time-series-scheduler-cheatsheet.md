# Time-Series Scheduler Cheat Sheet

Project: `alpha-vantage-proxy-api`
Region: `us-central1`

All commands can be run from any terminal / default project as long as you pass `--project=alpha-vantage-proxy-api` and `--location=us-central1`.

---

## Manual Scheduler Triggers (A/B/C Pipeline)

### A Run — POST all intervals (4:35 PM ET)

```bash
gcloud scheduler jobs run \
  firebase-schedule-refreshAvTimeSeriesPostAllIntervals-us-central1 \
  --location=us-central1 \
  --project=alpha-vantage-proxy-api
```

### B Run — Evening retry (9:00 PM ET)

```bash
gcloud scheduler jobs run \
  firebase-schedule-refreshAvDailyTimeSeriesPostEveningRetry00-us-central1 \
  --location=us-central1 \
  --project=alpha-vantage-proxy-api
```

### C Run — Morning retry (7:00 AM ET next day)

```bash
gcloud scheduler jobs run \
  firebase-schedule-refreshAvDailyTimeSeriesPostMorning0700-us-central1 \
  --location=us-central1 \
  --project=alpha-vantage-proxy-api
```

> **Note:** The A run processes all intervals (DAILY, WEEKLY, MONTHLY) for the full symbol universe. B and C runs only process retry symbols (symbols that failed or returned stale data in the prior run).

---

## Key Environment Variables

These must be set on the **Cloud Run services** backing the refresh functions (not just locally):

### `TS_JOB_TEST_SYMBOL`

Restricts which symbols the schedulers will create/enqueue jobs for during a run.

Examples:

- Baseline ETFs:

  ```text
  TS_JOB_TEST_SYMBOL=SPY,QQQ,XBI,XLC,XLE,XLF,XLI,XLK,XLU,XLV,XLY,XME,XSD
  ```

- Master list symbols 31–40:

  ```text
  TS_JOB_TEST_SYMBOL=ADI,ADM,ADP,ADSK,AEE,AEP,AES,AFL,AIG,AIZ
  ```

- Master list symbols 41–60:

  ```text
  TS_JOB_TEST_SYMBOL=APTV,ARE,ARES,ATO,AVB,AVGO,AVY,AWK,AXON,AXP,AZO,BA,BAC,BALL,BAX,BBY,BDX,BEN,BF-B,BG
  ```

### `TS_TIME_SERIES_TASKS_ENABLED`

Controls whether the Cloud Tasks worker (`processTimeSeriesJobTask`) actually processes jobs and emits symbol-ready messages in non-emulator environments.

- Disable job worker (no task processing, no symbol-ready publishes):

  ```text
  TS_TIME_SERIES_TASKS_ENABLED=false
  ```

- Enable job worker (tasks will run, pipeline fully active):

  ```text
  TS_TIME_SERIES_TASKS_ENABLED=true
  ```

---

## Logging & Logs Explorer Filters (betterLogger dialect)

Project: `alpha-vantage-proxy-api`

### Abbreviations

- Scheduler (time-series, `av-refresh-manager.ts`):
  - **file**: `aVRM`
  - **function**: `rFE` (`refreshForEndpoints`)
- Worker (time-series jobs, `time-series-jobs.worker.ts`):
  - **file**: `tSJ.w`
  - **function**: `pSJI` (`processTimeSeriesJobInternal`)
- Partner symbols-ready publisher (`symbols-ready.publisher.ts`):
  - **file**: `sR.P`
  - **function**: `pSRB` (`publishSymbolsReadyBatch`)

### Example log lines

- Scheduler, per-symbol job creation:

  ```text
  [aVRM rFE] event=ts.jobs.create sym=AVGO int=DAILY mktDate=2026-01-05 ep=TIME_SERIES_DAILY_ADJUSTED level=info
  ```

- Worker, per-job lifecycle:

  ```text
  [tSJ.w pSJI] event=ts.jobs.worker.start sym=AVGO int=DAILY mktDate=2026-01-05 ep=TIME_SERIES_DAILY_ADJUSTED level=info
  [tSJ.w pSJI] event=ts.jobs.worker.success sym=AVGO int=DAILY mktDate=2026-01-05 ep=TIME_SERIES_DAILY_ADJUSTED level=info
  ```

- Symbols-ready publish:

  ```text
  [sR.P pSRB] event=symbols.ready.publish sym=AVGO int=DAILY mktDate=2026-01-05 ep=SYMBOLS_READY level=info
  ```

### Quick filters for a single symbol

- **Full pipeline (scheduler + worker + publisher) for one symbol**:

  ```text
  text:"sym=AVGO" AND (text:"[aVRM rFE]" OR text:"[tSJ.w pSJI]" OR text:"[sR.P pSRB]")
  ```

- **Scheduler job creation/enqueue for one symbol**:

  ```text
  text:"[aVRM rFE]" AND text:"sym=AVGO"
  ```

- **Worker executions for one symbol**:

  ```text
  text:"[tSJ.w pSJI]" AND text:"sym=AVGO"
  ```

- **Symbols-ready publishes containing a symbol**:

  ```text
  text:"[sR.P pSRB]" AND text:"sym=AVGO"
  ```

---

## Logs Explorer: View a Full Time-Series Run

Use this query to see all logs for the time-series job pipeline (scheduler → tasks → worker → partner notifications) within a selected time window.

```text
resource.type="cloud_run_revision"
resource.labels.service_name=(
  "refreshAvTimeSeriesPostAllIntervals" OR
  "refreshAvDailyTimeSeriesPostEveningRetry00" OR
  "refreshAvDailyTimeSeriesPostMorning0700" OR
  "processTimeSeriesJobTask" OR
  "processTimeSeriesJobDev" OR
  "onDailyAdjustedFinalizedPublish"
)
```

**Usage:**

- **GCP console Logs Explorer:**  
  https://cloudlogging.app.goo.gl/FGFyBPQRwKGm7gyS6  
  This link has the above filter with a 30-minute window.

- **[scope window]** After triggering a scheduler (for example, `refreshAvDailyTimeSeriesPostClose`), open Logs Explorer and set the query above.
- **[time range]** Use the time dropdown to select a window around when the scheduler fired:
  - For ad-hoc runs, choose a relative range such as `Last 15 minutes`.
  - For precise inspection, choose a custom start/end time that tightly brackets the run.
- **[display]** Turn off **Hide similar log entries** and sort by timestamp ascending.

You should see, in order:

- **[scheduler]** Cloud Scheduler HTTP invocation of the `refreshAv*TimeSeries*` function.
- **[TS manager]** `aVTSRM rTSJFE` logs:
  - `ts.jobs.test_symbol_mode` (when test-symbol filtering is enabled).
  - `START/END ts.jobs.scheduler` (symbol loop banners).
  - `START/END ts.jobs.processing` per symbol.
  - `ts.jobs.write_new` / `ts.jobs.write_update` for each job document.
  - `ts.jobs.run_summary` with a count of symbols processed.
- **[Cloud Tasks]** `tSJ.t pSJT` logs for `job.task.start` / `job.task.complete` per symbol.
- **[worker]** `tSJ.w pSJI` logs:
  - `ts.jobs.worker.start` / `ts.jobs.worker.success` and related events.
- **[handler]** `aVTS.H` time-series handler logs:
  - `ts.handler.fetch.*`, `ts.handler.firestore.compact`, and related events.
- **[partner readiness]**
  - `symbols.ready.publish` (`sR.P pSRB`) for each symbol.
  - `runs.upsert.*` and `runs.end.doc` (`pDR.H eDRI`, `DATA_READY_RUN`) at the run level.

This single query plus a focused time window provides an end-to-end view of a time-series job run across scheduler, job manager, worker, and partner notifications.

---

## Cloud Run Services & Environment Variables

The schedulers and workers for this pipeline run as **Cloud Run services** behind Firebase Functions v2.

### Relevant Cloud Run Services

In project `alpha-vantage-proxy-api` you will typically see at least:

- `refresh-av-time-series-post-all-intervals` (A run — all intervals)
- `refresh-av-daily-time-series-post-evening-retry` (B run — evening retry)
- `refresh-av-daily-time-series-post-morning-retry` (C run — morning retry)
- `process-time-series-job-task` (Cloud Tasks worker for time-series jobs)

> Note: Service names are visible in Logs Explorer as `resource.labels.service_name` and in the Cloud Run UI.

### How to View / Update Env Vars in GCP Console

For **any** of the above services:

1. Go to **Google Cloud Console** for project `alpha-vantage-proxy-api`.
2. Navigate to **Cloud Run → Services**.
3. Click the service you want to inspect, e.g. `refreshavtimeseriespostallintervals` or `processtimeseriesjobtask`.
4. In the service detail page, click the **Edit & deploy new revision** button.
5. Scroll down to the **Environment variables, secrets & volumes** section.
6. Under **Environment variables**:
   - To **view** current values, expand the list.
   - To **update** a value (e.g. `TS_JOB_TEST_SYMBOL`, `TS_TIME_SERIES_TASKS_ENABLED`):
     - Edit the value in-place.
   - To **add** a new variable:
     - Click **Add variable**, enter the name and value, e.g.:

       ```text
       Name:  TS_JOB_TEST_SYMBOL
       Value: AVB,AVGO
       ```

7. Click **Deploy** to create a new revision with the updated environment.

Environment variables to keep in sync across this pipeline:

- **Schedulers** (e.g. `refreshavtimeseriespostallintervals`):
  - `TS_JOB_TEST_SYMBOL` – controls which symbols get jobs for that run.

- **Job worker** (`processtimeseriesjobtask`):
  - `TS_TIME_SERIES_TASKS_ENABLED` – must be `true` for tasks to run and emit symbol-ready messages.

Changes take effect per **new revision** of each service; you may need to update both the scheduler services and the worker service depending on what you’re testing.

---
