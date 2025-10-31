# partner-data-ready-direct (Direct Publisher)

TypeScript-based direct publisher that invokes the internal `enqueueDataReadyInternal()` to publish a `DataReadyPayloadV1` message to the `partner-data-ready` Pub/Sub topic. No HTTPS endpoint is involved.

- Script: `functions/scripts/partner-data-ready-direct.ts`
- Works on Windows (PowerShell/CMD), macOS, Linux
- Publishes to the current GCP project unless you’re using the Pub/Sub emulator

## What It Does

1) Builds a `DataReadyPayloadV1` either via `--autofill` or from a custom JSON file.
2) Validates the payload using `validateDataReadyPayload(...)`.
3) Calls `enqueueDataReadyInternal(payload, email, attributes)` which:
   - Upserts `runs/{runId}` in Firestore for provenance and status
   - Publishes to the `partner-data-ready` Pub/Sub topic
   - Returns `{ ok: true, requestId, messageId, status }`

All messages published by this script are explicitly marked with `trigger: "manual"`.

## Prerequisites

- Node.js 20+
- From the repo root (so relative imports resolve)
- Auth: either Firebase/Google emulators or Application Default Credentials (ADC)

## Auth Setup

### Emulator (Local)
- Set environment variables:
  - `FIRESTORE_EMULATOR_HOST=localhost:8080`
  - `PUBSUB_EMULATOR_HOST=localhost:8085`
  - `FUNCTIONS_EMULATOR=true`
- Optional `.env` (for parity) at `functions/local-dev.env.alpha-vantage-proxy-api`:
  - `ALLOWED_SERVICE_ACCOUNT_EMAILS=...`
  - `EXPECTED_GOOGLE_AUDIENCE=...` (not needed for direct publish)
- Start the emulators for Firestore and Pub/Sub.
- Note: The publisher auto-creates the topic in the emulator if missing and retries once.

### Production / GCP Project
- Use Application Default Credentials (ADC):
  - `gcloud auth application-default login`
  - or set `GOOGLE_APPLICATION_CREDENTIALS` to a service account JSON file
- Required permissions for the ADC principal:
  - Pub/Sub: publish on topic `partner-data-ready` (e.g., `roles/pubsub.publisher`)
  - Firestore: read/write on `runs/*`

## Usage

From the repository root:

### Autofill (Recommended for quick tests)
Derives Eastern Time (ET) phase and date automatically, creates `runId=<YYYY-MM-DD>-<pre|post>`, defaults `intervals=["daily"]`, and forces `trigger="manual"`.

PowerShell (Windows):
```powershell
npx ts-node functions/scripts/partner-data-ready-direct.ts --autofill --env dev --email you@example.com --verbose
```

Git Bash / macOS / Linux:
```bash
npx ts-node functions/scripts/partner-data-ready-direct.ts --autofill --env dev --email you@example.com --verbose
```

With multiple intervals:
```bash
npx ts-node functions/scripts/partner-data-ready-direct.ts --autofill --env staging --intervals daily,weekly --email you@example.com --verbose
```

### Custom Payload (Full Control)
Create `payload.json` matching `DataReadyPayloadV1` (the script will still enforce `trigger="manual"`):
```json
{
  "version": "v1",
  "runId": "2025-10-23-pre",
  "phase": "pre",
  "intervals": ["daily"],
  "time": 1761222000000,
  "marketDate": "2025-10-23",
  "env": "dev"
}
```
Run:
```bash
npx ts-node functions/scripts/partner-data-ready-direct.ts --body payload.json --email you@example.com --verbose
```

## Options / Env

- `--autofill` — generate minimal payload server-side (derive ET phase/date)
- `--env NAME` — set `payload.env` when using `--autofill` (e.g., `dev|staging|prod`)
- `--intervals LIST` — comma-separated (`daily,weekly,monthly`) for `--autofill`
- `--body PATH` — path to JSON file with full `DataReadyPayloadV1`
- `--email ADDRESS` — provenance email recorded at `runs/{runId}.provenance.auth.email` (defaults to internal audit email)
- `--attributes LIST` — extra Pub/Sub message attributes as `k=v,k2=v2` (added alongside `runId/version/phase`)
- `--verbose` — print full JSON response

Env overrides: `ENV`, `INTERVALS`, `BODY`, `EMAIL`, `ATTRS|ATTRIBUTES`, `VERBOSE`

## Output

- Success (concise):
```
ok requestId=<uuid> status=enqueued messageId=<pubsub-id>
```
- Success (verbose `--verbose`):
```json
{
  "requestId": "...",
  "messageId": "...",
  "status": "enqueued",
  "ok": true
}
```

## Troubleshooting

- Missing `ts-node`: the command uses `npx ts-node ...`; no global install required. If needed: `npm i -D ts-node typescript`.
- Permission errors (prod): ensure ADC principal has Pub/Sub publish and Firestore read/write.
- Emulator NOT_FOUND topic: re-run; the script auto-creates `partner-data-ready` in the Pub/Sub emulator.
- Validation errors: ensure payload conforms to `functions/src/v2/partner/schemas/data-ready.schema.ts`.
- Working directory: run from the repo root so `../src/...` imports resolve.

## Related Files

- `functions/scripts/partner-data-ready-direct.ts`
- `functions/src/v2/partner/data-ready.handler.ts`
- `functions/src/v2/partner/schemas/data-ready.schema.ts`
- `functions/src/v2/partner/constants.ts`
- `docs/partner-data-ready-publish.md` (HTTP publisher variant)
