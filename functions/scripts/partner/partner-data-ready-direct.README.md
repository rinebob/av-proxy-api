# partner-data-ready-direct (Direct Publisher)

**Created**: February 14, 2026  
**Last Updated**: February 15, 2026

TypeScript-based direct publisher that invokes the internal `enqueueDataReadyInternal()` to publish a `DataReadyPayloadV1` message to the `partner-data-ready` Pub/Sub topic. No HTTPS endpoint is involved.

- **Script**: `functions/scripts/partner/partner-data-ready-direct.ts`
- **Works on**: Windows (PowerShell/CMD), macOS, Linux
- **Publishes to**: Current GCP project unless using Pub/Sub emulator
- **Auth Methods**: Firebase/Google emulators or Application Default Credentials (ADC)

## What It Does

1) **Builds a `DataReadyPayloadV1`** either via `--autofill` or from a custom JSON file
2) **Validates the payload** using `validateDataReadyPayload(...)` 
3) **Calls `enqueueDataReadyInternal(payload, email, attributes)`** which:
   - Upserts `runs/{runId}` in Firestore for provenance and status
   - Publishes to the `partner-data-ready` Pub/Sub topic
   - Returns `{ ok: true, requestId, messageId, status }`

All messages published by this script are explicitly marked with `trigger: "manual"` unless overridden with `--trigger`.

## Prerequisites

- **Node.js 20+**
- **Repository root** (so relative imports resolve)
- **Auth**: Either Firebase/Google emulators or Application Default Credentials (ADC)

## Authentication Setup

### Emulator (Local Development)
Set environment variables:
- `FIRESTORE_EMULATOR_HOST=localhost:8080`
- `PUBSUB_EMULATOR_HOST=localhost:8085`
- `FUNCTIONS_EMULATOR=true`

**Optional `.env`** (for parity) at `functions/local-dev.env.alpha-vantage-proxy-api`:
- `ALLOWED_SERVICE_ACCOUNT_EMAILS=...`
- `EXPECTED_GOOGLE_AUDIENCE=...` (not needed for direct publish)

**Start emulators** for Firestore and Pub/Sub. The publisher auto-creates the topic in the emulator if missing and retries once.

### Production / GCP Project
Use **Application Default Credentials (ADC)**:
- `gcloud auth application-default login`
- Or set `GOOGLE_APPLICATION_CREDENTIALS` to a service account JSON file

**Required permissions** for the ADC principal:
- **Pub/Sub**: Publish on topic `partner-data-ready` (e.g., `roles/pubsub.publisher`)
- **Firestore**: Read/write on `runs/*`

## Command-Line Arguments

### Core Arguments
- `--autofill` - Generate minimal payload server-side (derive ET phase/date)
- `--env NAME` - Set `payload.env` (dev|staging|prod) when using `--autofill`
- `--intervals LIST` - Comma-separated intervals (daily,weekly,monthly) for `--autofill`
- `--body PATH` - Path to JSON file with full `DataReadyPayloadV1`
- `--email ADDRESS` - Provenance email for audit trail
- `--attributes LIST` - Extra Pub/Sub message attributes as `k=v,k2=v2`
- `--verbose` - Print full JSON response

### Advanced Arguments
- `--phase pre|post` - Override auto phase detection
- `--trigger manual|scheduled|heartbeat|test` - Override trigger value (default: manual)
- `--live` - Enable live realtime run simulation mode
- `--sequence A|B|C` - Realtime run sequence (A=initial, B=intermediate, C=final)
- `--include-symbols LIST` - Comma-separated symbols to include (live mode)
- `--exclude-symbols LIST` - Comma-separated symbols to exclude (live mode)
- `--duration SECONDS` - Duration in seconds for live run simulation
- `--finalized-count NUMBER` - Number of finalized symbols (live mode)

### Help
- `--help` or `-h` - Show usage information and exit

## Environment Variables (Fallbacks)

Environment variables serve as fallbacks when command-line arguments are not provided:

- `ENV` - Default environment (fallback if --env not provided)
- `INTERVALS` - Default intervals (fallback if --intervals not provided)
- `BODY` - Default body path (fallback if --body not provided)
- `EMAIL` - Default email (fallback if --email not provided)
- `ATTRS`/`ATTRIBUTES` - Default attributes (fallback if --attributes not provided)
- `VERBOSE` - Default verbose setting (fallback if --verbose not provided)

**Note**: Environment variables are only used as fallbacks. Command-line arguments take precedence.

## Usage Examples

### Basic Autofill (Recommended for quick tests)
```bash
npx ts-node functions/scripts/partner/partner-data-ready-direct.ts --autofill --env dev --email you@example.com --verbose
```

### Multiple Intervals
```bash
npx ts-node functions/scripts/partner/partner-data-ready-direct.ts --autofill --env staging --intervals daily,weekly --email you@example.com --verbose
```

### Custom Payload (Full Control)
Create `payload.json` matching `DataReadyPayloadV1`:
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
npx ts-node functions/scripts/partner/partner-data-ready-direct.ts --body payload.json --email you@example.com --verbose
```

### Live Realtime Run Simulation
```bash
# Basic live simulation
npx ts-node functions/scripts/partner/partner-data-ready-direct.ts --autofill --env dev --live --sequence A --duration 300 --verbose

