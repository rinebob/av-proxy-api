# Partner Data-Ready Publisher Script (Test & Manual Runs)

Audience: Savant / RS engineers and operators who need to send `partner-data-ready` messages from the `alpha-vantage-proxy-api` project into RS, for both **test** and **manual/adhoc** runs.

Last updated: 2026-02-06

---

## 1) What this covers

This doc explains how to:

- **Publish a Partner Data-Ready (PDR) message from AV** that RS will receive on its existing `partner-data-ready` subscription.
- Control the **`trigger`** (`scheduled` / `manual` / `test`) so RS can either **process** or **skip** the run.
- Use the **local direct publisher script** `functions/scripts/partner-data-ready-direct.ts` instead of the HTTP function.

This is intended for:

- One-off validation (cross-project Pub/Sub → Eventarc wiring, RS handler behavior).
- Debugging changes to payload shape or run lifecycle without perturbing RS state.

For Pub/Sub + Eventarc wiring details, see:

- `docs/partner/cross-project-pubsub-eventarc.md`
- `docs/partner/rs-partner-integration.md` (payload & trigger semantics)

---

## 2) Trigger semantics recap (RS contract)

From `docs/partner/rs-partner-integration.md`:

- `trigger` is an optional field in the JSON body and a mirrored Pub/Sub attribute.
- RS uses it as an **advisory hint** for how to treat the message:
  - `"scheduled"`: normal production run (RS processes the message).
  - `"manual"`: ad-hoc/manual run (RS may log or optionally process).
  - `"test"`: **dry-run / no-op** – RS receives the message but **skips normal ingestion logic**.

This doc focuses on two primary flows from the AV project:

- **Test runs** with `trigger: "test"` so RS can confirm wiring without advancing state.
- **Manual/adhoc runs** with `trigger: "manual"` (or `"scheduled"` when mimicking schedulers) to have RS **actually refresh data** on demand.

- Subscription filters and IAM are correct.
- The `processDataReadyRunV2` handler runs and logs the message.
- No RS state is advanced.

---

## 3) Direct publisher script overview

Script location (in this repo):

```text
functions/scripts/partner-data-ready-direct.ts
```

Purpose:

- Publish a `DataReadyPayloadV1` directly to the `partner-data-ready` Pub/Sub topic in **`alpha-vantage-proxy-api`** using local credentials (ADC).
- Bypass the HTTP function `partnerDataReadyPublishV2` entirely.
- Support both:
  - **Autofill mode**: script derives a minimal, valid payload for a given `env`/`intervals`/phase.
  - **Custom body mode**: script reads a full JSON payload from disk and optionally overrides `trigger`.

Key behavior:

- In **autofill mode** (`--autofill`), the script accepts `--trigger` and uses it when building the payload.
- In **body mode** (`--body payload.json`), the script will **respect the body** but can override `payload.trigger` if `--trigger` is supplied.
- In both modes, you can attach **extra Pub/Sub message attributes** via `--attributes` (e.g. `runType=ts-post-all-intervals`).

The sections below document **all flags** and then walk through common recipes (test run, manual RS refresh).

---

## 4) Flags and environment variables

### 4.1 CLI flags

- **`--autofill`**  
  Generate a minimal payload inside the script. You normally supply:
  - `--env` (e.g. `prod`)
  - `--intervals` (e.g. `daily,weekly,monthly`)
  - Optional `--phase` override (`pre` / `post`)
  - Optional `--trigger` (`scheduled` / `manual` / `test`)

- **`--body PATH`**  
  Read a full JSON payload from disk. Use this when you need total control of fields such as `runId`, future schema extensions, etc.

- **`--env NAME`**  
  Sets the `env` field in the payload when using `--autofill`. Typical values: `dev`, `staging`, `prod`.

- **`--intervals LIST`**  
  Comma-separated list of intervals for `--autofill` (converted to enum values):
  - `daily`
  - `weekly`
  - `monthly`

- **`--phase pre|post`**  
  Overrides automatic phase detection when using `--autofill`.
  - If omitted, phase is derived from ET time: `< 16:00` → `pre`, `>= 16:00` → `post`.

- **`--trigger VALUE`**  
  Controls the `trigger` field in the payload. Accepted values:
  - `scheduled` – behaves like a normal scheduled run (RS processes it).
  - `manual` – manual/adhoc run (RS may process but can also treat differently in logs/metrics).
  - `heartbeat` – reserved/rare; not generally needed for RS.
  - `test` – **dry-run / no-op** (RS receives but skips ingestion).

  In **autofill mode**, this sets the `trigger` field when the payload is created.  
  In **body mode**, this **overrides** `payload.trigger` from the JSON file.

- **`--email ADDRESS`**  
  Provenance email carried internally (publisher audit).  
  If omitted, defaults to `INTERNAL_PUBLISHER_AUDIT_EMAIL`.

