# How to Monitor SavantAPI Pipeline

**Last updated:** 2026-06-16  
**Applies to:** SavantAPI (alpha-vantage-proxy-api) — Cloud Functions v2, us-central1  
**Related docs:** [gcloud Deploy Workflow](./gcloud-deploy-workflow.md), [Backend Functions Overview](./backend-functions-overview.md)

---

## Overview

SavantAPI runs two primary data pipelines that populate Firestore for partner consumption:

| Pipeline | Schedule | Purpose | PDR runType |
|----------|----------|---------|-------------|
| **Intraday Snapshot** | Hourly (7am–12pm PT) during market hours | Fetches 1-min AV data, extracts latest bar, writes `ip`, `io`, `it`, `ic`, `ipc` to `sa-time-series` | `intraday-snapshot` |
| **Post-Close Time Series** | Once after market close (4pm PT) | Fetches daily/weekly/monthly OHLCV, populates historical bars | `ts-daily-post`, `ts-weekly-post`, `ts-monthly-post` |

This document explains how to monitor these pipelines for health, diagnose failures, and verify data delivery to partners (e.g., RS).

---

## Firestore as Canonical State

The ground truth for pipeline status lives in Firestore. All other monitoring (logs, metrics) derive from this.

### Intraday Pipeline

Collection: `intraday-runs`

```
intraday-runs/{runId} (document)
├── runId: "2025-06-16T09:30"
├── marketDate: "2025-06-16"
├── clockEt: "0930"                    # Hour label (0930, 1030, 1130...)
├── status: "complete" | "in_progress" | "failed"
├── trigger: "scheduler" | "manual"
├── createdJobs: 760                   # Symbols queued
├── finishedJobs: 760                  # Symbols processed
├── successJobs: 758
├── permanentFailureJobs: 2
├── runStartedAt: Timestamp
├── runFinishedAt: Timestamp
├── totalDuration: 184000             # ms
├── totalDurationFormatted: "03:04"
├── partnerDataReady: {               # PDR audit trail
│   ├── messageSent: true
│   ├── sendTime: Timestamp
│   └── messagePayload: { ... }
│ }
├── nonSuccessJobs: [                  # First 100 failures
│   { symbol: "XYZ", status: "PERMANENT_FAILURE", reason: "timeout" }
│ ]
└── jobs/{jobId} (subcollection)       # Per-symbol granular status
    ├── symbol: "AAPL"
    ├── status: "success"
    ├── createdAt: Timestamp
    ├── startedAt: Timestamp
    ├── finishedAt: Timestamp
    └── error: "..."                   # If failed
```

### Post-Close Pipeline

Collections: `time-series-runs` (legacy) and `realtime-runs` (v2)

Structure is similar but tracks DAILY, WEEKLY, MONTHLY intervals separately:

```
realtime-runs/{runId}
├── runId: "2025-06-16-POST"
├── phase: "post"
├── marketDate: "2025-06-16"
├── status: "complete"
├── intervalsCompleted: ["daily", "weekly", "monthly"]
├── symbolCount: 760
├── jobs (subcollection)
│   └── { symbol, status, interval, ... }
└── partnerDataReady: { ... }
```

---

## Structured Logs

All pipeline components emit structured JSON logs. Use **Logs Explorer** (`logging.googleapis.com`) with these queries.

### Intraday Pipeline Logs

| Log Message | Severity | Meaning |
|-------------|----------|---------|
| `intraday.agg.run_complete` | INFO | All jobs finished, PDR published |
| `intraday.agg.pdr_failed` | WARN | Run done but Pub/Sub publish failed |
| `intraday.agg.reconcile` | WARN | Reconcile triggered (lagging jobs) |
| `intraday.agg.run_complete_after_reconcile` | INFO | Reconcile finished, PDR published |
| `intraday.worker.fetch_start` | DEBUG | Job worker starting AV fetch |
| `intraday.worker.upsert_ok` | DEBUG | Firestore write successful |
| `intraday.worker.permanent_failure` | ERROR | Job failed after retries |

**Query:**
```sql
resource.type="cloud_function"
jsonPayload.message=~"intraday\.(agg|worker)\..*"
severity>=INFO
```

### Post-Close Pipeline Logs

| Log Message | When |
|-------------|------|
| `ts.agg.run_complete` | Post-close run done |
| `ts.agg.interval_complete` | Single interval (daily/weekly/monthly) done |
| `ts.worker.fetch_success` | Symbol fetch OK |
| `ts.worker.firestore_upsert` | Data written |

**Query:**
```sql
resource.type="cloud_function"
jsonPayload.message=~"ts\.(agg|worker)\..*"
```

### PDR Publish Logs

| Log Message | When |
|-------------|------|
| `pdr.enqueue` | PDR queued for publish |
| `pdr.publish_ok` | Pub/Sub acknowledged |
| `pdr.publish_error` | Pub/Sub failed (will retry) |

**Query:**
```sql
jsonPayload.message=~"pdr\..*"
```

---

## Health Metrics HTTP Endpoints

Internal HTTPS functions for programmatic monitoring.

### Get Overall Health Summary

```bash
GET /getHealthSummary
```

Returns aggregated status across all endpoints and symbols.

### Get Endpoint-Specific Health

```bash
GET /getHealthMetrics?endpoint=TIME_SERIES_INTRADAY
```

Returns:
```json
{
  "success": true,
  "data": {
    "endpointId": "TIME_SERIES_INTRADAY",
    "refreshStatus": "fresh",        // fresh | stale | error
    "lastRefreshAttempt": "2025-06-16T09:30:00Z",
    "symbols": {
      "total": 760,
      "fresh": 758,
      "stale": 0,
      "error": 2
    }
  }
}
```

