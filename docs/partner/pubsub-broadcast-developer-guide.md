# Pub/Sub Message Broadcast Infrastructure — Developer Guide

**Audience:** Internal SA engineers building new broadcast channels and external partner engineers consuming them.  
**Scope:** How to build, secure, deploy, and operate a Google Cloud Pub/Sub broadcast where `alpha-vantage-proxy-api` (SA) is the **source/producer** and partner projects are the **receivers/consumers**.  
**Last updated:** 2026-07-08

---

## 1. Architecture Overview

The broadcast pattern uses a **producer-owned topic** in the SA GCP project.  Partner projects do not poll SA; they subscribe to the topic using either an **Eventarc-triggered Cloud Functions v2** handler (push) or a **native Pub/Sub subscription** (pull).  All authorization is performed with service accounts and IAM bindings, not API keys.

```text
┌─────────────────────────────────────┐          ┌─────────────────────────────────────┐
│  alpha-vantage-proxy-api (Project A)│          │  rel-str (Project B)                │
│                                     │          │                                     │
│  Cloud Functions / Schedulers         │          │  Cloud Functions v2 (Eventarc)      │
│        │                            │          │        ▲                            │
│        ▼ publishMessage()            │          │        │ trigger                     │
│  projects/alpha-vantage-proxy-api/   │◄─────────│  Eventarc service agent             │
│  topics/partner-data-ready          │  IAM     │        │                            │
│  topics/partner-symbols-ready       │  grants  │        ▼                            │
│                                     │          │  Pull subscription (optional)        │
└─────────────────────────────────────┘          └─────────────────────────────────────┘
```

Key design points:

- **SA owns the topic.**  Consumers never create topics in the SA project.
- **Cross-project IAM is minimal.**  Consumer service accounts receive only `roles/pubsub.subscriber` (and optionally `roles/pubsub.viewer`) on the SA topic.
- **Publisher identity is explicit.**  The SA Cloud Functions runtime service account is granted `roles/pubsub.publisher` on each topic it writes to.
- **Payloads are versioned.**  Every JSON message includes a `version` field and stable attributes so consumers can filter, route, and evolve independently.

---

## 2. Concepts & Roles

### 2.1 Projects

| Role | In this guide | Real example |
|------|---------------|--------------|
| **Producer project (Project A)** | Owns the Pub/Sub topic and runs the publishers. | `alpha-vantage-proxy-api` |
| **Consumer project (Project B)** | Receives messages via Eventarc trigger or pull subscription. | `rel-str` |

### 2.2 Service accounts

| Identity | Purpose | Typical email |
|----------|---------|---------------|
| **Producer runtime SA** | Cloud Functions / Compute identity that calls `topic.publishMessage()`. | `29825344315-compute@developer.gserviceaccount.com` |
| **Consumer Eventarc service agent** | Google-managed SA that creates and manages the cross-project trigger. | `service-<CONSUMER_PROJECT_NUMBER>@gcp-sa-eventarc.iam.gserviceaccount.com` |
| **Consumer runtime SA** | Identity under which the consumer Cloud Function runs. | `<CONSUMER_PROJECT_ID>@appspot.gserviceaccount.com` |
| **Deploy principal** | Human or CI identity that runs `firebase deploy` / `gcloud` in the consumer project. | `you@your-domain.com` |

### 2.3 Resources

| Resource | Producer example | Consumer example |
|----------|------------------|------------------|
| Topic | `projects/alpha-vantage-proxy-api/topics/partner-data-ready` | referenced by full resource name |
| Subscription | created implicitly by Eventarc | `projects/rel-str/subscriptions/...` |
| Trigger | n/a | Eventarc Pub/Sub trigger on `google.cloud.pubsub.topic.v1.messagePublished` |

---

## 3. Channels in Production

All topic IDs are declared in the partner constants module:

```@c:\aa\projects\av-proxy-api\functions\src\v2\partner\constants.ts:10-14
/** Pub/Sub topic for partner data-ready notifications. */
export const PARTNER_DATA_READY_TOPIC = 'partner-data-ready';

/** Pub/Sub topic for symbol-level readiness notifications. */
export const PARTNER_SYMBOLS_READY_TOPIC = 'partner-symbols-ready';
```

### 3.1 `partner-data-ready`

Universe-level lifecycle notifications.  Tells consumers that a refresh run has started, progressed, or completed for a given market date and phase.

Example publishers:

- `@c:\aa\projects\av-proxy-api\functions\src\v2\partner\data-ready.handler.ts:12-39` — core internal publisher used by scheduled jobs.
- `@c:\aa\projects\av-proxy-api\functions\src\v2\partner\time-series-run-completion.publisher.ts:113-132` — emits END events when the A/B/C time-series job aggregator finishes.
- `@c:\aa\projects\av-proxy-api\functions\src\v2\partner\heartbeat.publisher.ts` — periodic connectivity/liveness messages.
- `@c:\aa\projects\av-proxy-api\functions\src\v2\partner\finalization.publisher.ts` — emits when daily adjusted bars are finalized.

