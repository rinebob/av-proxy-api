# RSH Data-Ready Pub/Sub — Partner Integration Guide (SavantAPI)

RSH (Relative Strength Heatmap) is our Firebase/Cloud Run–backed application that computes and serves Relative Strength (RS) metrics and related signals to an Angular frontend. In this integration, SavantAPI acts as the upstream data provider for OHLCV and related datasets. When SavantAPI completes a scheduled load (e.g., pre-close or post-close), it notifies RSH via this Pub/Sub topic so RSH can begin RS computation and downstream processing without polling.

This guide explains how SavantAPI should notify the RSH backend when a scheduled data load completes. The Pub/Sub topic is server-to-server and secured with Google IAM.

Related reference in this repo:
- Topic, payload, and attributes overview: `docs/backend-functions-overview.md` → "Partner Data-Ready Notifications (Pub/Sub)"
- Compact bar schema and storage model: `docs/backend-functions-overview.md` → "Data Storage Model (Firestore)"

## At a glance (Prod)

- Pub/Sub topic: **partner-data-ready** (consumer‑agnostic channel for all partners)
- Allowlisted service account(s): TBD – SavantAPI to provide SA email(s) to be allowlisted per environment

## Pub/Sub Topic

All Data‑Ready events are published to the **partner-data-ready** Pub/Sub topic. Consumers (including RSH) should create a subscription to this topic and pull messages.

Message semantics:
* Each message contains the JSON payload described in the "Payload Schema (v1)" section.
* Pub/Sub provides at‑least‑once delivery; the `runId` field is idempotent.
* Use subscription filters on message attributes to target only the runs you need (see below).

## Authentication / Authorization (Pub/Sub IAM)

* The publisher (SavantAPI) must have the `roles/pubsub.publisher` role on the **partner-data-ready** topic.
* The consumer (RSH) must have the `roles/pubsub.subscriber` role on the subscription it creates, and optionally `roles/pubsub.viewer` to list the topic.
* No OIDC ID token is required for Pub/Sub delivery; IAM permissions control access.

## Payload Schema (v1)

The v1 payload is compact and now includes single-source freshness and finalization timestamps.

Minimal v1:

```json
{
  "version": "v1",
  "runId": "2025-09-11-post",
  "phase": "post",
  "intervals": ["DAILY"],
  "time": 1736726400000
}
```

Extended fields we recommend consuming when present:

- `marketDate`: `YYYY-MM-DD` trading date this run pertains to
- `counts`: `{ pendingCount, finalizedCountTotal, deltaCount }`
- `timing.finalizedAtUTC`: ISO string when we first detected finalized daily data (POST)
- `timing.nextRefreshAtUTC`: ISO string of the next scheduled refresh time for this cadence
- `header.runStatus`: `processing` | `completed`

Other optional fields: `env`, `durationMs`, `phaseWindow`, `datasetManifest`, `traceId`.

## Message Attributes and runType

To minimize consumer guesswork, each message includes a `runType` attribute:
- `ts_daily_pre`
- `ts_daily_post`
- `ts_weekly_post`
- `ts_monthly_post`
- (Non-time-series messages exist but RSH can ignore them.)

Example subscription filters:
- Time-series only (all phases):
  - `attributes.runType = "ts_daily_pre" OR attributes.runType = "ts_daily_post" OR attributes.runType = "ts_weekly_post" OR attributes.runType = "ts_monthly_post"`
- Finalized bars only (post-close):
  - `attributes.runType = "ts_daily_post" OR attributes.runType = "ts_weekly_post" OR attributes.runType = "ts_monthly_post"`

## Data readiness and shape guarantees

What "ready" means per `runType`:

- Daily PRE — `ts_daily_pre`
  - Latest daily bar entry per symbol may contain intraday snapshot fields:
    - `ip` (intraday price), `io` (observed-at epoch ms), `it` (observed-at clock string),
      `ic` (intraday absolute change), `ipc` (intraday percent change).
  - The daily OHLC for the current day is not finalized yet; it may still reflect the previous bar.
  - Parent doc is not freshness-bumped at PRE.
  - Intended for early computations that can incorporate a snapshot.

