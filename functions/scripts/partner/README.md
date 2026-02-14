# Partner Testing Scripts

**Created**: February 14, 2026  
**Last Updated**: February 14, 2026

This directory contains scripts for testing partner integrations, publishing data-ready messages, and validating authentication mechanisms. These tools help verify partner endpoint functionality, test data flow, and ensure proper security configurations for external service integrations.

## Scripts

### partner-data-ready-direct.ts
**Purpose**: Publishes DataReadyPayloadV1 messages directly to Pub/Sub topic without going through HTTPS endpoints, enabling direct testing of the partner data pipeline.

**Parameters**:
- `--autofill` (CLI): Generate minimal payload server-side (derive ET phase/date)
- `--env` (CLI): Environment field for payload (dev|staging|prod)
- `--intervals` (CLI): Comma-separated intervals (daily,weekly,monthly)
- `--phase` (CLI): Override auto phase detection (pre|post)
- `--trigger` (CLI): Override trigger value (manual|scheduled|heartbeat|test)
- `--body` (CLI): Path to JSON file with full DataReadyPayloadV1
- `--attributes` (CLI): Extra message attributes as k=v,k2=v2
- `--verbose` (CLI): Enable verbose output
- `--email` (CLI): Provenance email for audit trail

**Environment Variables**:
- `PUBSUB_EMULATOR_HOST` - For local testing with emulator
- `FIRESTORE_EMULATOR_HOST` - For local testing with emulator

**Output**:
- Publishes message to `partner-data-ready` Pub/Sub topic
- Upserts `runs/{runId}` document in Firestore for provenance
- Returns publication status and message ID
- Logs detailed processing information

**Use Cases**:
- Testing partner data pipeline without full HTTP stack
- Validating data-ready message formats and content
- Debugging Pub/Sub publishing and Firestore writes
- Simulating partner data flows in development
- Testing message attributes and metadata handling

**Reasons for Using**:
- Direct Pub/Sub access bypasses HTTP complexity
- Supports both local emulator and production environments
- Autofill mode simplifies payload creation
- Comprehensive logging aids debugging
- Essential for partner integration testing

**Documentation**: `docs/partner/partner-data-ready-test-runs.md`

**Usage**:
```bash
# Autofill (derive ET phase/date, intervals=daily)
npx ts-node functions/scripts/partner/partner-data-ready-direct.ts --autofill --env dev --verbose

# Custom payload from file
npx ts-node functions/scripts/partner/partner-data-ready-direct.ts --body payload.json --verbose

# Multiple intervals
npx ts-node functions/scripts/partner/partner-data-ready-direct.ts --autofill --env staging --intervals daily,weekly --verbose
```

### partner-data-ready-direct.README.md
**Purpose**: Comprehensive documentation for the direct publisher including payload formats, usage examples, and troubleshooting guide.

**Parameters**: N/A (documentation file)

**Output**: N/A (documentation file)

**Content**: 
- Detailed usage examples for different scenarios
- Payload format specifications
- Authentication and security considerations
- Common error patterns and solutions
- Integration testing best practices

### partner-auth-test.ts
**Purpose**: Comprehensive smoke test for partner endpoints using Google OIDC token authentication with service account impersonation.

**Parameters**:
- `--service-account` (CLI): Service account email for impersonation (required)
- `--project` (CLI): GCP project ID (required)
- `--region` (CLI): Deployment region (required)
- `--functions` (CLI): Comma-separated function names to test
- `--symbol` (CLI): Symbol for testing (default: "AAPL")
- `--interval` (CLI): Time series interval (default: "daily")
- `--limit` (CLI): Result limit (default: 10)
- `--activeOnly` (CLI): Test only active symbols (default: true)
- `--verbose` (CLI): Enable verbose output
- `--checkTokeninfo` (CLI): Validate token info

**Output**:
- Tests `partnerListTrackedSymbolsV2` endpoint
- Tests `partnerTimeSeriesV2` endpoint
- Returns HTTP response codes and payloads
- Logs authentication flow and token details
- Validates OIDC token structure and claims

**Use Cases**:
- Validating partner endpoint authentication flow
- Testing OIDC token generation and validation
- Debugging service account impersonation issues
- Verifying partner API functionality and responses
- Testing partner data access permissions

**Reasons for Using**:
- Comprehensive endpoint testing ensures integration readiness
- OIDC token validation prevents authentication issues
- Service account impersonation supports secure testing
- Detailed logging aids troubleshooting
- Essential for partner onboarding and maintenance

**Features**:
- Mints per-function OIDC tokens via `gcloud auth print-identity-token`
- Service account impersonation support
- Comprehensive endpoint testing
- Token validation and debugging

**Usage**:
```bash
npx ts-node -r tsconfig-paths-register partner/partner-auth-test.ts \
  --service-account my-service@project.iam.gserviceaccount.com \
  --project my-project --region us-central1
```

### partner-auth-test.README.md
**Purpose**: Detailed setup instructions and troubleshooting guide for the partner authentication test script.

**Parameters**: N/A (documentation file)

**Output**: N/A (documentation file)

**Content**: 
- Service account configuration steps
- IAM permissions requirements
- Common authentication issues and solutions
- Token debugging techniques
- Integration testing best practices