### 3.2 `partner-symbols-ready`

Symbol-level batch notifications.  Tells consumers that a specific list of symbols is ready for a given interval and market date.

Example publisher:

```@c:\aa\projects\av-proxy-api\functions\src\v2\partner\symbols-ready.publisher.ts:1-14
export interface SymbolsReadyPayloadV1 {
  version: 'v1';
  marketDate: string; // YYYY-MM-DD
  symbols: string[];
  runId?: string;
  reason?: 'scheduled' | 'backfill';
  // Interval label so partners know which endpoint to hit, e.g. DAILY/WEEKLY/MONTHLY
  interval: string;
  publishedAtUTC?: string;
}
```

---

## 4. Payload Contracts

### 4.1 Design rules

1. **Every payload has a `version` field.**  Current production messages use `'v1'`.
2. **Keep the JSON body stable.**  Add optional fields; avoid renaming or removing existing fields.
3. **Put routing/filtering metadata in Pub/Sub attributes.**  Attributes are lightweight, indexed by subscriptions, and visible in Logs Explorer without decoding the body.
4. **Use ISO-8601 / epoch timestamps consistently.**  Prefer `time` (epoch ms) in the body and string timestamps for human-readable fields.
5. **Include a correlation ID.**  `runId` is the canonical identifier for partner-data-ready messages.

### 4.2 `DataReadyPayloadV1`

Full TypeScript interface and validator:

```@c:\aa\projects\av-proxy-api\functions\src\v2\partner\schemas\data-ready.schema.ts:4-61
export interface DataReadyPayloadV1 {
  version: 'v1';
  runId: string; // YYYY-MM-DD-pre|post[-suffix]
  phase: PartnerPhase;
  intervals: TimeSeriesInterval[];
  time: number; // epoch ms
  baselinesUpdatedCount?: number;
  symbolsUpdatedCount?: number;
  universeVersion?: string;

  // Optional recommended fields
  marketDate?: string; // YYYY-MM-DD
  tz?: string; // IANA
  durationMs?: number;
  phaseWindow?: { start: number; end: number };
  datasetManifest?: string; // URL or gs:// path
  env?: 'staging' | 'prod' | string;
  traceId?: string;

  // New: origin of the message (manual, scheduled, heartbeat, test)
  trigger?: PartnerTrigger;
  ...
}
```

Common attributes attached at publish time:

```@c:\aa\projects\av-proxy-api\functions\src\v2\partner\data-ready.handler.ts:169-182
const attributes: Record<string, string> = {
  runId: validPayload.runId,
  version: validPayload.version,
  phase: validPayload.phase,
};
if (validPayload.marketDate) attributes.marketDate = validPayload.marketDate;
if (validPayload.env) attributes.env = validPayload.env;
if (validPayload.nextRefreshAtUTC) attributes.NextRefreshAt = validPayload.nextRefreshAtUTC;
```

### 4.3 `SymbolsReadyPayloadV1`

Attributes are derived from the payload automatically:

```@c:\aa\projects\av-proxy-api\functions\src\v2\partner\symbols-ready.publisher.ts:45-50
const attrs: Record<string, string> = {
  marketDate: jsonPayload.marketDate,
  ...(jsonPayload.runId ? { runId: jsonPayload.runId } : {}),
  ...(jsonPayload.reason ? { reason: jsonPayload.reason } : {}),
  ...(attributes || {}),
};
```

---

## 5. Producer Implementation

### 5.1 Topic creation

Create the topic in the producer project before any code tries to publish.

```bash
PRODUCER_PROJECT_ID="alpha-vantage-proxy-api"
TOPIC_ID="partner-data-ready"

gcloud pubsub topics create "$TOPIC_ID" \
  --project="$PRODUCER_PROJECT_ID"
```

Repeat for each channel (`partner-symbols-ready`, etc.).

### 5.2 Publisher code pattern

All SA publishers follow the same pattern:

```@c:\aa\projects\av-proxy-api\functions\src\v2\partner\symbols-ready.publisher.ts:32-53
const { PubSub } = await import('@google-cloud/pubsub');
const projectId = process.env.GOOGLE_CLOUD_PROJECT || process.env.GCP_PROJECT;
const pubsub = projectId ? new PubSub({ projectId }) : new PubSub();
const topicName = PARTNER_SYMBOLS_READY_TOPIC;
const topic = pubsub.topic(topicName);

const jsonPayload: SymbolsReadyPayloadV1 = {
  ...payload,
  version: 'v1',
  publishedAtUTC: payload.publishedAtUTC || new Date().toISOString(),
};

const messageId = await topic.publishMessage({ json: jsonPayload, attributes: attrs });
```

Important implementation notes:

