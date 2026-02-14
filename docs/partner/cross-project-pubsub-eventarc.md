# Cross‑Project Pub/Sub + Eventarc Trigger Setup

## Overview

This document describes how to wire a **Pub/Sub topic in Project A** to a **Cloud Functions v2 / Eventarc trigger in Project B**.

We cover:

- **Concepts and roles**
- **Full `gcloud` command sequence**
- **Equivalent Console (GCP UI) setup**
- **A concrete example** based on:
  - Producer project: `alpha-vantage-proxy-api`
  - Consumer project: `rel-str`
  - Topic: `partner-symbols-ready`
  - Function: `processSymbolsReady` (Eventarc / Pub/Sub trigger)

---

## 1. Concepts & Roles

- **Producer project (Project A)**  
  Owns the **Pub/Sub topic**.

- **Consumer project (Project B)**  
  Hosts the **Cloud Function v2** / Eventarc trigger that listens to that topic.

- **Eventarc service agent (Project B)**  
  Special service account used by Eventarc in the consumer project:

  ```text
  service-145446780542@gcp-sa-eventarc.iam.gserviceaccount.com
  ```

- **Serverless / Google-managed SAs (Project B)**  
  Depending on how the trigger was first created, you may also see additional
  Google-managed service accounts in the consumer project such as:

  ```text
  service-145446780542@gcf-admin-robot.iam.gserviceaccount.com
  service-145446780542@serverless-robot-prod.iam.gserviceaccount.com
  ```

  These typically do **not** require direct IAM bindings on the
  `partner-symbols-ready` topic for the cross-project pattern described here;
  the key principal for the topic is the Eventarc service agent.

- **Compute SA (Project A)**  
  Used by producers in Project A to publish to the topic:

  ```text
  29825344315-compute@developer.gserviceaccount.com
  ```

To allow cross‑project triggers:

- Give the **consumer Eventarc / serverless SAs** the right roles on the **topic in the producer project**.
- Ensure the **publisher SA** in the producer project can publish to the topic.
- Ensure the **deploy identity** in the consumer project has Eventarc / Cloud Run / Service Account User roles.

---

## 2. End‑to‑End Setup via `gcloud`

This section assumes you are working in **a single terminal session**. You can stay in one directory (for example, your `rel-str` repo root) as long as each command clearly targets the correct GCP project.

We use two shell variables for clarity:

```bash
CONSUMER_PROJECT_ID="rel-str"                      # Project B
PRODUCER_PROJECT_ID="alpha-vantage-proxy-api"     # Project A
```

You can substitute your own IDs, but the example uses the **real** project numbers:

- `rel-str` → `PROJECT_NUMBER = 145446780542`
- `alpha-vantage-proxy-api` → `PROJECT_NUMBER = 29825344315`

### 2.1. Set project IDs and look up project numbers

```bash
# Set IDs
CONSUMER_PROJECT_ID="rel-str"                      # Consumer
PRODUCER_PROJECT_ID="alpha-vantage-proxy-api"     # Producer

# Look up project numbers (once)
CONSUMER_PROJECT_NUMBER="$(gcloud projects describe "$CONSUMER_PROJECT_ID" --format='value(projectNumber)')"
PRODUCER_PROJECT_NUMBER="$(gcloud projects describe "$PRODUCER_PROJECT_ID" --format='value(projectNumber)')"

echo "CONSUMER_PROJECT_NUMBER=$CONSUMER_PROJECT_NUMBER"
echo "PRODUCER_PROJECT_NUMBER=$PRODUCER_PROJECT_NUMBER"
```

Example output:

```text
CONSUMER_PROJECT_NUMBER=145446780542
PRODUCER_PROJECT_NUMBER=29825344315
```

---

### 2.2. Enable required APIs

#### In producer project (Project A: `alpha-vantage-proxy-api`)

```bash
gcloud services enable \
  pubsub.googleapis.com \
  --project="$PRODUCER_PROJECT_ID"
```