Available endpoints: `TIME_SERIES_DAILY_ADJUSTED`, `TIME_SERIES_WEEKLY_ADJUSTED`, `TIME_SERIES_MONTHLY_ADJUSTED`, `TIME_SERIES_INTRADAY`

---

## Pub/Sub Metrics (PDR Delivery)

Monitor PDR message delivery to partners via **Pub/Sub Metrics**.

### Console Navigation

1. GCP Console → Pub/Sub → Topics → `partner-data-ready`
2. Click **Metrics** tab

### Key Metrics

| Metric | Description | Alert Threshold |
|--------|-------------|-----------------|
| `pubsub.googleapis.com/topic/send_message_operation_count` | Messages published per runType | N/A |
| `pubsub.googleapis.com/subscription/num_undelivered_messages` | Unacked messages (backlog) | > 100 for 5min |
| `pubsub.googleapis.com/subscription/pull_request_count` | Pull attempts by subscribers | N/A |

### Filter by runType

To see only intraday PDR volume:
```
resource.type = "pubsub_topic"
metric.labels.run_type = "intraday-snapshot"
```

---

## Cloud Functions Metrics

Monitor function execution health.

### Intraday Job Worker

Function: `processIntradaySnapshotJobTask`

| Metric | Where | Alert If |
|--------|-------|----------|
| Execution count | Cloud Functions → Metrics | Sudden drop (pipeline stalled) |
| Execution times (p95) | Cloud Functions → Metrics | > 30s consistently |
| Memory usage | Cloud Functions → Metrics | > 80% of limit |
| Error rate | Cloud Monitoring | > 5% for 10min |

### Post-Close Job Worker

Function: `processTimeSeriesJobTask`

Same metrics as above.

---

## Common Monitoring Scenarios

### Scenario 1: Verify Intraday Run Completed

**Check Firestore:**
```bash
gcloud firestore documents list --collection-group=intraday-runs \
  --filter="marketDate=2025-06-16" --limit=5
```

Look for:
- `status: "complete"`
- `partnerDataReady.messageSent: true`

**Check Logs:**
```sql
jsonPayload.message="intraday.agg.run_complete"
jsonPayload.marketDate="2025-06-16"
```

**Check PDR delivered:**
```bash
gcloud pubsub subscriptions pull partner-data-ready-sub --limit=5
# Look for attributes.runType="intraday-snapshot"
```

### Scenario 2: Diagnose Missing PDR

Symptom: RS reports no intraday data for market date.

**Step 1:** Check if run completed
```sql
jsonPayload.message=~"intraday.*"
jsonPayload.marketDate="2025-06-16"
severity>=WARNING
```

**Step 2:** Check PDR publish status
```sql
jsonPayload.message=~"pdr\..*"
jsonPayload.runId="2025-06-16T09:30"
```

**Step 3:** If `pdr.publish_error` found, check Pub/Sub topic health (permissions, quota).

### Scenario 3: High Failure Rate

Symptom: `permanentFailureJobs` > 5% of `createdJobs`.

**Query failed symbols:**
```bash
gcloud firestore documents list \
  --collection-group=jobs \
  --filter="status=PERMANENT_FAILURE" \
  --filter="parent:intraday-runs/2025-06-16T09:30"
```

**Check worker logs for specific error:**
```sql
jsonPayload.symbol="XYZ"
jsonPayload.message=~"intraday.worker\..*"
severity>=ERROR
```

Common causes:
- Alpha Vantage API rate limit (retry will fix)
- Invalid symbol (should be in tracked-symbols validation)
- Network timeout (transient)

### Scenario 4: Partner Reports Stale Data

Symptom: RS says data is old even though pipeline "completed".

**Verify Firestore data freshness:**
```bash
gcloud firestore documents get \
  symbol-data/AAPL/sa-time-series/av-daily-adjusted/years/2025
# Check bars[].io (intradayObservedAt) timestamp
```

**Verify PDR clockEt matches expectation:**
```sql
jsonPayload.message="intraday.agg.run_complete"
jsonPayload.clockEt="1130"  # Which hour?
```

---

## Alerting Recommendations

Configure Cloud Monitoring alerts for:

| Alert | Query/Condition | Severity |
|-------|-----------------|----------|
| Intraday run incomplete | `intraday-runs` doc without `partnerDataReady.messageSent=true` after 25min | P2 |
| PDR backlog | `subscription/num_undelivered_messages` > 100 for 5min | P2 |
| High job failure rate | `permanentFailureJobs / createdJobs > 0.1` | P2 |
| Function errors | `processIntradaySnapshotJobTask` error rate > 5% | P1 |

---

## Quick Reference Commands

```bash
# List recent intraday runs
gcloud firestore documents list --collection-group=intraday-runs --limit=10

# Get specific run status
gcloud firestore documents get intraday-runs/2025-06-16T09:30

# Check partner PDR audit
gcloud firestore documents get intraday-runs/2025-06-16T09:30 \
  --format="value(partnerDataReady.messageSent)"

# View job failures for a run
gcloud firestore documents list \
  intraday-runs/2025-06-16T09:30/jobs \
  --filter="status=PERMANENT_FAILURE"

# Pull recent PDR messages (manual inspection)
gcloud pubsub subscriptions pull partner-data-ready-sub --limit=5 --auto-ack
```

---

## Related Documentation

- [Backend Functions Overview](./backend-functions-overview.md)
- [gcloud Deploy Workflow](./gcloud-deploy-workflow.md)
- [Partner Integration Guide](../partner/partner-integration.md)
- [RS Partner Integration](../partner/rs-partner-integration.md)

---

**Questions?** Check logs first, then Firestore state. PDR issues → Pub/Sub metrics. Data freshness → symbol-data/{symbol} documents.