- **Lazy import.**  `@google-cloud/pubsub` is imported dynamically so it is not loaded in code paths that do not publish.
- **ProjectId fallback.**  Uses `GOOGLE_CLOUD_PROJECT` or `GCP_PROJECT` when present; otherwise lets the client infer from ADC.
- **Emulator auto-create.**  If the topic does not exist in the emulator, the publisher creates it once and retries:

```@c:\aa\projects\av-proxy-api\functions\src\v2\partner\data-ready.handler.ts:22-38
  } catch (err: any) {
    const isEmulator = process.env.FUNCTIONS_EMULATOR === 'true' || !!process.env.PUBSUB_EMULATOR_HOST;
    if (isEmulator && (err?.code === 5 || (typeof err?.message === 'string' && err.message.includes('NOT_FOUND')))) {
      try {
        await pubsub.createTopic(topicName);
      } catch (createErr: any) {
        if (createErr?.code !== 6) {
          throw err;
        }
      }
      return await topic.publishMessage({ json: payload, attributes });
    }
    throw err;
  }
```

- **Publishers are pure side-effect modules.**  They do not perform HTTP auth; they run inside already-authenticated Cloud Functions or scripts with Application Default Credentials (ADC).

### 5.3 Where to add a new publisher

1. Add the topic constant to `@c:\aa\projects\av-proxy-api\functions\src\v2\partner\constants.ts`.
2. Create a new single-concern publisher file under `@c:\aa\projects\av-proxy-api\functions\src\v2\partner/` (e.g. `my-channel.publisher.ts`).
3. Export a typed payload interface and a publish function.
4. Call the publish function from the scheduler, trigger, or HTTP function that owns the business event.
5. Do **not** put business logic inside the publisher; keep it focused on message serialization and delivery.

### 5.4 HTTP publisher entry point

For manual / testing / emergency publishes, SA exposes a secure HTTP function:

```@c:\aa\projects\av-proxy-api\functions\src\v2\partner\data-ready.publish.function.ts:27-37
export const partnerDataReadyPublishV2 = onRequest(async (req: Request, res: Response) => {
  // CORS preflight
  if (handleOptionsRequest(req, res)) return;

  if (req.method !== 'POST') {
    setCorsHeaders(res);
    res.status(405).json({ ok: false, error: 'Method Not Allowed', message: 'Use POST with JSON body.' });
    return;
  }

  // Auth (dual-path)
  const auth = await authenticateRequestEither(req as any, res as any);
  if (!auth) return; // authenticateRequestEither already responded with error
```

This endpoint uses the same dual-auth middleware as the partner HTTPS surface (`authenticateRequestEither`), so callers must present a Firebase ID token or a Google OIDC ID token from an allowlisted service account.  See `@c:\aa\projects\av-proxy-api\docs\partner\partner-auth-and-audience.md`.

### 5.5 Direct publisher script

For local / CI / ad-hoc publishing without HTTP:

```bash
npx ts-node functions/scripts/partner/partner-data-ready-direct.ts --autofill --env prod --verbose
```

The script is documented at `@c:\aa\projects\av-proxy-api\docs\partner\partner-data-ready-test-runs.md`.

---

## 6. Consumer Implementation

### 6.1 Choose a receive model

| Model | Best for | Complexity |
|-------|----------|------------|
| **Eventarc push → Cloud Functions v2** | Serverless, automatic scaling, retries, and logs. | Lowest |
| **Native pull subscription** | Long-running services that need batching, flow control, or custom ack deadlines. | Medium |
| **Pub/Sub to Cloud Run / GKE** | Containerized consumers with HTTP push. | Medium |

This guide focuses on **Eventarc + Cloud Functions v2** because it is the pattern used by existing partner integrations.

### 6.2 Eventarc handler pattern

In the consumer project, define a Cloud Function triggered by Pub/Sub message publication:

```typescript
import { onMessagePublished } from 'firebase-functions/v2/pubsub';

export const processDataReady = onMessagePublished(
  {
    topic: 'projects/alpha-vantage-proxy-api/topics/partner-data-ready',
    region: 'us-central1',
  },
  async (event) => {
    // The message data arrives base64-encoded.
    const raw = event.data.message.data;
    const jsonString = Buffer.from(raw, 'base64').toString('utf8');
    const payload = JSON.parse(jsonString);

    // Attributes are plain strings and useful for routing/filtering.
    const attrs = event.data.message.attributes;
    console.log('Received data-ready', { runId: attrs.runId, phase: attrs.phase, payload });

    // Idempotent processing goes here.
  }
);
```

### 6.3 Decoding the message

Pub/Sub always delivers the body as base64.  Never assume the payload is plain JSON.  A robust consumer does:

```typescript
function decodePubSubMessage<T>(message: { data?: string; attributes?: Record<string, string> }): { body: T; attributes: Record<string, string> } {
  if (!message.data) {
    throw new Error('Missing message data');
  }
  const jsonString = Buffer.from(message.data, 'base64').toString('utf8');
  return { body: JSON.parse(jsonString), attributes: message.attributes || {} };
}
```

### 6.4 Attribute-based filtering

Create a subscription with a filter so the consumer function only receives relevant messages:

```bash
gcloud pubsub subscriptions create data-ready-post-prod \
  --topic="projects/alpha-vantage-proxy-api/topics/partner-data-ready" \
  --filter='attributes.phase="post" AND attributes.env="prod"' \
  --project="rel-str"
```

Filterable attributes from SA publishers include `runId`, `version`, `phase`, `marketDate`, `env`, `NextRefreshAt`, `runType`, `successes`, `failures`, `barStatusDaily`, etc.

---

## 7. IAM & Security

### 7.1 Required APIs

#### Producer project (`alpha-vantage-proxy-api`)

```bash
gcloud services enable pubsub.googleapis.com --project="alpha-vantage-proxy-api"
```

#### Consumer project (`rel-str`)

```bash
gcloud services enable \
  cloudfunctions.googleapis.com \
  eventarc.googleapis.com \
  run.googleapis.com \
  pubsub.googleapis.com \
  --project="rel-str"
```

### 7.2 Least-privilege IAM on the producer topic

Look up project numbers once:

```bash
CONSUMER_PROJECT_ID="rel-str"
PRODUCER_PROJECT_ID="alpha-vantage-proxy-api"

CONSUMER_PROJECT_NUMBER="$(gcloud projects describe "$CONSUMER_PROJECT_ID" --format='value(projectNumber)')"
PRODUCER_PROJECT_NUMBER="$(gcloud projects describe "$PRODUCER_PROJECT_ID" --format='value(projectNumber)')"
```

Grant the consumer Eventarc service agent subscriber rights on the SA topic:

```bash
gcloud pubsub topics add-iam-policy-binding \
  "projects/$PRODUCER_PROJECT_ID/topics/partner-data-ready" \
  --member="serviceAccount:service-$CONSUMER_PROJECT_NUMBER@gcp-sa-eventarc.iam.gserviceaccount.com" \
  --role="roles/pubsub.subscriber" \
  --project="$PRODUCER_PROJECT_ID"
```

Optional but helpful for debugging:

```bash
gcloud pubsub topics add-iam-policy-binding \
  "projects/$PRODUCER_PROJECT_ID/topics/partner-data-ready" \
  --member="serviceAccount:service-$CONSUMER_PROJECT_NUMBER@gcp-sa-eventarc.iam.gserviceaccount.com" \
  --role="roles/pubsub.viewer" \
  --project="$PRODUCER_PROJECT_ID"
```

Grant the producer runtime service account publisher rights:

```bash
gcloud pubsub topics add-iam-policy-binding \
  "projects/$PRODUCER_PROJECT_ID/topics/partner-data-ready" \
  --member="serviceAccount:$PRODUCER_PROJECT_NUMBER-compute@developer.gserviceaccount.com" \
  --role="roles/pubsub.publisher" \
  --project="$PRODUCER_PROJECT_ID"
```

Repeat for every topic (`partner-symbols-ready`, etc.).

Expected minimal IAM policy:

```yaml
bindings:
- role: roles/pubsub.publisher
  members:
  - serviceAccount:29825344315-compute@developer.gserviceaccount.com
- role: roles/pubsub.subscriber
  members:
  - serviceAccount:service-145446780542@gcp-sa-eventarc.iam.gserviceaccount.com
- role: roles/pubsub.viewer
  members:
  - serviceAccount:service-145446780542@gcp-sa-eventarc.iam.gserviceaccount.com
```

### 7.3 Consumer deploy identity IAM

The principal that deploys the consumer function needs permission to create Eventarc triggers and Cloud Run services:

```bash
# Eventarc Admin

gcloud projects add-iam-policy-binding "$CONSUMER_PROJECT_ID" \
  --member="user:you@your-domain.com" \
  --role="roles/eventarc.admin"

# Cloud Run Admin (CFv2 backend)

gcloud projects add-iam-policy-binding "$CONSUMER_PROJECT_ID" \
  --member="user:you@your-domain.com" \
  --role="roles/run.admin"

# Service Account User on the functions runtime SA

gcloud iam service-accounts add-iam-policy-binding \
  "$CONSUMER_PROJECT_ID@appspot.gserviceaccount.com" \
  --member="user:you@your-domain.com" \
  --role="roles/iam.serviceAccountUser" \
  --project="$CONSUMER_PROJECT_ID"
```

If CI deploys, replace `user:you@your-domain.com` with the CI service account.

### 7.4 Org policy considerations

Some organizations enforce constraints that block cross-project Eventarc triggers.  Common ones:

- `constraints/iam.disableCrossProjectServiceAccountUsage` — ensure the consumer Eventarc SA can be used across projects.
- `constraints/eventarc.allowedLocations` — deploy the trigger in an allowed region.
- `constraints/run.allowedIngress` / `run.allowedIngressInternalOnly` — Cloud Run ingress must allow Eventarc.

If deployment fails with IAM-related errors, verify org policies in both projects before broadening roles.

### 7.5 Security checklist

- [ ] `roles/pubsub.publisher` is granted only to the SA runtime SA, never to `allUsers`.
- [ ] `roles/pubsub.subscriber` is granted only to the consumer Eventarc SA and any explicit pull-subscription SAs.
- [ ] Consumer functions require authentication on their own ingress where applicable.
- [ ] Payloads do not contain secrets, credentials, or PII.
- [ ] Message attributes used for routing are validated inside the handler (do not trust attributes alone for authorization).

---

## 8. End-to-End Setup Commands

The following is the canonical sequence for adding a new broadcast channel from SA to a partner project.  Adapt project IDs, topic names, and function names as needed.

### 8.1 Producer side

```bash
PRODUCER_PROJECT_ID="alpha-vantage-proxy-api"
TOPIC_ID="partner-data-ready"

gcloud config set project "$PRODUCER_PROJECT_ID"

# 1. Enable Pub/Sub
gcloud services enable pubsub.googleapis.com

# 2. Create topic
gcloud pubsub topics create "$TOPIC_ID" --project="$PRODUCER_PROJECT_ID"

# 3. Grant publisher role to the SA runtime SA
PRODUCER_PROJECT_NUMBER="$(gcloud projects describe "$PRODUCER_PROJECT_ID" --format='value(projectNumber)')"
gcloud pubsub topics add-iam-policy-binding \
  "projects/$PRODUCER_PROJECT_ID/topics/$TOPIC_ID" \
  --member="serviceAccount:$PRODUCER_PROJECT_NUMBER-compute@developer.gserviceaccount.com" \
  --role="roles/pubsub.publisher" \
  --project="$PRODUCER_PROJECT_ID"

# 4. (Later) grant subscriber role to each consumer Eventarc SA
```

### 8.2 Consumer side

```bash
CONSUMER_PROJECT_ID="rel-str"
PRODUCER_PROJECT_ID="alpha-vantage-proxy-api"
TOPIC_ID="partner-data-ready"

CONSUMER_PROJECT_NUMBER="$(gcloud projects describe "$CONSUMER_PROJECT_ID" --format='value(projectNumber)')"

# 1. Enable required APIs
gcloud services enable \
  cloudfunctions.googleapis.com \
  eventarc.googleapis.com \
  run.googleapis.com \
  pubsub.googleapis.com \
  --project="$CONSUMER_PROJECT_ID"

# 2. Grant deploy identity roles
gcloud projects add-iam-policy-binding "$CONSUMER_PROJECT_ID" \
  --member="user:you@your-domain.com" \
  --role="roles/eventarc.admin"

gcloud projects add-iam-policy-binding "$CONSUMER_PROJECT_ID" \
  --member="user:you@your-domain.com" \
  --role="roles/run.admin"

gcloud iam service-accounts add-iam-policy-binding \
  "$CONSUMER_PROJECT_ID@appspot.gserviceaccount.com" \
  --member="user:you@your-domain.com" \
  --role="roles/iam.serviceAccountUser" \
  --project="$CONSUMER_PROJECT_ID"

# 3. Grant consumer Eventarc SA access to the producer topic
gcloud pubsub topics add-iam-policy-binding \
  "projects/$PRODUCER_PROJECT_ID/topics/$TOPIC_ID" \
  --member="serviceAccount:service-$CONSUMER_PROJECT_NUMBER@gcp-sa-eventarc.iam.gserviceaccount.com" \
  --role="roles/pubsub.subscriber" \
  --project="$PRODUCER_PROJECT_ID"
```

### 8.3 Deploy the consumer function

```bash
# In the consumer repo, e.g. /c/aa/projects/rel-str
firebase deploy --only "functions:processDataReady" --project "$CONSUMER_PROJECT_ID"
```

The function source must define:

```typescript
export const processDataReady = onMessagePublished(
  {
    topic: `projects/${PRODUCER_PROJECT_ID}/topics/${TOPIC_ID}`,
    region: 'us-central1',
  },
  async (event) => { /* ... */ }
);
```

---

## 9. Deployment, Testing, and Verification

### 9.1 Local emulator testing

The Firebase emulator supports Pub/Sub on port `8086`:

```@c:\aa\projects\av-proxy-api\firebase.json:69-72
    "pubsub": {
      "port": 8086,
      "host": "127.0.0.1"
    },
```

Start the emulator:

```bash
firebase emulators:start --only functions,pubsub --project alpha-vantage-proxy-api
```

The SA publisher auto-creates missing emulator topics and publishes to `localhost:8086` when `PUBSUB_EMULATOR_HOST` is set.