> Note: `eventarc.googleapis.com` only needs to be enabled in the **consumer**
> project. Enabling it in the producer is harmless but not required for the
> basic "topic in A, trigger in B" pattern.

#### In consumer project (Project B: `rel-str`)

```bash
gcloud services enable \
  cloudfunctions.googleapis.com \
  eventarc.googleapis.com \
  run.googleapis.com \
  pubsub.googleapis.com \
  --project="$CONSUMER_PROJECT_ID"
```

---

### 2.3. IAM on the Pub/Sub topic in the producer project

Assume the topic in Project A is:

```text
projects/alpha-vantage-proxy-api/topics/partner-symbols-ready
```

We will mirror the effective IAM of a known‑good topic (e.g. `partner-data-ready`)
onto this topic, but with **least privilege** for the cross-project trigger.

Using the real numbers from the example:

- **Consumer Eventarc service agent (from `rel-str`)**:

  ```text
  service-145446780542@gcp-sa-eventarc.iam.gserviceaccount.com
  ```

- **Consumer runtime SA (optional explicit subscriber, from `rel-str`)**:

  ```text
  rel-str@appspot.gserviceaccount.com
  ```

- **Producer compute SA (from `alpha-vantage-proxy-api`)**:

  ```text
  29825344315-compute@developer.gserviceaccount.com
  ```

#### Commands

```bash
# 1) Grant Pub/Sub Subscriber (and optionally Viewer) to the consumer Eventarc SA

gcloud pubsub topics add-iam-policy-binding \
  projects/alpha-vantage-proxy-api/topics/partner-symbols-ready \
  --member="serviceAccount:service-145446780542@gcp-sa-eventarc.iam.gserviceaccount.com" \
  --role="roles/pubsub.subscriber" \
  --project="$PRODUCER_PROJECT_ID"

# (Optional) Viewer for troubleshooting

gcloud pubsub topics add-iam-policy-binding \
  projects/alpha-vantage-proxy-api/topics/partner-symbols-ready \
  --member="serviceAccount:service-145446780542@gcp-sa-eventarc.iam.gserviceaccount.com" \
  --role="roles/pubsub.viewer" \
  --project="$PRODUCER_PROJECT_ID"

# 2) (Optional) Subscriber for the consumer appspot SA, if needed

gcloud pubsub topics add-iam-policy-binding \
  projects/alpha-vantage-proxy-api/topics/partner-symbols-ready \
  --member="serviceAccount:rel-str@appspot.gserviceaccount.com" \
  --role="roles/pubsub.subscriber" \
  --project="$PRODUCER_PROJECT_ID"

# 3) Grant Pub/Sub Publisher to the producer compute SA

gcloud pubsub topics add-iam-policy-binding \
  projects/alpha-vantage-proxy-api/topics/partner-symbols-ready \
  --member="serviceAccount:29825344315-compute@developer.gserviceaccount.com" \
  --role="roles/pubsub.publisher" \
  --project="$PRODUCER_PROJECT_ID"
```

Verify the resulting policy (still from the same terminal):

```bash
gcloud pubsub topics get-iam-policy \
  projects/alpha-vantage-proxy-api/topics/partner-symbols-ready \
  --project="$PRODUCER_PROJECT_ID"
```

Expected shape (simplified):

```yaml
bindings:
- role: roles/pubsub.subscriber
  members:
  - serviceAccount:service-145446780542@gcp-sa-eventarc.iam.gserviceaccount.com
  - serviceAccount:rel-str@appspot.gserviceaccount.com
- role: roles/pubsub.viewer
  members:
  - serviceAccount:service-145446780542@gcp-sa-eventarc.iam.gserviceaccount.com
- role: roles/pubsub.publisher
  members:
  - serviceAccount:29825344315-compute@developer.gserviceaccount.com
```

This mirrors the effective `partner-data-ready` configuration but with
least-privilege roles for the cross-project trigger.

---

#### 2.3.1. Recommended Least‑Privilege IAM (Summary)

The commands above are already expressed in a least‑privilege way, but for
readers skimming for the minimal required roles, this section summarizes the
recommended bindings.

