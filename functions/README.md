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

---

## Data Maintainer TTLs (Source of Truth)

- TTLs for all endpoints are defined on the endpoint configuration objects and should not be duplicated elsewhere.
  - Alpha Vantage: `@shared/alpha-vantage` endpoint configs (including time-series configs)
  - Benzinga: `@shared/benzinga` endpoint configs (e.g., Calendar/News request configs)
- `functions/src/v2/common/function-schedules.ts` only contains cron schedules and enums; it does not define TTLs.
- A central adapter `functions/src/v2/common/config/ttl-adapter.ts` provides a single lookup surface today (reads defaults from endpoint configs) and is the extension point for future overrides.

### Future: UI-driven TTL overrides

- We can support dynamic TTL management via a Firestore-based configuration collection, e.g. `config/endpoints/{provider}/{endpoint}` with fields like `ttlSeconds`, `enabled`, `notes`, `updatedAt`, `updatedBy`.
- The adapter can be extended to:
  1. Check Firestore for an override
  2. Fall back to the endpoint config default
- This enables changing TTLs without redeploying functions and provides an audit trail for changes.

---

## Module Resolution and Import Style

- We use TypeScript `module: commonjs` and `moduleResolution: Node` with `outDir: lib`.
- In `src/`, always use extensionless imports for local modules, for example:
  ```ts
  // Good
  export { refreshAlphaVantageDataV2 } from './v2/alpha-vantage/data-refresher/av-refresh-manager'

  // Avoid in TS source
  // export { refreshAlphaVantageDataV2 } from './v2/alpha-vantage/data-refresher/av-refresh-manager.js'
  ```
- Rationale:
  - Keeps TypeScript source decoupled from compiled file extensions.
  - The compiler emits `.js` to `lib/`, and Node resolves them at runtime.
  - Better editor/refactor support and less brittle imports.
- Scripts under `functions/scripts/` run via `ts-node`; the same extensionless import convention applies there as well.