### 9.2 Manual publish from production

Use the direct publisher script:

```bash
cd /c/aa/projects/av-proxy-api
npx ts-node functions/scripts/partner/partner-data-ready-direct.ts \
  --autofill \
  --env prod \
  --trigger manual \
  --phase post \
  --intervals daily \
  --verbose
```

Or call the HTTP publisher with a minted OIDC token (see `@c:\aa\projects\av-proxy-api\docs\partner\partner-auth-and-audience.md`).

### 9.3 Verify topic IAM

```bash
gcloud pubsub topics get-iam-policy \
  projects/alpha-vantage-proxy-api/topics/partner-data-ready \
  --project="alpha-vantage-proxy-api"
```

### 9.4 Verify a message was received

In the consumer project, check Cloud Functions logs:

```bash
gcloud functions logs read processDataReady --limit=50 --project="rel-str"
```

Or use Logs Explorer with the query:

```text
resource.type="cloud_function"
resource.labels.function_name="processDataReady"
```

### 9.5 Inspect messages without a consumer

Create a temporary pull subscription in the producer project for debugging:

```bash
gcloud pubsub subscriptions create temp-debug-sub \
  --topic="projects/alpha-vantage-proxy-api/topics/partner-data-ready" \
  --project="alpha-vantage-proxy-api"

gcloud pubsub subscriptions pull temp-debug-sub \
  --auto-ack \
  --limit=10 \
  --project="alpha-vantage-proxy-api"
```

Delete it when done.

---

## 10. Operations

### 10.1 Idempotency

Pub/Sub may deliver a message more than once.  Consumers must be idempotent:

- Use `runId` + `phase` + `marketDate` as a natural deduplication key for data-ready messages.
- Persist processed message IDs or run IDs in Firestore with a `set(..., { merge: true })` if the downstream effect must happen exactly once.
- Make handlers return `200` only after the work is durably recorded.

### 10.2 Retries and dead-letter topics

By default, Cloud Functions triggered by Pub/Sub retry failed executions automatically.  For a new channel, consider:

- Setting a **maximum number of delivery attempts** (e.g. 5).
- Attaching a **dead-letter topic** in the consumer project for unprocessable messages.

```bash
gcloud pubsub subscriptions create data-ready-sub \
  --topic="projects/alpha-vantage-proxy-api/topics/partner-data-ready" \
  --max-delivery-attempts=5 \
  --dead-letter-topic="projects/rel-str/topics/data-ready-dlq" \
  --project="rel-str"
```

### 10.3 Ordering keys

Pub/Sub ordering keys guarantee order for messages with the same key in the same region.  SA currently does **not** use ordering keys for partner channels because most messages are independent (per-symbol or per-run).  If a future channel requires strict ordering, the publisher must set `orderingKey` and the subscription must enable message ordering.

### 10.4 Monitoring

Key metrics to alert on:

| Metric | Where | Why |
|--------|-------|-----|
| `pubsub.googleapis.com/subscription/num_undelivered_messages` | Consumer subscription | Backlog / consumer lag |
| `pubsub.googleapis.com/topic/send_message_operation_count` | Producer topic | Publish rate / health |
| `cloudfunctions.googleapis.com/function/execution_count` | Consumer function | Throughput |
| `cloudfunctions.googleapis.com/function/execution_times` | Consumer function | Latency |

### 10.5 Schema evolution

When a payload needs to change:

1. Prefer adding optional fields under the existing `version: 'v1'`.
2. If the change is breaking, introduce `version: 'v2'` and publish both versions during a transition window.
3. Coordinate with consumers before removing a field.
4. Update `@c:\aa\projects\av-proxy-api\docs\partner\rs-partner-integration.md` and any schema files.

---

## 11. Sender Checklist

Use this before declaring a new channel production-ready.

- [ ] Topic created in `alpha-vantage-proxy-api`.
- [ ] Topic constant added to `@c:\aa\projects\av-proxy-api\functions\src\v2\partner\constants.ts`.
- [ ] Payload interface defined and versioned (`version: 'v1'`).
- [ ] Validator written for the payload (or reuse `validateDataReadyPayload` pattern).
- [ ] Publisher module created following the lazy-import + `publishMessage` pattern.
- [ ] `roles/pubsub.publisher` granted to the SA runtime SA on the new topic.
- [ ] Attributes are populated for routing/filtering.
- [ ] Emulator auto-create fallback is implemented.
- [ ] Manual publish path exists (script or HTTP endpoint).
- [ ] Logging includes `runId`, `marketDate`, `phase`, `endpoint`, and `messageId`.
- [ ] README / partner docs updated.

---

## 12. Receiver Checklist

Use this before deploying a new consumer function.

