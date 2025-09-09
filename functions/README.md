# Functions README

This directory contains the Firebase/Cloud Functions source code and deployment notes.

## Partner Time Series API (for Savant and partner backends)

A server-to-server HTTPS endpoint that serves Alpha Vantage time-series data from Firestore.

- Function URL: `https://us-central1-alpha-vantage-proxy-api.cloudfunctions.net/partnerTimeSeriesV2`
- Auth: Google OIDC ID token from an allowlisted service account (no static keys)
- Firestore data: daily/weekly (year sharded) and monthly (all-doc) time series

For complete onboarding (allowlisting, audience, cURL/PowerShell + Node.js examples, troubleshooting), read:

- `docs/partner-integration.md`

## Deployment

- Ensure environment variables are set on the `partnerTimeSeriesV2` service (Cloud Run > Edit & deploy > Environment variables):
  - `ALLOWED_SERVICE_ACCOUNT_EMAILS` (comma-separated list of partner service account emails)
- Deploy via Firebase CLI:
```bash
firebase deploy --only functions
```

## Local Dev
- Use the Firebase emulator and `.env.alpha-vantage-proxy-api` for local env var testing.