Using the real projects:

- Producer project (A): `alpha-vantage-proxy-api`  
  `PROJECT_NUMBER = 29825344315`
- Consumer project (B): `rel-str`  
  `PROJECT_NUMBER = 145446780542`

Key service accounts:

- **Producer publisher SA (existing):**

  ```text
  29825344315-compute@developer.gserviceaccount.com
  ```

- **Consumer Eventarc SA:**

  ```text
  service-145446780542@gcp-sa-eventarc.iam.gserviceaccount.com
  ```

- **Consumer runtime SA (optional direct subscriber):**

  ```text
  rel-str@appspot.gserviceaccount.com
  ```

On the topic:

```text
projects/alpha-vantage-proxy-api/topics/partner-symbols-ready
```

the minimal bindings are:

```yaml
bindings:
- role: roles/pubsub.publisher
  members:
  - serviceAccount:29825344315-compute@developer.gserviceaccount.com
- role: roles/pubsub.subscriber
  members:
  - serviceAccount:service-145446780542@gcp-sa-eventarc.iam.gserviceaccount.com
  - serviceAccount:rel-str@appspot.gserviceaccount.com   # optional
```

This is sufficient for producers in `alpha-vantage-proxy-api` to publish and
for Eventarc in `rel-str` to create and consume a cross‑project trigger. You do
**not** generally need `roles/pubsub.editor` on the topic for the various
Google‑managed serverless SAs (such as `gcf-admin-robot` or
`serverless-robot-prod`) unless you have a specific requirement for them to
mutate topic configuration.

---

### 2.4. IAM for the deploy identity in the consumer project

This is needed so the account that runs `firebase deploy` (or direct `gcloud` commands) can create and manage Eventarc triggers.

Assume:

- Consumer project: `rel-str`
- Deploy principal: `you@your-domain.com`
- Default CFv2 runtime SA: `rel-str@appspot.gserviceaccount.com`

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
  "rel-str@appspot.gserviceaccount.com" \
  --member="user:you@your-domain.com" \
  --role="roles/iam.serviceAccountUser" \
  --project="$CONSUMER_PROJECT_ID"
```

If another identity (e.g. CI service account) does the deploy, replace
`user:you@your-domain.com` with the correct principal. Many orgs will prefer a
**custom deploy role** that contains only the specific Eventarc / Cloud Run /
Service Account permissions required, instead of full `eventarc.admin` or
`run.admin`.

---

### 2.5. Deploy the Eventarc / CFv2 function in the consumer project

Assuming:

- You are still in the **same terminal session**
- Code lives in `/c/aa/projects/rel-str`
- `firebase.json` and `functions/` are present
- Function name: `processSymbolsReady`
- Function uses an Eventarc Pub/Sub trigger pointing at:

  ```text
  projects/alpha-vantage-proxy-api/topics/partner-symbols-ready
  ```

Run:

```bash
cd /c/aa/projects/rel-str