- [ ] Consumer project APIs enabled (`cloudfunctions`, `eventarc`, `run`, `pubsub`).
- [ ] Deploy identity granted `roles/eventarc.admin`, `roles/run.admin`, and `roles/iam.serviceAccountUser` on the runtime SA.
- [ ] Consumer Eventarc service agent granted `roles/pubsub.subscriber` on the SA topic.
- [ ] Cloud Function uses `onMessagePublished` with the **full topic resource name**.
- [ ] Handler decodes base64 message data safely.
- [ ] Handler validates payload shape and ignores unknown versions.
- [ ] Handler is idempotent (deduplicates by `runId` / message ID / symbol batch).
- [ ] Logs and metrics are queryable.
- [ ] (Optional) Subscription filter or dead-letter topic configured.
- [ ] Failure modes documented and tested.

---

## Appendix A: Minimal Consumer Function Example

```typescript
// consumer/functions/src/index.ts
import { onMessagePublished } from 'firebase-functions/v2/pubsub';

interface DataReadyPayloadV1 {
  version: 'v1';
  runId: string;
  phase: 'pre' | 'post';
  intervals: string[];
  time: number;
  marketDate?: string;
  trigger?: 'manual' | 'scheduled' | 'heartbeat' | 'test';
}

export const processDataReady = onMessagePublished(
  {
    topic: 'projects/alpha-vantage-proxy-api/topics/partner-data-ready',
    region: 'us-central1',
  },
  async (event) => {
    const raw = event.data.message.data;
    if (!raw) {
      console.error('Empty message data');
      return;
    }

    const body: DataReadyPayloadV1 = JSON.parse(Buffer.from(raw, 'base64').toString('utf8'));
    const attrs = event.data.message.attributes || {};

    if (body.version !== 'v1') {
      console.warn('Unsupported payload version', body.version);
      return;
    }

    if (body.trigger === 'test') {
      console.log('Ignoring test message', { runId: body.runId });
      return;
    }

    console.log('Processing data-ready', {
      runId: body.runId,
      phase: body.phase,
      marketDate: body.marketDate,
      runType: attrs.runType,
    });

    // Idempotent business logic here.
  }
);
```

Deploy:

```bash
firebase deploy --only "functions:processDataReady" --project rel-str
```

---

## Appendix B: Quick Reference — gcloud IAM Cheat Sheet

```bash
# Look up project numbers
PRODUCER_PROJECT_NUMBER=$(gcloud projects describe alpha-vantage-proxy-api --format='value(projectNumber)')
CONSUMER_PROJECT_NUMBER=$(gcloud projects describe rel-str --format='value(projectNumber)')

# Producer topic publisher
SA_PUBLISHER="$PRODUCER_PROJECT_NUMBER-compute@developer.gserviceaccount.com"
gcloud pubsub topics add-iam-policy-binding \
  projects/alpha-vantage-proxy-api/topics/partner-data-ready \
  --member="serviceAccount:$SA_PUBLISHER" \
  --role="roles/pubsub.publisher" \
  --project=alpha-vantage-proxy-api

# Consumer Eventarc subscriber
SA_EVENTARC="service-$CONSUMER_PROJECT_NUMBER@gcp-sa-eventarc.iam.gserviceaccount.com"
gcloud pubsub topics add-iam-policy-binding \
  projects/alpha-vantage-proxy-api/topics/partner-data-ready \
  --member="serviceAccount:$SA_EVENTARC" \
  --role="roles/pubsub.subscriber" \
  --project=alpha-vantage-proxy-api
```

---

## Appendix C: Worked Example — `partner-symbol-added`

This appendix walks through the lifecycle channel that fires when the SA project finishes onboarding a new symbol.  It is a concrete application of the patterns described in the main body of this guide.

### C.1 What it signals

When a new document is created in `tracked-symbols/{symbol}`, the `onSymbolAdded` Cloud Function fetches full DAILY, WEEKLY, and MONTHLY adjusted history from Alpha Vantage.  After all three intervals are persisted to Firestore, SA publishes a single `partner-symbol-added` message.  Consumers can react by pulling full history for the symbol across those intervals.

**Producer code:** `@c:\aa\projects\av-proxy-api\functions\src\v2\alpha-vantage\triggers\on-symbol-added.function.ts`

**Publisher code:** `@c:\aa\projects\av-proxy-api\functions\src\v2\partner\symbol-added.publisher.ts`

### C.2 Payload contract

```typescript
import { TimeSeriesInterval } from '@shared/alpha-vantage';

export interface SymbolAddedPayloadV1 {
  version: 'v1';
  symbols: string[];                       // currently one symbol per message
  addedAtUTC: string;                      // ISO-8601 timestamp
  status: 'ready';                         // initial onboarding backfill complete
  availableIntervals: TimeSeriesInterval[]; // [DAILY, WEEKLY, MONTHLY]
}
```

Example message:

```json
{
  "version": "v1",
  "symbols": ["AVGO"],
  "addedAtUTC": "2026-07-08T20:30:00.000Z",
  "status": "ready",
  "availableIntervals": ["daily", "weekly", "monthly"]
}
```