- **`--attributes k=v,k2=v2`**  
  Extra Pub/Sub message attributes merged with the defaults. Examples:
  - `runType=ts-post-all-intervals`
  - `source=manual-cli`

  These sit alongside built-in attributes like `runId`, `version`, `phase`, `marketDate`, `env`.

- **`--verbose`**  
  Prints a full JSON summary of the publish result, including payload and attributes.  
  Without `--verbose`, the script prints a single-line summary.

- **`-h` / `--help`**  
  Prints usage and exits.

### 4.2 Environment variables

The script also reads optional environment variables as defaults when flags are not provided:

- `ENV` → default for `--env`
- `INTERVALS` → default for `--intervals`
- `BODY` → default for `--body`
- `EMAIL` → default for `--email`
- `ATTRS` or `ATTRIBUTES` → default for `--attributes`
- `VERBOSE` (set to `1`) → default for `--verbose`

---

## 5) Prerequisites

Before running the script in **prod** against the real `partner-data-ready` topic:

- You are in the `alpha-vantage-proxy-api` repo.
- You can authenticate to GCP with an identity that:
  - Has **Pub/Sub publisher** privileges for the `partner-data-ready` topic.
  - Is allowed to initialize Firebase Admin in `alpha-vantage-proxy-api` (for Firestore runs docs, etc.).
- Cross-project Pub/Sub + Eventarc wiring between AV → RS is already in place (see `docs/partner/cross-project-pubsub-eventarc.md`).
- RS has deployed and configured its handler function (e.g. `processDataReadyRunV2`) to listen to the `partner-data-ready` topic from `alpha-vantage-proxy-api`.

**Note:** The script publishes **real messages** on the production topic. The safety mechanism is `trigger: "test"` and RS’s policy to treat those messages as **no-op**.

---

## 6) Running a test PDR from AV (autofill mode)

This is the simplest and recommended way to send a `trigger: "test"` message from AV.

From the **`functions/`** directory:

```bash
cd functions

npx ts-node scripts/partner-data-ready-direct.ts \
  --autofill \
  --env prod \
  --intervals daily,weekly,monthly \
  --trigger test \
  --verbose
```

What this command does:

- Initializes Firebase Admin against the **`alpha-vantage-proxy-api`** project via ADC.
- Derives `phase` and `marketDate` in **America/New_York** (ET):
  - `phase = "pre"` before 16:00 ET
  - `phase = "post"` at/after 16:00 ET
- Builds a `DataReadyPayloadV1` roughly like:

  ```json
  {
    "version": "v1",
    "runId": "YYYY-MM-DD-HHMM-pre",
    "phase": "pre",
    "intervals": ["daily", "weekly", "monthly"],
    "time": 1770367590956,
    "marketDate": "YYYY-MM-DD",
    "env": "prod",
    "trigger": "test"
  }
  ```

- Writes/updates the corresponding Firestore run document under `realtime-runs/{runId}`.
- **Note:** The direct publisher script generates a simplified `runId` (e.g., `2026-02-06-0346-pre`). Production PDRs from the A/B/C pipeline use the full format: `YYYY-MM-DD-DOW-SEQ-INTERVAL-LIVE|MANUAL-PHASE-HHMM` (e.g., `2026-02-14-FRI-A-DAILY-LIVE-POST-1635`). RS should accept both formats.
- Publishes the payload to the **`partner-data-ready`** topic with standard attributes:
  - `runId`, `version`, `phase`, `marketDate`, `env`
- Prints a JSON summary including:
  - `ok`, `requestId`, `messageId`, `runId`, `publishedAtPacific`
  - The full `payload`
  - The Pub/Sub `attributes` used.

Example successful output (abridged):

```json
{
  "ok": true,
  "requestId": "a4868915-eef7-462b-950f-677b6f6b23ea",
  "messageId": "18380617871715405",
  "status": "enqueued",
  "runId": "2026-02-06-0346-pre",
  "payload": {
    "version": "v1",
    "runId": "2026-02-06-0346-pre",
    "phase": "pre",
    "intervals": ["daily", "weekly", "monthly"],
    "marketDate": "2026-02-06",
    "env": "prod",
    "trigger": "test"
  },
  "attributes": {
    "runId": "2026-02-06-0346-pre",
    "version": "v1",
    "phase": "pre",
    "marketDate": "2026-02-06",
    "env": "prod"
  }
}
```

---

## 7) Using a custom body file (optional)

If you need full control over the payload shape (for example, when testing future schema extensions), you can:

1. Create a JSON file, e.g. `pdr-test-payload.json`:

   ```json
   {
     "version": "v1",
     "runId": "2026-02-06-post-all-intervals-v1-test",
     "phase": "post",
     "intervals": ["daily", "weekly", "monthly"],
     "time": 1770367590956,
     "marketDate": "2026-02-06",
     "env": "prod",
     "trigger": "test"
   }
   ```

2. Run the script in **body mode**:

   ```bash
   cd functions

   npx ts-node scripts/partner-data-ready-direct.ts \
     --body pdr-test-payload.json \
     --trigger test \
     --verbose
   ```