firebase deploy --only "functions:processSymbolsReady"
```

If IAM and org policies are correct, deployment should succeed and the function
will receive messages published to the cross‑project topic. If you are using
Firebase Functions as your source of truth, prefer this `firebase deploy` path
and treat manual trigger creation in the Console as a diagnostic or
last-resort workaround.

---

## 3. Equivalent Setup Using GCP Console (UI)

### 3.1. Create / verify the Pub/Sub topic in the producer project

1. In the GCP Console, switch to **project** `alpha-vantage-proxy-api`.
2. Navigate to **Pub/Sub → Topics**.
3. Ensure there is a topic named **`partner-symbols-ready`**.
   - If not, click **Create topic**:
     - Topic ID: `partner-symbols-ready`
     - Leave defaults; click **Create**.

---

### 3.2. Grant IAM on the topic (producer → consumer service accounts)

1. Still in project `alpha-vantage-proxy-api`, go to **Pub/Sub → Topics → partner-symbols-ready**.
2. Open the **Permissions** panel (or **SHOW INFO PANEL** → **Permissions**).
3. Click **Add principal**.
4. Add the following principal with role **Pub/Sub Subscriber** (and
   optionally **Pub/Sub Viewer**):

   - `service-145446780542@gcp-sa-eventarc.iam.gserviceaccount.com`

5. (Optional) For explicit subscribe rights, also grant **Pub/Sub Subscriber** to:

   - `rel-str@appspot.gserviceaccount.com`

6. Add the publisher principal:

   - Principal: `29825344315-compute@developer.gserviceaccount.com`
   - Role: **Pub/Sub Publisher**

7. Save.

At this point the Console IAM view for the topic should match the `gcloud`-generated policy from section 2.3.

---

### 3.3. Grant IAM to your deploy identity in the consumer project

1. Switch to **project** `rel-str`.
2. Go to **IAM & Admin → IAM**.
3. Find the user or service account that runs `firebase deploy`.
4. Ensure it has at least:
   - **Eventarc Admin** (`roles/eventarc.admin`)
   - **Cloud Run Admin** (`roles/run.admin`)

5. Go to **IAM & Admin → Service Accounts**.
6. Click the Cloud Functions v2 runtime service account (often `rel-str@appspot.gserviceaccount.com`).
7. On the **Permissions** tab, ensure your deploy principal has:
   - Role: **Service Account User** (`roles/iam.serviceAccountUser`).

---

### 3.4. Create the Eventarc / Cloud Function v2 trigger in the consumer project

You can create the trigger either via **Firebase deploy** (preferred, source of truth in code) or directly in the Console.

#### 3.4.1. Via Firebase / code (preferred)

- Define `processSymbolsReady` in your Functions code as a CFv2 function with an Eventarc Pub/Sub trigger using event type:

  ```text
  google.cloud.pubsub.topic.v1.messagePublished
  ```

- Configure the trigger to reference the **full topic resource**:

  ```text
  projects/alpha-vantage-proxy-api/topics/partner-symbols-ready
  ```

- Deploy from your repo root:

  ```bash
  firebase deploy --only "functions:processSymbolsReady"
  ```

#### 3.4.2. Via GCP Console (if needed)

1. In project `rel-str`, go to **Cloud Functions**.
2. Click **Create Function**.
3. Choose **2nd gen** environment.
4. Under **Trigger**, choose **Eventarc trigger**.
5. Event provider: **Cloud Pub/Sub**.
6. Event type: **Message published to a topic**.
7. Topic: enter the **full resource name**:

   ```text
   projects/alpha-vantage-proxy-api/topics/partner-symbols-ready
   ```

8. Choose region (e.g. `us-central1`) and runtime.
9. Complete function settings and deploy.

If IAM and org policies are correct, the Console will accept the cross‑project topic and the function will deploy successfully.

---

## 4. Concrete Example Summary

Using the real configuration that worked in production:

- **Producer project**: `alpha-vantage-proxy-api`  
  `projectNumber = 29825344315`

- **Consumer project**: `rel-str`  
  `projectNumber = 145446780542`

- **Topic**: `projects/alpha-vantage-proxy-api/topics/partner-symbols-ready`
- **Function**: `processSymbolsReady` in `rel-str`, region `us-central1`

Final IAM policy on the topic (as verified by `gcloud pubsub topics get-iam-policy`):

```yaml
bindings:
- role: roles/pubsub.subscriber
  members:
  - serviceAccount:service-145446780542@gcp-sa-eventarc.iam.gserviceaccount.com
  - serviceAccount:rel-str@appspot.gserviceaccount.com
- role: roles/pubsub.viewer
  members:
  - serviceAccount:service-145446780542@gcp-sa-eventarc.iam.gserviceaccount.com
- role: roles/pubsub.publisher
  members:
  - serviceAccount:29825344315-compute@developer.gserviceaccount.com
```

With this wiring in place, `firebase deploy --only functions:processSymbolsReady` in
`rel-str` succeeds, and the function reliably receives messages published to the
`partner-symbols-ready` topic in `alpha-vantage-proxy-api`.