Message attributes:

- `status`: always `ready` for this channel
- `version`: `v1`
- `symbol`: the symbol from the payload (convenience filter attribute)

### C.3 Producer topic constant

```typescript
// @c:\aa\projects\av-proxy-api\functions\src\v2\partner\constants.ts
export const PARTNER_SYMBOL_ADDED_TOPIC = 'partner-symbol-added';
```

### C.4 Minimal consumer handler

```typescript
// consumer/functions/src/index.ts
import { onMessagePublished } from 'firebase-functions/v2/pubsub';
import { TimeSeriesInterval } from '@shared/alpha-vantage';

interface SymbolAddedPayloadV1 {
  version: 'v1';
  symbols: string[];
  addedAtUTC: string;
  status: 'ready';
  availableIntervals: TimeSeriesInterval[];
}

export const processSymbolAdded = onMessagePublished(
  {
    topic: 'projects/alpha-vantage-proxy-api/topics/partner-symbol-added',
    region: 'us-central1',
  },
  async (event) => {
    const raw = event.data.message.data;
    if (!raw) {
      console.error('Empty message data');
      return;
    }

    const body: SymbolAddedPayloadV1 = JSON.parse(Buffer.from(raw, 'base64').toString('utf8'));
    const attrs = event.data.message.attributes || {};

    if (body.version !== 'v1' || body.status !== 'ready') {
      console.warn('Ignoring unsupported symbol-added message', { version: body.version, status: body.status });
      return;
    }

    for (const symbol of body.symbols) {
      for (const interval of body.availableIntervals) {
        // Idempotent fetch of full history from SA partner endpoints
        console.log('Fetching full history', { symbol, interval, addedAtUTC: body.addedAtUTC });
      }
    }
  }
);
```

Deploy:

```bash
firebase deploy --only "functions:processSymbolAdded" --project rel-str
```

### C.5 IAM setup commands

Producer (run in `alpha-vantage-proxy-api`):

```bash
PRODUCER_PROJECT_NUMBER=$(gcloud projects describe alpha-vantage-proxy-api --format='value(projectNumber)')
SA_PUBLISHER="${PRODUCER_PROJECT_NUMBER}-compute@developer.gserviceaccount.com"

gcloud pubsub topics add-iam-policy-binding \
  projects/alpha-vantage-proxy-api/topics/partner-symbol-added \
  --member="serviceAccount:${SA_PUBLISHER}" \
  --role="roles/pubsub.publisher" \
  --project=alpha-vantage-proxy-api
```

Consumer (run in `rel-str`):

```bash
CONSUMER_PROJECT_NUMBER=$(gcloud projects describe rel-str --format='value(projectNumber)')
SA_EVENTARC="service-${CONSUMER_PROJECT_NUMBER}@gcp-sa-eventarc.iam.gserviceaccount.com"

gcloud pubsub topics add-iam-policy-binding \
  projects/alpha-vantage-proxy-api/topics/partner-symbol-added \
  --member="serviceAccount:${SA_EVENTARC}" \
  --role="roles/pubsub.subscriber" \
  --project=alpha-vantage-proxy-api
```

---

## Appendix D: Manual Human Runbook

Step-by-step producer/consumer setup, end-to-end testing, emulator testing, and troubleshooting for `partner-symbol-added` have been moved to their own runbook:

- `@c:\aa\projects\av-proxy-api\docs\partner\pubsub-broadcast-runbook.md`

This keeps the developer guide focused on architecture, payload contracts, and consumer patterns, while the runbook can be printed or followed independently.

---

## Related Documents

- `@c:\aa\projects\av-proxy-api\docs\partner\cross-project-pubsub-eventarc.md` — concrete AV → RS cross-project wiring.
- `@c:\aa\projects\av-proxy-api\docs\partner\partner-auth-and-audience.md` — OIDC ID token auth for HTTPS partner endpoints.
- `@c:\aa\projects\av-proxy-api\docs\partner\rs-partner-integration.md` — consumer-facing payload contract and quick start.
- `@c:\aa\projects\av-proxy-api\docs\partner\partner-data-ready-test-runs.md` — manual PDR test recipes.
- `@c:\aa\projects\av-proxy-api\docs\partner\pubsub-broadcast-runbook.md` — manual `partner-symbol-added` setup, test, and troubleshooting commands.
- `@c:\aa\projects\av-proxy-api\docs\operations\backend-functions-overview.md` — overview of all backend functions.
- `@c:\aa\projects\av-proxy-api\functions\src\v2\alpha-vantage\triggers\on-symbol-added.function.ts` — producer trigger for symbol onboarding.
- `@c:\aa\projects\av-proxy-api\functions\src\v2\partner\symbol-added.publisher.ts` — publisher implementation for `partner-symbol-added`.
