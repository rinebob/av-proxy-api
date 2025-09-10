# Internal Gateway Admin (SavantApi.com)

Audience: Savant engineering/admins responsible for SavantApi.com browser-facing gateways. This document explains which endpoints are considered internal, how they are protected, how to operate them safely, and how this differs from partner endpoints.

Last updated: 2025-09-10

---

## Internal Endpoints (Browser-Facing)

- `alphaVantageApiV2`
- `benzingaApiV2`
- `listSymbolsV2`

Purpose: Serve the SavantApi.com UI and related internal tools from first‑party web origins.

---

## Protection Model

- Origin allowlist enforced in code
  - Source of truth: `functions/src/v2/utils/cors-middleware.ts` (`ALLOWED_ORIGINS`)
  - Gateways call `withCors(...)` and perform an explicit Origin guard:
    - `functions/src/v2/alpha-vantage/alpha-vantage-gateway.ts`
    - `functions/src/v2/benzinga/benzinga-gateway.ts`
    - `functions/src/v2/common/functions/listSymbolsV2.ts`
  - Behavior: Requests with missing or non-allowlisted `Origin` receive 403. Browsers from non-allowlisted origins also fail CORS.

- Cloud Run IAM (invoker)
  - Keep `allUsers` on internal gateways so browser CORS preflight reaches application code
  - Do not remove public invoker from these services

- Optional hardening
  - Firebase App Check validation for first‑party web clients
  - Rate limiting at the app layer if needed

---

## Partner Endpoints (Contrast)

- Example: `partnerTimeSeriesV2`
- Server‑to‑server only; no browsers
- Locked down at Cloud Run (remove `allUsers`)
- Dual‑auth (Google OIDC/Firebase ID) and email allowlisting via `ALLOWED_SERVICE_ACCOUNT_EMAILS`

See: `docs/partner-discovery.md`, `docs/partner-integration.md`.

---

## IAM Guidance

- Internal gateways (this doc):
  - Ensure `roles/run.invoker` includes `allUsers`
  - Example command to re‑open if needed:
    ```bash
    gcloud run services add-iam-policy-binding alphavantageapiv2 \
      --member="allUsers" \
      --role="roles/run.invoker" \
      --region=us-central1 \
      --project=alpha-vantage-proxy-api
    ```

- Partner gateways:
  - Use `functions/scripts/lockdown-invokers.ps1` (opt‑in, partner‑only) to remove `allUsers` and grant specific SAs
  - See: `functions/scripts/README.lockdown-invokers.md`

---

## Change Management

- Updating allowed origins
  - Edit `ALLOWED_ORIGINS` in `functions/src/v2/utils/cors-middleware.ts`
  - Review and deploy affected gateways

- Adding a new internal gateway
  - Wrap handler with `withCors(...)`
  - Add explicit Origin guard using `ALLOWED_ORIGINS`
  - Verify CORS preflight from SavantApi.com
  - Confirm Cloud Run invoker includes `allUsers`

---

## Quick Runbook

1. Symptom: Browser CORS error/status 0 on internal endpoint
   - Check Cloud Run IAM invoker: must include `allUsers`
   - Verify `Origin` is in `ALLOWED_ORIGINS`
   - Confirm gateway includes explicit Origin guard and `withCors(...)`

2. Symptom: Partners ask for access to internal endpoint
   - Decline; advise using partner endpoints (`partnerTimeSeriesV2`) with OIDC

3. Symptom: Need to add a temporary test origin
   - Add the origin to `ALLOWED_ORIGINS` temporarily, deploy, and schedule removal

---

## References

- `functions/src/v2/utils/cors-middleware.ts`
- `functions/src/v2/alpha-vantage/alpha-vantage-gateway.ts`
- `functions/src/v2/benzinga/benzinga-gateway.ts`
- `functions/src/v2/common/functions/listSymbolsV2.ts`
- `functions/scripts/README.lockdown-invokers.md`
- `docs/partner-discovery.md`
- `docs/partner-integration.md`