- Daily POST — `ts_daily_post`
  - Finalized daily bar written with full compact bar fields:
    - Core: `t`, `d?`, `o`, `h`, `l`, `c`, `v`, `ac`, `dv`, `sc`
    - Derived (if available): `pc`, `ch`, `cp`
  - Parent doc is updated:
    - `metadata.lastUpdated`, `metadata.ttlSeconds`, and consolidated `nextRefreshAtUTC`
  - `latestBarTimestamp` points to the most recent finalized bar
  - This is the canonical RS computation point for daily data.

- Weekly POST — `ts_weekly_post`
  - Finalized weekly bar written under `symbol-data/{SYMBOL}/time-series/av-weekly-adjusted` shards with compact bar fields.
  - Parent metadata updated accordingly.

- Monthly POST — `ts_monthly_post`
  - Finalized monthly bar written under `symbol-data/{SYMBOL}/time-series/av-monthly-adjusted` shards with compact bar fields.
  - Parent metadata updated accordingly.

Notes:
- Compact bar schema reference lives in `backend-functions-overview.md` under "Data Storage Model (Firestore)".
- PRE does not finalize OHLC and does not bump parent freshness; POST finalizes and bumps.

## Pub/Sub Subscription Example (gcloud)

Replace placeholder:
* `<SA_EMAIL>` – the service account email that will **pull** messages (RSH’s service account).

### Create a pull subscription

```bash
# Create a subscription named rsh-partner-data-ready on the partner-data-ready topic
gcloud pubsub subscriptions create rsh-partner-data-ready \
  --topic=partner-data-ready \
  --ack-deadline=60

# Grant the RSH service account permission to pull from this subscription
gcloud pubsub subscriptions add-iam-policy-binding rsh-partner-data-ready \
  --member=serviceAccount:<SA_EMAIL> \
  --role=roles/pubsub.subscriber
```

### Pull messages (Node.js example)

```ts
import { PubSub } from '@google-cloud/pubsub';

const pubsub = new PubSub();
const subscription = pubsub.subscription('rsh-partner-data-ready');

subscription.on('message', message => {
  const payload = JSON.parse(message.data.toString());
  console.log('Received Data‑Ready event:', payload);
  // TODO: Process the payload (e.g., start RS computation)
  message.ack();
});

subscription.on('error', err => {
  console.error('Subscription error:', err);
});
```

## Environments

- Use distinct service accounts per environment, if desired (staging vs prod).
- RSH maintains an email allowlist per environment via `ALLOWED_SERVICE_ACCOUNT_EMAILS`.
- Use the correct base URL (audience) and endpoint per environment.

## Troubleshooting

- Ensure the subscription filter matches the exact `runType` values needed.
- Verify IAM on the subscription grants `roles/pubsub.subscriber` to the RSH service account.
- Use dead-letter policies and retry settings suitable for your processing pipeline.

## Contact

Please share the service account email(s) you will use per environment so we can allowlist them and grant `run.invoker` on the RSH service. Provide the expected schedule for pre/post runs so we can monitor end-to-end. **Note:** We are currently awaiting the service account email(s) to be provided by SavantAPI. Once received, we will update the allowlist and grant the necessary permissions.

---

## Appendix: Identifiers & System Docs (FYI)

- `runId` format:
  - Scheduled: `YYYY-MM-DD-pre` | `YYYY-MM-DD-post`
  - Manual/test: `YYYY-MM-DD-pre-<suffix>` or `YYYY-MM-DD-post-<suffix>` where `<suffix>` is 1–16 lowercase letters/digits (e.g., `-manual-1905`).
- We maintain internal system documents under `system/` for status/finalization. Partners do not need these, but for transparency:
  - Root docs: `system/time-series-status`, `system/time-series-finalization` contain metadata/timing.
  - Leaf per-date docs exist for our own auditing and omit metadata.