# Live simulation with symbol filtering
npx ts-node functions/scripts/partner/partner-data-ready-direct.ts --autofill --env dev --live --sequence B --include-symbols AAPL,MSFT,GOOGL --exclude-symbols TSLA --duration 600 --verbose

# Live simulation with custom trigger
npx ts-node functions/scripts/partner/partner-data-ready-direct.ts --autofill --env dev --live --sequence C --trigger scheduled --finalized-count 1500 --verbose
```

### Advanced Options
```bash
# Override phase and trigger
npx ts-node functions/scripts/partner/partner-data-ready-direct.ts --autofill --env prod --phase post --trigger heartbeat --verbose

# Add custom attributes
npx ts-node functions/scripts/partner/partner-data-ready-direct.ts --autofill --env dev --attributes "source=test,priority=high" --verbose
```

## Output Formats

### Success (Concise)
```
ok requestId=<uuid> status=enqueued messageId=<pubsub-id>
```

### Success (Verbose with --verbose)
```json
{
  "requestId": "...",
  "messageId": "...",
  "status": "enqueued",
  "ok": true
}
```

### Error Examples
```
Error: Payload validation failed: field "env" is required
Error: Pub/Sub publish failed: PERMISSION_DENIED
Error: Firestore write failed: PERMISSION_DENIED
```

## Live Simulation Mode

The `--live` flag enables realistic testing of the A/B/C pipeline:

### Sequence Types
- **A**: Initial run (full symbol universe)
- **B**: Intermediate run (retry failed symbols)
- **C**: Final run (cleanup and finalization)

### Symbol Filtering
- `--include-symbols`: Only process specified symbols
- `--exclude-symbols`: Skip specified symbols
- If neither is specified, uses full tracked symbols universe

### Duration Control
- `--duration`: How long the simulation runs (in seconds)
- `--finalized-count`: Target number of symbols to process (optional)

### RunType Semantics (A/B/C)

When simulating A/B/C POST runs, the script sets the `runType` Pub/Sub attribute
to match the realtime pipeline so RS can distinguish initial vs retry passes:

- **Sequence A** (`--sequence A`):
  - `runType = "ts-post-all-intervals-initial"`
  - Represents the primary close run (full universe).
- **Sequence B** (`--sequence B`):
  - `runType = "ts-post-all-intervals-retry"`
  - Retry-only pass over symbols from the A run.
- **Sequence C** (`--sequence C`):
  - `runType = "ts-post-all-intervals-retry"`
  - Deadline retry pass over symbols from the B run.

This mirrors the logic in `realtime-run-aggregator.ts` and the
`runAllTimeSeriesIntervalsPost` orchestrator, so RS can apply the same
interpretation rules as for live messages.

## Payload Schema (DataReadyPayloadV1)

```typescript
interface DataReadyPayloadV1 {
  version: "v1";
  runId: string;           // Format: YYYY-MM-DD-<phase>
  phase: "pre" | "post";    // Market phase
  intervals: string[];     // ["daily", "weekly", "monthly"]
  time: number;            // Unix timestamp (ms)
  marketDate: string;       // YYYY-MM-DD
  env: "dev" | "staging" | "prod";
  trigger?: "manual" | "scheduled" | "heartbeat" | "test";
}
```

## Troubleshooting

### Common Issues
- **Missing `ts-node`**: Use `npx ts-node ...`; no global install required
- **Permission errors (prod)**: Ensure ADC principal has Pub/Sub publish and Firestore read/write
- **Emulator NOT_FOUND topic**: Re-run; script auto-creates `partner-data-ready` in Pub/Sub emulator
- **Validation errors**: Ensure payload conforms to `functions/src/v2/partner/schemas/data-ready.schema.ts`
- **Working directory**: Run from repo root so `../src/...` imports resolve

### Debug Mode
Use `--verbose` to see:
- Full payload being published
- Firestore document being created
- Pub/Sub message details
- Complete error stack traces

### Authentication Issues
```bash
# Test ADC setup
gcloud auth application-default login
gcloud auth application-default print-access-token

# Test emulator connectivity
curl http://localhost:8080/emulator/v1/projects/your-project/databases/(default)/documents
```

## Related Files

- **Script**: `functions/scripts/partner/partner-data-ready-direct.ts`
- **Handler**: `functions/src/v2/partner/data-ready.handler.ts`
- **Schema**: `functions/src/v2/partner/schemas/data-ready.schema.ts`
- **Constants**: `functions/src/v2/partner/constants.ts`
- **HTTP Variant**: `docs/partner-data-ready-publish.md`
- **Test Runs**: `docs/partner/partner-data-ready-test-runs.md`

## Migration Notes

**February 15, 2026**: Converted from environment variables to command-line arguments:
- `LIVE` → `--live`
- `INCLUDE_SYMBOLS` → `--include-symbols`
- `EXCLUDE_SYMBOLS` → `--exclude-symbols`
- `DURATION` → `--duration`
- `FINALIZED_COUNT` → `--finalized-count`

Environment variables still work as fallbacks for backward compatibility, but command-line arguments are now the preferred method.