Behavior in body mode:

- Script reads the JSON file into `payload`.
- If `--trigger` is provided, it **overrides** `payload.trigger` with the supplied value (e.g. `test`).
- Validation uses the same `validateDataReadyPayload` schema as the HTTP function.
- Publish path is identical to autofill mode.

Use this only if you explicitly want to control `runId`, extra fields, or test new schema versions.

---

## 8) Manual / adhoc RS refresh runs

For **real data refreshes** driven manually from AV (rather than the scheduler), use `trigger=manual` (or `scheduled` when explicitly mimicking a scheduled job). RS will treat these as **real** runs and execute its usual ingestion logic.

### 8.1 Typical manual refresh recipe

From the **`functions/`** directory:

```bash
cd functions

npx ts-node scripts/partner-data-ready-direct.ts \
  --autofill \
  --env prod \
  --intervals daily,weekly,monthly \
  --trigger manual \
  --attributes "runType=ts-post-all-intervals,source=manual-cli" \
  --verbose
```

Notes:

- `trigger=manual` makes it clear in both AV and RS logs that this was operator-initiated.
- `runType=ts-post-all-intervals` aligns with RS’s existing filters and expectations for all-intervals universe POST runs.
- You can adjust `--intervals` to target a subset (e.g. `daily` only) if RS is designed to treat those differently.

### 8.2 When to use `scheduled` vs `manual`

- Use **`trigger=scheduled`** when you want to **simulate a normal scheduler-driven run** as closely as possible. RS will not distinguish this from real cron traffic (other than possibly `source` attributes or runId naming).
- Use **`trigger=manual`** when you want RS (and internal dashboards) to treat the event as **operator-driven**. This is usually preferred for:
  - Emergency refreshes.
  - One-off backfills that should still run through the normal RS ingestion pipeline.

In both cases, be aware that RS will **process** the message, update checkpoints, and treat it as a real data event.

---

## 9) How RS sees the test run

Given correct cross-project wiring, RS’s Cloud Function (e.g. `processDataReadyRunV2`) will log something like:

```text
V2 Received Data-Ready message
processDataReadyRunV2 skipped test run
```

Key points from RS’s perspective:

- The message arrives on the **same subscription** RS uses for real runs.
- Payload and attributes look identical to a real run, except for `trigger: "test"`.
- RS checks `trigger` and **skips heavy processing** when it equals `"test"`.

This behavior for **test** runs allows:

- Verifying IAM, subscription filters, and Eventarc configuration.
- Confirming that `runId`, `phase`, `marketDate`, and `intervals` arrive as expected.
- Ensuring that RS’s no-op policy for test runs is working.

---

## 10) Verifying from the AV side

After running the script, you can:

- Inspect the Firestore run document:
  - Collection: `realtime-runs`
  - Document ID: the `runId` printed by the script (e.g. `2026-02-06-0346-pre`).
  - Confirm:
    - Timestamps (`runCreatedAt`, `runStartedAt`, `runFinishedAt`, etc.) are present and ordered.
    - Counters (`createdJobs`, `finishedJobs`, `successJobs`, `permanentFailureJobs`) make sense for the test run.
    - `trigger` is set or mirrored appropriately (depending on the run schema version).
- Check AV logs for the `runs.upsert.*` events that correspond to the script’s output.

These checks ensure the run lifecycle and aggregation logic are behaving correctly even for `trigger: "test"` runs.

---

## 11) Troubleshooting

- **Script fails with Firebase Admin / ADC errors**
  - Ensure you have valid Application Default Credentials (`gcloud auth application-default login` or workload identity) for `alpha-vantage-proxy-api`.
  - Confirm that the identity has permissions to publish to `partner-data-ready` and access Firestore.

- **RS does not see the message**
  - Verify that the script reported `ok: true` and a non-empty `messageId`.
  - Confirm that the topic and subscription wiring matches `docs/partner/cross-project-pubsub-eventarc.md`.
  - Check that RS’s Eventarc trigger is pointing at `projects/alpha-vantage-proxy-api/topics/partner-data-ready`.

- **RS receives the message but does not skip it**
  - Inspect the RS logs and payload to confirm that `trigger` in the JSON body is exactly `"test"`.
  - Ensure RS’s handler is reading the correct field and applying the no-op policy for `trigger: "test"`.

- **You accidentally send a non-test run**
  - If `trigger` is omitted or set to `"scheduled"`/`"manual"`, RS may process the message.
  - For pure wiring tests, always include `--trigger test` (or set `trigger: "test"` in the body) and confirm it in the script output before asking RS to act on it.

---

## 12) Reference

- Script implementation: `functions/scripts/partner-data-ready-direct.ts`
- HTTP publisher (not used for this test path): `functions/src/v2/partner/data-ready.publish.function.ts`
- RS integration guide: `docs/partner/rs-partner-integration.md`
- Cross-project wiring: `docs/partner/cross-project-pubsub-eventarc.md`
