# Time-Series Scheduler Cheat Sheet

Project: `alpha-vantage-proxy-api`
Region: `us-central1`

All commands can be run from any terminal / default project as long as you pass `--project=alpha-vantage-proxy-api` and `--location=us-central1`.

---

## Manual Scheduler Triggers

### Daily TIME_SERIES_DAILY_ADJUSTED (POST close)

```bash
gcloud scheduler jobs run \
  firebase-schedule-refreshAvDailyTimeSeriesPostClose-us-central1 \
  --location=us-central1 \
  --project=alpha-vantage-proxy-api
```

### Weekly TIME_SERIES_WEEKLY_ADJUSTED (POST close)

```bash
gcloud scheduler jobs run \
  firebase-schedule-refreshAvWeeklyTimeSeriesPostClose-us-central1 \
  --location=us-central1 \
  --project=alpha-vantage-proxy-api
```

### Monthly TIME_SERIES_MONTHLY_ADJUSTED (POST close)

```bash
gcloud scheduler jobs run \
  firebase-schedule-refreshAvMonthlyTimeSeriesPostClose-us-central1 \
  --location=us-central1 \
  --project=alpha-vantage-proxy-api
```

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

### `TS_PARTNER_VERBOSE_MESSAGES`

Enables **verbose partner notifications** from the time-series job worker.

When turned **on**, the worker will, **in addition to** the normal baseline / 10-symbol batching semantics, publish a **single-symbol** `partner-symbols-ready` message for **every SUCCESS job** (per `symbol` + `interval`).

- These verbose messages:
  - Use `reason="verbose"` in the JSON payload.
  - Include an `interval` field in the payload (e.g. `DAILY`, `WEEKLY`, `MONTHLY`).
  - Add a Pub/Sub attribute `verbose=true` (no extra interval attribute).
- The existing production behavior (wait for all intervals, then batch baselines and 10-symbol groups with `reason="scheduled"`) is **unchanged**.

- Disable verbose mode (default):

  ```text
  TS_PARTNER_VERBOSE_MESSAGES=off
  ```

- Enable verbose mode (extra per-symbol messages for testing RS integration):

  ```text
  TS_PARTNER_VERBOSE_MESSAGES=on
  ```

---

## Quick Logs Explorer Filters

Project: `alpha-vantage-proxy-api`

- Daily scheduler (per-symbol job creation / enqueue):

  ```text
  resource.type="cloud_run_revision"
  resource.labels.service_name="refreshavdailytimeseriespostclose"
  jsonPayload.symbol="AVGO"  # replace with symbol of interest
  ```

- Job worker (per-symbol execution / newly ready):

  ```text
  resource.type="cloud_run_revision"
  resource.labels.service_name:"processtimeseriesjobtask"
  jsonPayload.symbol="AVGO"
  ```

- Symbol-ready publishes (batches containing symbol):

  ```text
  resource.type="cloud_run_revision"
  jsonPayload.message:"SYMBOLS-READY.PUBLISH"
  jsonPayload.symbols:"AVGO"
  ```

---

## Cloud Run Services & Environment Variables

The schedulers and workers for this pipeline run as **Cloud Run services** behind Firebase Functions v2.

### Relevant Cloud Run Services

In project `alpha-vantage-proxy-api` you will typically see at least:

- `refreshavdailytimeseriespostclose`
- `refreshavweeklytimeseriespostclose`
- `refreshavmonthlytimeseriespostclose`
- `processtimeseriesjobtask` (Cloud Tasks worker for time-series jobs)

> Note: Service names are visible in Logs Explorer as `resource.labels.service_name` and in the Cloud Run UI.

### How to View / Update Env Vars in GCP Console

For **any** of the above services:

1. Go to **Google Cloud Console** for project `alpha-vantage-proxy-api`.
2. Navigate to **Cloud Run → Services**.
3. Click the service you want to inspect, e.g. `refreshavdailytimeseriespostclose` or `processtimeseriesjobtask`.
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

- **Schedulers** (e.g. `refreshavdailytimeseriespostclose`):
  - `TS_JOB_TEST_SYMBOL` – controls which symbols get jobs for that run.

- **Job worker** (`processtimeseriesjobtask`):
  - `TS_TIME_SERIES_TASKS_ENABLED` – must be `true` for tasks to run and emit symbol-ready messages.

Changes take effect per **new revision** of each service; you may need to update both the scheduler services and the worker service depending on what you’re testing.

---
